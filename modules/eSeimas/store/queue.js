import { postgres } from "../../../postgres/postgres.js";
import { recordDiscoveries } from "./discovery.js";

/**
 * Aktai, atrasti dienos paieškoje. Grąžina, kiek jų buvo nauji.
 *
 * @param {Array} items - žali paieškos rezultatai
 * @param {Object|null} [trace] - kai paduotas, atradimas surašomas į
 *   "eSeimasActDiscovery" (`--trace`; žr. modules/eSeimas/atradimuSekimas.sql).
 *   Laukai: `source`, `searchFrom`, `searchTo`, `page`, `pagination`.
 */
export async function upsertDiscoveredActs(items, trace = null) {
    const unique = new Map();
    for (const item of items) {
        if (item?.category && item?.id) unique.set(`${item.category}\0${item.id}`, item);
    }
    const rows = [...unique.values()];
    if (!rows.length) return 0;

    const categories = rows.map(item => item.category);
    const ids = rows.map(item => item.id);
    const titles = rows.map(item => item.title ?? null);

    await postgres.query(
        `INSERT INTO "eSeimasLegalAct" ("category", "legalActId", "title")
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         ON CONFLICT ("category", "legalActId") DO UPDATE
            SET "title" = COALESCE("eSeimasLegalAct"."title", EXCLUDED."title")`,
        [categories, ids, titles],
    );
    const { rows: queued } = await postgres.query(
        `INSERT INTO "eSeimasLegalActScrape" ("category", "legalActId")
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT DO NOTHING RETURNING "category", "legalActId"`,
        [categories, ids],
    );

    if (trace) {
        // `queued` — tik pirmą kartą pamatyti aktai; pagal juos atradimo eilutė
        // pasižymi `isNew`. Sekimo klaidos scrape'o nestabdo (žr. discovery.js).
        const nauji = new Set(queued.map(row => `${row.category}\0${row.legalActId}`));
        await recordDiscoveries({ ...trace, items: rows, nauji });
    }
    return queued.length;
}

export async function markDayScraped(day) {
    await postgres.query(
        `INSERT INTO "eSeimasScrapeDay" ("day", "lastScrapedAt") VALUES ($1, now())
         ON CONFLICT ("day") DO UPDATE SET "lastScrapedAt" = now()`,
        [day],
    );
}

/**
 * Pratęsia "eSeimasScrapeDay" Į PRIEKĮ — iki šiandien.
 *
 * Lentelė buvo užsėta VIENĄ kartą schemoje (`generate_series` iki tuometinės
 * `CURRENT_DATE`), tad nušlavus visas dienas etapas amžinai randa 0 darbo:
 * vakar ir šiandien tiesiog neegzistuoja lentelėje. Čia pridedam tik tai, ko
 * dar nėra — nuo naujausios turimos dienos iki šiandien.
 *
 * @returns {Promise<number>} kiek dienų pridėta
 */
export async function ensureScrapeDaysForward() {
    const { rowCount } = await postgres.query(
        `INSERT INTO "eSeimasScrapeDay" ("day")
         SELECT d::date
         FROM generate_series(
             COALESCE((SELECT max("day") + 1 FROM "eSeimasScrapeDay"), CURRENT_DATE),
             CURRENT_DATE,
             '1 day'
         ) d
         ON CONFLICT ("day") DO NOTHING`,
    );
    return rowCount ?? 0;
}

/**
 * Užtikrina slenkantį naujausių dienų langą TaskRunner radarui. Senesnių
 * "eSeimasScrapeDay" eilučių netrinam — jos lieka istorinio backfill'o būsenai.
 */
export async function ensureRecentScrapeDays(days = 180) {
    const { rowCount } = await postgres.query(
        `INSERT INTO "eSeimasScrapeDay" ("day")
         SELECT d::date
         FROM generate_series(
             CURRENT_DATE - ($1::int - 1),
             CURRENT_DATE,
             '1 day'
         ) d
         ON CONFLICT ("day") DO NOTHING`,
        [days],
    );
    return rowCount ?? 0;
}

/**
 * Viena seniausiai tikrinta diena iš slenkančio lango. Kai visas langas
 * patikrintas per paskutines `refreshHours` valandas, grąžina null ir
 * TaskRunner workeris pereina į cooldown.
 */
export async function pickRecentDayToScrape({ days = 180, refreshHours = 3 } = {}) {
    const { rows: [row] } = await postgres.query(
        `SELECT "day"::text AS day
         FROM "eSeimasScrapeDay"
         WHERE "day" >= CURRENT_DATE - ($1::int - 1)
           AND "day" <= CURRENT_DATE
           AND (
               "lastScrapedAt" IS NULL
               OR "lastScrapedAt" < now() - ($2::double precision * interval '1 hour')
           )
         ORDER BY "lastScrapedAt" NULLS FIRST, "day" DESC
         LIMIT 1`,
        [days, refreshHours],
    );
    return row?.day ?? null;
}

/**
 * Pažymi dienas, kurias apėmė atradimo langas. Įrašom TIK tas, kuriose iš tikrųjų
 * buvo aktų — tuščių kalendorinių dienų į lentelę nekišam.
 * @param {string[]} days - „yyyy-mm-dd"
 */
export async function markDaysCovered(days) {
    const unique = [...new Set(days.filter(Boolean))];
    if (!unique.length) return 0;
    const { rowCount } = await postgres.query(
        `INSERT INTO "eSeimasScrapeDay" ("day", "lastScrapedAt")
         SELECT unnest($1::date[]), now()
         ON CONFLICT ("day") DO UPDATE SET "lastScrapedAt" = now()`,
        [unique],
    );
    return rowCount ?? 0;
}

/** Seniausia lentelėje esanti diena — nuo jos leidžiamės gilyn. */
export async function getOldestScrapeDay() {
    const { rows } = await postgres.query(`SELECT min("day")::text AS day FROM "eSeimasScrapeDay"`);
    return rows[0]?.day ?? null;
}

/**
 * Pratęsia lentelę ATGAL — po nedidelę porciją prieš seniausią turimą dieną.
 *
 * Sąmoningai NEsėjam viso ruožo iš karto: nežinia, ar tose dienose apskritai
 * yra aktų, o tūkstančiai tuščių eilučių lentelėje būtų tik šiukšlės. Vietoj to
 * riba slenka žemyn porcijomis, ir scraper'is sustoja pats, kai keliose dienose
 * iš eilės nieko neberanda (žr. `--back-to` modules/eSeimas/eSeimasScrape.js).
 *
 * @param {Object} opts
 * @param {number} [opts.count] - kiek dienų pridėti šįkart
 * @param {string|null} [opts.floor] - žemiausia leidžiama data (imtinai)
 * @returns {Promise<string[]>} pridėtos dienos, naujausia pirma
 */
export async function extendScrapeDaysBackward({ count = 30, floor = null } = {}) {
    const { rows } = await postgres.query(
        `WITH riba AS (SELECT min("day") AS seniausia FROM "eSeimasScrapeDay")
         INSERT INTO "eSeimasScrapeDay" ("day")
         SELECT d::date
         FROM riba, generate_series(riba.seniausia - $1::int, riba.seniausia - 1, '1 day') d
         WHERE $2::date IS NULL OR d::date >= $2::date
         ON CONFLICT ("day") DO NOTHING
         RETURNING "day"::text AS day`,
        [count, floor],
    );
    return rows.map(row => row.day).sort().reverse();
}

/**
 * @param {Object} [opts]
 * @param {string[]} [opts.exclude] - dienos, kurių NEgrąžinti (šiame paleidime jau
 *   nepavykusios). "eSeimasScrapeDay" klaidų skaitiklio neturi, tad nepavykusi
 *   diena lieka `lastScrapedAt IS NULL` ir be šito amžinai stovėtų rikiuotės
 *   priekyje — užimtų visą LIMIT langą ir kitos dienos nebebūtų pasiekiamos.
 * @returns {string[]} dienos (yyyy-mm-dd), kurių dar netraukėm arba traukėm seniausiai.
 */
export async function pickDaysToScrape({ limit = 50, rescrapeOlderThanDays = null, exclude = [] } = {}) {
    const { rows } = await postgres.query(
        `SELECT "day"::text AS day FROM "eSeimasScrapeDay"
         WHERE ("lastScrapedAt" IS NULL
            OR ($2::int IS NOT NULL AND "lastScrapedAt" < now() - ($2 || ' days')::interval))
           AND "day"::text <> ALL($3::text[])
         ORDER BY "lastScrapedAt" NULLS FIRST, "day" DESC
         LIMIT $1`,
        [limit, rescrapeOlderThanDays, exclude],
    );
    return rows.map(row => row.day);
}

/**
 * Paima kitą darbo porciją vienam etapui.
 * @param {"document"|"editions"|"asr"} stage
 * @param {Object} [opts]
 * @param {Array<{category: string, legalActId: string}>} [opts.exclude] - aktai, kurių
 *   NEgrąžinti: šiame paleidime jau nepavykę. Jų `retryAfter` kada nors ateina, o
 *   iškviečiančioji pusė jų vis tiek neima — be šito jie atgal užimtų LIMIT langą.
 */
export async function pickActsToScrape(stage, { limit = 100, maxFailures = 5, exclude = [] } = {}) {
    const column = { document: "documentScrapedAt", editions: "editionsScrapedAt", asr: "asrScrapedAt" }[stage];
    if (!column) throw new Error(`Nežinomas etapas: ${stage}`);

    const { rows } = await postgres.query(
        `SELECT "category", "legalActId" FROM "eSeimasLegalActScrape"
         WHERE "${column}" IS NULL
           AND "failureCount" < $2
           AND ("retryAfter" IS NULL OR "retryAfter" <= now())
           AND ("category", "legalActId") NOT IN (SELECT * FROM unnest($3::text[], $4::text[]))
         -- "legalActId" kaip antrinis raktas: visa dienos porcija turi vienodą
         -- "discoveredAt", tad be jo eilė tarp paleidimų būtų nedeterministinė.
         ORDER BY "discoveredAt", "category", "legalActId"
         LIMIT $1`,
        [limit, maxFailures, exclude.map(act => act.category), exclude.map(act => act.legalActId)],
    );
    return rows;
}

/** Redakcijos, kurių istorinio dokumento dar neparsisiuntėm (paskutinis etapas). */
export async function pickEditionsToScrape({
    limit = 100, category = null, legalActId = null, maxFailures = 5,
    /** Rankiniam paleidimui: paimam ir tas, kurios laukia savo backoff'o. */
    ignoreBackoff = false,
    /** Redakcijos, kurios šiame paleidime jau nepavyko — žr. `pickActsToScrape`. */
    exclude = [],
} = {}) {
    const { rows } = await postgres.query(
        `SELECT "category", "legalActId", "editionToken" FROM "eSeimasEdition"
         WHERE "scrapedAt" IS NULL
           AND ($2::text IS NULL OR "category" = $2)
           AND ($3::text IS NULL OR "legalActId" = $3)
           AND ($5 OR ("failureCount" < $4 AND ("retryAfter" IS NULL OR "retryAfter" <= now())))
           AND ("category", "legalActId", "editionToken")
               NOT IN (SELECT * FROM unnest($6::text[], $7::text[], $8::text[]))
         ORDER BY "category", "legalActId", "ordinal"
         LIMIT $1`,
        [
            limit, category, legalActId, maxFailures, ignoreBackoff,
            exclude.map(edition => edition.category),
            exclude.map(edition => edition.legalActId),
            exclude.map(edition => edition.editionToken),
        ],
    );
    return rows;
}

export async function recordFailure(category, legalActId, error, { backoffMinutes = 30 } = {}) {
    await postgres.query(
        `UPDATE "eSeimasLegalActScrape"
            SET "failureCount" = "failureCount" + 1,
                "lastError" = $3,
                "retryAfter" = now() + ($4 * ("failureCount" + 1) || ' minutes')::interval
          WHERE "category" = $1 AND "legalActId" = $2`,
        [category, legalActId, String(error?.message ?? error).slice(0, 2000), backoffMinutes],
    );
}

/**
 * Nepavykusi istorinė redakcija. Skaitiklis gyvena ant PAČIOS redakcijos, ne
 * ant akto: viena lūžtanti redakcija (adapterio 502 „Requested consolidated
 * edition is unavailable") neturi stabdyti kitų to paties akto redakcijų.
 */
export async function recordEditionFailure(category, legalActId, editionToken, error, { backoffMinutes = 30 } = {}) {
    await postgres.query(
        `UPDATE "eSeimasEdition"
            SET "failureCount" = "failureCount" + 1,
                "lastError" = $4,
                "retryAfter" = now() + ($5 * ("failureCount" + 1) || ' minutes')::interval
          WHERE "category" = $1 AND "legalActId" = $2 AND "editionToken" = $3`,
        [category, legalActId, editionToken, String(error?.message ?? error).slice(0, 2000), backoffMinutes],
    );
}

/**
 * Ar redakcija su tokiu tokenu vis dar yra sąraše. Reikia po adapterio 404
 * „pasenęs tokenas": persikrovus `/editions`, pasenusi eilutė iš "eSeimasEdition"
 * dingsta (žr. `saveEditionList`) — o jei liko, tokenas dar sąraše ir klaida
 * tikra.
 */
export async function editionExists(category, legalActId, editionToken) {
    const { rows } = await postgres.query(
        `SELECT 1 FROM "eSeimasEdition" WHERE "category" = $1 AND "legalActId" = $2 AND "editionToken" = $3`,
        [category, legalActId, editionToken],
    );
    return rows.length > 0;
}

/** e-Seimas aiškiai sako, kad suvestinės nėra — tai ne klaida, etapą tiesiog užbaigiam. */
export async function markStageDone(category, legalActId, stage) {
    const column = { document: "documentScrapedAt", editions: "editionsScrapedAt", asr: "asrScrapedAt" }[stage];
    if (!column) throw new Error(`Nežinomas etapas: ${stage}`);
    await postgres.query(
        `UPDATE "eSeimasLegalActScrape"
            SET "${column}" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
          WHERE "category" = $1 AND "legalActId" = $2`,
        [category, legalActId],
    );
}

/** Statistika CLI `--status` režimui. */
export async function getScrapeStatus() {
    const { rows: [row] } = await postgres.query(`
        SELECT
            (SELECT count(*) FROM "eSeimasScrapeDay" WHERE "lastScrapedAt" IS NOT NULL) AS "dienosAtliktos",
            (SELECT count(*) FROM "eSeimasScrapeDay") AS "dienosViso",
            (SELECT count(*) FROM "eSeimasLegalActScrape") AS "aktaiViso",
            (SELECT count(*) FROM "eSeimasLegalActScrape" WHERE "documentScrapedAt" IS NOT NULL) AS "dokumentaiAtlikti",
            (SELECT count(*) FROM "eSeimasLegalActScrape" WHERE "editionsScrapedAt" IS NOT NULL) AS "redakcijuSarasaiAtlikti",
            (SELECT count(*) FROM "eSeimasLegalActScrape" WHERE "asrScrapedAt" IS NOT NULL) AS "suvestinesAtliktos",
            (SELECT count(*) FROM "eSeimasEdition") AS "redakcijosViso",
            (SELECT count(*) FROM "eSeimasEdition" WHERE "scrapedAt" IS NOT NULL) AS "redakcijosAtliktos",
            (SELECT count(*) FROM "eSeimasLegalActScrape" WHERE "failureCount" > 0) AS "suKlaidomis",
            (SELECT count(*) FROM "eSeimasSourceAnomaly") AS "saltinioBrokas"
    `);
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}


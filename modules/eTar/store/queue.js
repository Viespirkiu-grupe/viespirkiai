import { postgres } from "../../../postgres/postgres.js";

/** Aktai, atrasti dienos paieškoje. Grąžina, kiek jų buvo nauji. */
export async function upsertDiscoveredActs(items) {
    const rows = items.filter(item => item?.id);
    if (!rows.length) return 0;

    const ids = rows.map(item => item.id);
    const titles = rows.map(item => item.title ?? null);

    await postgres.query(
        `INSERT INTO "eTarLegalAct" ("legalActId", "title")
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT ("legalActId") DO UPDATE
            SET "title" = COALESCE("eTarLegalAct"."title", EXCLUDED."title")`,
        [ids, titles],
    );
    const { rows: queued } = await postgres.query(
        `INSERT INTO "eTarLegalActScrape" ("legalActId") SELECT unnest($1::text[])
         ON CONFLICT DO NOTHING RETURNING "legalActId"`,
        [ids],
    );
    return queued.length;
}

export async function markDayScraped(day) {
    await postgres.query(
        `INSERT INTO "eTarScrapeDay" ("day", "lastScrapedAt") VALUES ($1, now())
         ON CONFLICT ("day") DO UPDATE SET "lastScrapedAt" = now()`,
        [day],
    );
}

/**
 * Pratęsia "eTarScrapeDay" Į PRIEKĮ — iki šiandien.
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
        `INSERT INTO "eTarScrapeDay" ("day")
         SELECT d::date
         FROM generate_series(
             COALESCE((SELECT max("day") + 1 FROM "eTarScrapeDay"), CURRENT_DATE),
             CURRENT_DATE,
             '1 day'
         ) d
         ON CONFLICT ("day") DO NOTHING`,
    );
    return rowCount ?? 0;
}

/**
 * Užtikrina slenkantį naujausių dienų langą TaskRunner radarui. Senesnių
 * "eTarScrapeDay" eilučių netrinam — jos lieka istorinio backfill'o būsenai.
 */
export async function ensureRecentScrapeDays(days = 180) {
    const { rowCount } = await postgres.query(
        `INSERT INTO "eTarScrapeDay" ("day")
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
         FROM "eTarScrapeDay"
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
        `INSERT INTO "eTarScrapeDay" ("day", "lastScrapedAt")
         SELECT unnest($1::date[]), now()
         ON CONFLICT ("day") DO UPDATE SET "lastScrapedAt" = now()`,
        [unique],
    );
    return rowCount ?? 0;
}

/** Seniausia lentelėje esanti diena — nuo jos leidžiamės gilyn. */
export async function getOldestScrapeDay() {
    const { rows } = await postgres.query(`SELECT min("day")::text AS day FROM "eTarScrapeDay"`);
    return rows[0]?.day ?? null;
}

/**
 * Pratęsia lentelę ATGAL — po nedidelę porciją prieš seniausią turimą dieną.
 *
 * Sąmoningai NEsėjam viso ruožo iš karto: nežinia, ar tose dienose apskritai
 * yra aktų, o tūkstančiai tuščių eilučių lentelėje būtų tik šiukšlės. Vietoj to
 * riba slenka žemyn porcijomis, ir scraper'is sustoja pats, kai keliose dienose
 * iš eilės nieko neberanda (žr. `--back-to` modules/eTar/eTarScrape.js).
 *
 * @param {Object} opts
 * @param {number} [opts.count] - kiek dienų pridėti šįkart
 * @param {string|null} [opts.floor] - žemiausia leidžiama data (imtinai)
 * @returns {Promise<string[]>} pridėtos dienos, naujausia pirma
 */
export async function extendScrapeDaysBackward({ count = 30, floor = null } = {}) {
    const { rows } = await postgres.query(
        `WITH riba AS (SELECT min("day") AS seniausia FROM "eTarScrapeDay")
         INSERT INTO "eTarScrapeDay" ("day")
         SELECT d::date
         FROM riba, generate_series(riba.seniausia - $1::int, riba.seniausia - 1, '1 day') d
         WHERE $2::date IS NULL OR d::date >= $2::date
         ON CONFLICT ("day") DO NOTHING
         RETURNING "day"::text AS day`,
        [count, floor],
    );
    return rows.map(row => row.day).sort().reverse();
}

/** @returns {string[]} dienos (yyyy-mm-dd), kurių dar netraukėm arba traukėm seniausiai. */
export async function pickDaysToScrape({ limit = 50, rescrapeOlderThanDays = null } = {}) {
    const { rows } = await postgres.query(
        `SELECT "day"::text AS day FROM "eTarScrapeDay"
         WHERE "lastScrapedAt" IS NULL
            OR ($2::int IS NOT NULL AND "lastScrapedAt" < now() - ($2 || ' days')::interval)
         ORDER BY "lastScrapedAt" NULLS FIRST, "day" DESC
         LIMIT $1`,
        [limit, rescrapeOlderThanDays],
    );
    return rows.map(row => row.day);
}

/**
 * Paima kitą darbo porciją vienam etapui.
 * @param {"document"|"editions"|"asr"} stage
 */
export async function pickActsToScrape(stage, { limit = 100, maxFailures = 5 } = {}) {
    const column = { document: "documentScrapedAt", editions: "editionsScrapedAt", asr: "asrScrapedAt" }[stage];
    if (!column) throw new Error(`Nežinomas etapas: ${stage}`);

    const { rows } = await postgres.query(
        `SELECT "legalActId" FROM "eTarLegalActScrape"
         WHERE "${column}" IS NULL
           AND "failureCount" < $2
           AND ("retryAfter" IS NULL OR "retryAfter" <= now())
         -- "legalActId" kaip antrinis raktas: visa dienos porcija turi vienodą
         -- "discoveredAt", tad be jo eilė tarp paleidimų būtų nedeterministinė.
         ORDER BY "discoveredAt", "legalActId"
         LIMIT $1`,
        [limit, maxFailures],
    );
    return rows.map(row => row.legalActId);
}

/** Redakcijos, kurių istorinio dokumento dar neparsisiuntėm (paskutinis etapas). */
export async function pickEditionsToScrape({
    limit = 100, legalActId = null, maxFailures = 5,
    /** Rankiniam paleidimui: paimam ir tas, kurios laukia savo backoff'o. */
    ignoreBackoff = false,
} = {}) {
    const { rows } = await postgres.query(
        `SELECT "legalActId", "editionToken" FROM "eTarEdition"
         WHERE "scrapedAt" IS NULL
           AND ($2::text IS NULL OR "legalActId" = $2)
           AND ($4 OR ("failureCount" < $3 AND ("retryAfter" IS NULL OR "retryAfter" <= now())))
         ORDER BY "legalActId", "ordinal"
         LIMIT $1`,
        [limit, legalActId, maxFailures, ignoreBackoff],
    );
    return rows;
}

export async function recordFailure(legalActId, error, { backoffMinutes = 30 } = {}) {
    await postgres.query(
        `UPDATE "eTarLegalActScrape"
            SET "failureCount" = "failureCount" + 1,
                "lastError" = $2,
                "retryAfter" = now() + ($3 * ("failureCount" + 1) || ' minutes')::interval
          WHERE "legalActId" = $1`,
        [legalActId, String(error?.message ?? error).slice(0, 2000), backoffMinutes],
    );
}

/**
 * Nepavykusi istorinė redakcija. Skaitiklis gyvena ant PAČIOS redakcijos, ne
 * ant akto: viena lūžtanti redakcija (adapterio 502 „Requested consolidated
 * edition is unavailable") neturi stabdyti kitų to paties akto redakcijų.
 */
export async function recordEditionFailure(legalActId, editionToken, error, { backoffMinutes = 30 } = {}) {
    await postgres.query(
        `UPDATE "eTarEdition"
            SET "failureCount" = "failureCount" + 1,
                "lastError" = $3,
                "retryAfter" = now() + ($4 * ("failureCount" + 1) || ' minutes')::interval
          WHERE "legalActId" = $1 AND "editionToken" = $2`,
        [legalActId, editionToken, String(error?.message ?? error).slice(0, 2000), backoffMinutes],
    );
}

/**
 * Ar redakcija su tokiu tokenu vis dar yra sąraše. Reikia po adapterio 404
 * „pasenęs tokenas": persikrovus `/editions`, pasenusi eilutė iš "eTarEdition"
 * dingsta (žr. `saveEditionList`) — o jei liko, tokenas dar sąraše ir klaida
 * tikra.
 */
export async function editionExists(legalActId, editionToken) {
    const { rows } = await postgres.query(
        `SELECT 1 FROM "eTarEdition" WHERE "legalActId" = $1 AND "editionToken" = $2`,
        [legalActId, editionToken],
    );
    return rows.length > 0;
}

/** e-TAR aiškiai sako, kad suvestinės nėra — tai ne klaida, etapą tiesiog užbaigiam. */
export async function markStageDone(legalActId, stage) {
    const column = { document: "documentScrapedAt", editions: "editionsScrapedAt", asr: "asrScrapedAt" }[stage];
    if (!column) throw new Error(`Nežinomas etapas: ${stage}`);
    await postgres.query(
        `UPDATE "eTarLegalActScrape"
            SET "${column}" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
          WHERE "legalActId" = $1`,
        [legalActId],
    );
}

/** Statistika CLI `--status` režimui. */
export async function getScrapeStatus() {
    const { rows: [row] } = await postgres.query(`
        SELECT
            (SELECT count(*) FROM "eTarScrapeDay" WHERE "lastScrapedAt" IS NOT NULL) AS "dienosAtliktos",
            (SELECT count(*) FROM "eTarScrapeDay") AS "dienosViso",
            (SELECT count(*) FROM "eTarLegalActScrape") AS "aktaiViso",
            (SELECT count(*) FROM "eTarLegalActScrape" WHERE "documentScrapedAt" IS NOT NULL) AS "dokumentaiAtlikti",
            (SELECT count(*) FROM "eTarLegalActScrape" WHERE "editionsScrapedAt" IS NOT NULL) AS "redakcijuSarasaiAtlikti",
            (SELECT count(*) FROM "eTarLegalActScrape" WHERE "asrScrapedAt" IS NOT NULL) AS "suvestinesAtliktos",
            (SELECT count(*) FROM "eTarEdition") AS "redakcijosViso",
            (SELECT count(*) FROM "eTarEdition" WHERE "scrapedAt" IS NOT NULL) AS "redakcijosAtliktos",
            (SELECT count(*) FROM "eTarLegalActScrape" WHERE "failureCount" > 0) AS "suKlaidomis",
            (SELECT count(*) FROM "eTarSourceAnomaly") AS "saltinioBrokas"
    `);
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}


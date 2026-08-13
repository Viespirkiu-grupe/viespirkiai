import { postgres } from "../../postgres/postgres.js";

// e-Seimas API atsakymo → Postgres normalizacija.
//
// Vienas atsakymas = viena tranzakcija: dokumento/sąrašo eilutė perrašoma, o visi
// jos vaikai (metaduomenys, susijusi informacija, resursai) ištrinami ir įrašomi iš
// naujo. Taip pakartotinis to paties akto scrape'as yra idempotentiškas ir nepalieka
// „vaiduoklių" iš senesnės redakcijos, o ON DELETE CASCADE nuvalo gilesnius lygius.
//
// Žodynų (statusai, rūšys, institucijos, EUROVOC…) id'ai išsprendžiami PRIEŠ
// atidarant tranzakciją ir kešuojami procese. Kritiškai svarbu, kad jie eitų per
// pool'ą atskirai: jei žodyno INSERT'as vyktų viduje tranzakcijos, o darbininkų
// būtų daugiau nei pool'o jungčių, gautume deadlock'ą laukiant antros jungties.

const PARAM_CHUNK_ROWS = 1000;

// ---------------------------------------------------------------
// fiksuoti žodynai (užpildyti schemoje, tik nuskaitom code → id)
// ---------------------------------------------------------------

let fixedLookups = null;

async function loadFixedLookups() {
    if (fixedLookups) return fixedLookups;

    const [variants, presence, sectionTypes, fieldKeys] = await Promise.all([
        postgres.query(`SELECT "code", "documentVariantId" AS id FROM "eSeimasDocumentVariant"`),
        postgres.query(`SELECT "code", "presenceStateId" AS id FROM "eSeimasPresenceState"`),
        postgres.query(`SELECT "code", "relatedSectionTypeId" AS id, "payloadKind" FROM "eSeimasRelatedSectionType"`),
        postgres.query(`SELECT "code", "metadataFieldKeyId" AS id, "valueKind" FROM "eSeimasMetadataFieldKey"`),
    ]);

    fixedLookups = {
        documentVariant: new Map(variants.rows.map(r => [r.code, r.id])),
        presenceState: new Map(presence.rows.map(r => [r.code, r.id])),
        relatedSectionType: new Map(sectionTypes.rows.map(r => [r.code, r])),
        metadataFieldKey: new Map(fieldKeys.rows.map(r => [r.code, r])),
    };
    return fixedLookups;
}

function requireLookup(map, code, what) {
    const value = map.get(code);
    if (value == null) throw new Error(`e-Seimas: nepažįstamas ${what} „${code}" (trūksta schemos žodyno įrašo)`);
    return value;
}

// ---------------------------------------------------------------
// atviri žodynai (papildomi bėgant): name → id, kešuojama procese
// ---------------------------------------------------------------

const OPEN_VOCABULARIES = {
    actStatus: { table: "eSeimasActStatus", id: "actStatusId", column: "name" },
    actType: { table: "eSeimasActType", id: "actTypeId", column: "name" },
    relationType: { table: "eSeimasRelationType", id: "relationTypeId", column: "name" },
    institution: { table: "eSeimasInstitution", id: "institutionId", column: "name" },
    resourceFormat: { table: "eSeimasResourceFormat", id: "resourceFormatId", column: "name" },
    eurovocTerm: { table: "eSeimasEurovocTerm", id: "eurovocTermId", column: "term" },
};

const vocabularyCaches = new Map(Object.keys(OPEN_VOCABULARIES).map(key => [key, new Map()]));

/**
 * Žodyno reikšmės ilgio riba.
 *
 * Visi atviri žodynai turi UNIQUE indeksą ant teksto, o btree eilutė negali
 * viršyti 2704 baitų. Tikros reikšmės („Įsakymas", institucijos pavadinimas)
 * telpa į kelias dešimtis simbolių, tad viską, kas ilgesnio, laikom šaltinio
 * broku, o ne duomenimis.
 *
 * Reali priežastis, dėl kurios šito prireikė: adapterio parseris kai kuriems
 * aktams į `act_type` sudeda VISO puslapio tekstą (pvz. Statybos įstatymas —
 * 8861 simb.), ir tada įrašymas krisdavo su „index row size … exceeds btree
 * maximum". Pilnas originalas visada lieka sidecar'o JSON'e.
 */
const MAX_VOCABULARY_CHARS = 300;

/** Žodynai, kurių nuoroda gali būti NULL — ten per ilgą reikšmę tiesiog metam. */
const NULLABLE_VOCABULARY = new Set(["actStatus", "actType", "institution", "eurovocTerm"]);

/**
 * Reikšmė → žodyno raktas. Kviečiama IR renkant, IR ieškant id, kad abiejose
 * vietose raktas sutaptų.
 *
 * `anomalies` paduodamas tik renkant: per ilga reikšmė ten užfiksuojama ir vėliau
 * įrašoma į "eSeimasSourceAnomaly". Be to brokas taptų nematomas — aktas įsirašytų
 * sėkmingai, `failureCount` nunulintų, ir niekur neliktų pėdsako.
 *
 * @returns {string|null} null = reikšmės nesaugom (nuoroda liks NULL)
 */
function vocabularyKey(kind, raw, anomalies = null) {
    if (raw == null || raw === "") return null;
    const value = String(raw);
    if (value.length <= MAX_VOCABULARY_CHARS) return value;

    anomalies?.push({ kind, ilgis: value.length, pavyzdys: value.slice(0, 200) });
    // NOT NULL nuorodoms (relationType, resourceFormat) nulio grąžinti negalim —
    // apkarpom, kad eilutė išliktų ir indeksas nesulūžtų.
    return NULLABLE_VOCABULARY.has(kind) ? null : value.slice(0, MAX_VOCABULARY_CHARS);
}

/**
 * Užfiksuoja šaltinio broką. Vienam aktui + laukui laikom vieną (naujausią)
 * įrašą — kartojasi tas pats defektas, ne skirtingi.
 */
async function recordAnomalies(client, category, legalActId, anomalies) {
    if (!anomalies.length) return;
    // Tam pačiam `kind` galėjo pasitaikyti kelios reikšmės — imam ilgiausią.
    const worst = new Map();
    for (const a of anomalies) {
        const esama = worst.get(a.kind);
        if (!esama || a.ilgis > esama.ilgis) worst.set(a.kind, a);
    }
    await insertRows(client, {
        table: "eSeimasSourceAnomaly",
        columns: ["category", "legalActId", "kind", "ilgis", "pavyzdys"],
        rows: [...worst.values()].map(a => ({ category, legalActId, ...a })),
        conflict: `("category", "legalActId", "kind") DO UPDATE SET
            "ilgis" = excluded."ilgis", "pavyzdys" = excluded."pavyzdys", "pastebeta" = now()`,
    });
}

/**
 * Užtikrina, kad visi vardai turi id, ir grąžina juos iš kešo.
 * Kviečiama prieš tranzakciją, per pool'ą — žodynai commit'inasi iš karto.
 */
async function ensureVocabulary(kind, names) {
    const cache = vocabularyCaches.get(kind);
    const missing = [...new Set(names.filter(name => name != null && name !== "" && !cache.has(name)))];
    if (!missing.length) return cache;

    const { table, id, column } = OPEN_VOCABULARIES[kind];
    await postgres.query(
        `INSERT INTO "${table}" ("${column}") SELECT unnest($1::text[]) ON CONFLICT ("${column}") DO NOTHING`,
        [missing],
    );
    const { rows } = await postgres.query(
        `SELECT "${column}" AS name, "${id}" AS id FROM "${table}" WHERE "${column}" = ANY($1::text[])`,
        [missing],
    );
    for (const row of rows) cache.set(row.name, row.id);
    return cache;
}

/** Surenka visus atsakyme pasitaikančius žodynų vardus ir iš karto juos išsprendžia. */
async function resolveVocabularies(payloads, anomalies = null) {
    const collected = Object.fromEntries(Object.keys(OPEN_VOCABULARIES).map(key => [key, new Set()]));

    for (const payload of payloads) {
        const add = (kind, raw) => {
            const key = vocabularyKey(kind, raw, anomalies);
            if (key != null) collected[kind].add(key);
        };

        const metadata = payload?.metadata;
        add("actStatus", metadata?.status);
        for (const term of metadata?.fields?.eurovoc_terms?.value ?? []) add("eurovocTerm", term);

        for (const resource of payload?.official_text?.resources ?? []) add("resourceFormat", resource?.format);

        for (const section of Object.values(payload?.related_information ?? {})) {
            for (const item of section?.items ?? []) {
                if (item.kind === "attachment") {
                    for (const resource of item.resources ?? []) add("resourceFormat", resource?.format);
                } else {
                    add("relationType", item.relation_type);
                    add("actType", item.act_type);
                    for (const institution of item.institutions ?? []) add("institution", institution);
                }
            }
        }
    }

    const entries = await Promise.all(
        Object.entries(collected).map(async ([kind, names]) => [kind, await ensureVocabulary(kind, [...names])]),
    );
    return Object.fromEntries(entries);
}

// ---------------------------------------------------------------
// paketinis INSERT: ($1,$2),($3,$4)… su dalijimu, kad neviršytume 65535 parametrų
// ---------------------------------------------------------------

async function insertRows(client, { table, columns, rows, returning = "", conflict = "" }) {
    if (!rows.length) return [];
    const quoted = columns.map(c => `"${c}"`).join(", ");
    const out = [];

    for (let start = 0; start < rows.length; start += PARAM_CHUNK_ROWS) {
        const chunk = rows.slice(start, start + PARAM_CHUNK_ROWS);
        const params = [];
        const tuples = chunk.map(row => {
            const placeholders = columns.map(column => {
                params.push(row[column] ?? null);
                return `$${params.length}`;
            });
            return `(${placeholders.join(", ")})`;
        });
        const { rows: returned } = await client.query(
            `INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(", ")}`
            + `${conflict ? ` ON CONFLICT ${conflict}` : ""}`
            + `${returning ? ` RETURNING ${returning}` : ""}`,
            params,
        );
        out.push(...returned);
    }
    return out;
}

// ---------------------------------------------------------------
// aktų eilutės ir scrape eilė
// ---------------------------------------------------------------

/** Nuorodose minimi aktai turi egzistuoti dėl FK — sukuriam stub'us ir įmetam į eilę. */
async function ensureLegalActStubs(client, category, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    await client.query(
        `INSERT INTO "eSeimasLegalAct" ("category", "legalActId")
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [category, unique],
    );
    await client.query(
        `INSERT INTO "eSeimasLegalActScrape" ("category", "legalActId")
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [category, unique],
    );
}

/** Aktai, atrasti dienos paieškoje. Grąžina, kiek jų buvo nauji. */
export async function upsertDiscoveredActs(items) {
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

/** @returns {string[]} dienos (yyyy-mm-dd), kurių dar netraukėm arba traukėm seniausiai. */
export async function pickDaysToScrape({ limit = 50, rescrapeOlderThanDays = null } = {}) {
    const { rows } = await postgres.query(
        `SELECT "day"::text AS day FROM "eSeimasScrapeDay"
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
        `SELECT "category", "legalActId" FROM "eSeimasLegalActScrape"
         WHERE "${column}" IS NULL
           AND "failureCount" < $2
           AND ("retryAfter" IS NULL OR "retryAfter" <= now())
         -- "legalActId" kaip antrinis raktas: visa dienos porcija turi vienodą
         -- "discoveredAt", tad be jo eilė tarp paleidimų būtų nedeterministinė.
         ORDER BY "discoveredAt", "category", "legalActId"
         LIMIT $1`,
        [limit, maxFailures],
    );
    return rows;
}

/** Redakcijos, kurių istorinio dokumento dar neparsisiuntėm (paskutinis etapas). */
export async function pickEditionsToScrape({
    limit = 100, category = null, legalActId = null, maxFailures = 5,
    /** Rankiniam paleidimui: paimam ir tas, kurios laukia savo backoff'o. */
    ignoreBackoff = false,
} = {}) {
    const { rows } = await postgres.query(
        `SELECT "category", "legalActId", "editionToken" FROM "eSeimasEdition"
         WHERE "scrapedAt" IS NULL
           AND ($2::text IS NULL OR "category" = $2)
           AND ($3::text IS NULL OR "legalActId" = $3)
           AND ($5 OR ("failureCount" < $4 AND ("retryAfter" IS NULL OR "retryAfter" <= now())))
         ORDER BY "category", "legalActId", "ordinal"
         LIMIT $1`,
        [limit, category, legalActId, maxFailures, ignoreBackoff],
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

async function markInTransaction(client, category, legalActId, mark) {
    if (!mark) return;
    if (mark.stage) {
        const column = {
            document: "documentScrapedAt",
            editions: "editionsScrapedAt",
            asr: "asrScrapedAt",
        }[mark.stage];
        if (!column) throw new Error(`Nežinomas etapas: ${mark.stage}`);
        await client.query(
            `UPDATE "eSeimasLegalActScrape"
                SET "${column}" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
              WHERE "category" = $1 AND "legalActId" = $2`,
            [category, legalActId],
        );
    }
    if (mark.editionToken) {
        await client.query(
            `UPDATE "eSeimasEdition"
                SET "scrapedAt" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
              WHERE "category" = $1 AND "legalActId" = $2 AND "editionToken" = $3`,
            [category, legalActId, mark.editionToken],
        );
    }
}

// ---------------------------------------------------------------
// metaduomenys (bendri dokumentui ir redakcijų sąrašui)
// ---------------------------------------------------------------

async function insertMetadata(client, owner, metadata, vocab, fixed) {
    if (!metadata) return;
    if (!["legal_act", "legal_act_project"].includes(metadata.profile)) {
        throw new Error(`e-Seimas: nepažįstamas metadata.profile „${metadata.profile}“`);
    }

    const registration = metadata.fields?.registration_details?.value ?? {};
    const { rows: [{ metadataId }] } = await client.query(
        `INSERT INTO "eSeimasDocumentMetadata" (
            "profile", "documentId", "editionListId", "actStatusId", "statusPresenceId",
            "effectiveFrom", "effectiveTo", "effectiveNote", "effectiveUntilNote",
            "registrationText", "registrationDate", "registrationNumber"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING "metadataId"`,
        [
            metadata.profile,
            owner.documentId ?? null,
            owner.editionListId ?? null,
            vocab.actStatus.get(vocabularyKey("actStatus", metadata.status)) ?? null,
            requireLookup(fixed.presenceState, metadata.status_presence, "status_presence"),
            metadata.effective_from ?? null,
            metadata.effective_to ?? null,
            metadata.effective_note ?? null,
            metadata.effective_until_note ?? null,
            registration.text ?? null,
            registration.date ?? null,
            registration.number ?? null,
        ],
    );

    await insertMetadataFields(client, metadataId, metadata.fields ?? {}, vocab, fixed);

    await insertRows(client, {
        table: "eSeimasChronologyEvent",
        columns: ["metadataId", "ordinal", "eventDate", "event"],
        rows: (metadata.chronology ?? []).map((event, index) => ({
            metadataId,
            ordinal: index,
            eventDate: event.date ?? null,
            event: event.event ?? null,
        })),
    });
}

/** Tuščių laukų (nei reikšmės, nei nuorodų) nesaugom — informacijos jie neneša. */
function isEmptyField(field) {
    if (!field) return true;
    const hasLinks = (field.links ?? []).length > 0;
    const value = field.value;
    if (Array.isArray(value)) return value.length === 0 && !hasLinks;
    if (value && typeof value === "object") {
        return Object.values(value).every(v => v == null) && !hasLinks;
    }
    return (value == null || value === "") && !hasLinks;
}

async function insertMetadataFields(client, metadataId, fields, vocab, fixed) {
    const present = Object.entries(fields).filter(([, field]) => !isEmptyField(field));
    if (!present.length) return;

    const returned = await insertRows(client, {
        table: "eSeimasMetadataField",
        columns: ["metadataId", "metadataFieldKeyId", "valueText"],
        rows: present.map(([code, field]) => {
            const key = requireLookup(fixed.metadataFieldKey, code, "metadataFieldKey");
            return {
                metadataId,
                metadataFieldKeyId: key.id,
                // list/registration reikšmės gyvena atskirose lentelėse/stulpeliuose.
                valueText: key.valueKind === "scalar" ? field.value ?? null : null,
            };
        }),
        returning: `"metadataFieldKeyId", "metadataFieldId"`,
    });
    const fieldIdByKey = new Map(returned.map(row => [row.metadataFieldKeyId, row.metadataFieldId]));

    const links = [];
    const terms = [];
    for (const [code, field] of present) {
        const key = fixed.metadataFieldKey.get(code);
        const metadataFieldId = fieldIdByKey.get(key.id);

        (field.links ?? []).forEach((link, index) => {
            links.push({ metadataFieldId, ordinal: index, linkText: link.text, url: link.url });
        });

        if (key.valueKind === "list") {
            // UNIQUE (metadataFieldId, eurovocTermId) — pasikartojantį terminą praleidžiam.
            const seen = new Set();
            for (const term of field.value ?? []) {
                const eurovocTermId = vocab.eurovocTerm.get(vocabularyKey("eurovocTerm", term));
                if (eurovocTermId == null || seen.has(eurovocTermId)) continue;
                seen.add(eurovocTermId);
                terms.push({ metadataFieldId, ordinal: seen.size - 1, eurovocTermId });
            }
        }
    }

    await insertRows(client, {
        table: "eSeimasMetadataFieldLink",
        columns: ["metadataFieldId", "ordinal", "linkText", "url"],
        rows: links,
    });
    await insertRows(client, {
        table: "eSeimasMetadataFieldEurovocTerm",
        columns: ["metadataFieldId", "ordinal", "eurovocTermId"],
        rows: terms,
    });
}

// ---------------------------------------------------------------
// susijusi informacija
// ---------------------------------------------------------------

async function insertRelatedInformation(client, owner, related, vocab, fixed) {
    for (const [code, section] of Object.entries(related ?? {})) {
        if (!section?.items?.length) continue;
        const type = requireLookup(fixed.relatedSectionType, code, "related_information skiltis");

        const { rows: [{ relatedSectionId }] } = await client.query(
            `INSERT INTO "eSeimasRelatedSection" ("documentId", "editionListId", "relatedSectionTypeId", "sourceLabel")
             VALUES ($1,$2,$3,$4) RETURNING "relatedSectionId"`,
            [owner.documentId ?? null, owner.editionListId ?? null, type.id, section.source_label],
        );

        if (type.payloadKind === "attachment") {
            await insertAttachments(client, relatedSectionId, section.items, vocab);
        } else {
            await insertRelations(client, relatedSectionId, section.items, vocab);
        }
    }
}

async function insertAttachments(client, relatedSectionId, items, vocab) {
    const returned = await insertRows(client, {
        table: "eSeimasAttachment",
        columns: ["relatedSectionId", "ordinal", "filename", "attachmentName"],
        rows: items.map((item, index) => ({
            relatedSectionId,
            ordinal: index,
            filename: item.filename,
            attachmentName: item.attachment_name ?? null,
        })),
        returning: `"ordinal", "attachmentId"`,
    });
    const idByOrdinal = new Map(returned.map(row => [row.ordinal, row.attachmentId]));

    const resources = [];
    items.forEach((item, index) => {
        const attachmentId = idByOrdinal.get(index);
        // UNIQUE (attachmentId, resourceFormatId) — jei šaltinis kartoja tą patį
        // formatą, paliekam pirmą URL.
        const seen = new Set();
        for (const resource of item.resources ?? []) {
            const resourceFormatId = vocab.resourceFormat.get(vocabularyKey("resourceFormat", resource.format));
            if (resourceFormatId == null || seen.has(resourceFormatId)) continue;
            seen.add(resourceFormatId);
            resources.push({ attachmentId, ordinal: seen.size - 1, resourceFormatId, url: resource.url });
        }
    });

    await insertRows(client, {
        table: "eSeimasAttachmentResource",
        columns: ["attachmentId", "ordinal", "resourceFormatId", "url"],
        rows: resources,
    });
}

async function insertRelations(client, relatedSectionId, items, vocab) {
    const returned = await insertRows(client, {
        table: "eSeimasLegalActRelation",
        columns: [
            "relatedSectionId", "ordinal", "relationTypeId", "targetLegalActId",
            "actTypeId", "documentNumber", "adoptedAt", "title", "url",
        ],
        rows: items.map((item, index) => ({
            relatedSectionId,
            ordinal: index,
            relationTypeId: vocab.relationType.get(vocabularyKey("relationType", item.relation_type)),
            targetLegalActId: item.legal_act_id,
            actTypeId: vocab.actType.get(vocabularyKey("actType", item.act_type)) ?? null,
            documentNumber: item.document_number ?? null,
            adoptedAt: item.adopted_at ?? null,
            title: item.title,
            url: item.url,
        })),
        returning: `"ordinal", "relationId"`,
    });
    const idByOrdinal = new Map(returned.map(row => [row.ordinal, row.relationId]));

    const institutions = [];
    items.forEach((item, index) => {
        const relationId = idByOrdinal.get(index);
        const seen = new Set();
        for (const name of item.institutions ?? []) {
            const institutionId = vocab.institution.get(vocabularyKey("institution", name));
            if (institutionId == null || seen.has(institutionId)) continue;
            seen.add(institutionId);
            institutions.push({ relationId, ordinal: seen.size - 1, institutionId });
        }
    });

    await insertRows(client, {
        table: "eSeimasLegalActRelationInstitution",
        columns: ["relationId", "ordinal", "institutionId"],
        rows: institutions,
    });
}

// ---------------------------------------------------------------
// dokumentas
// ---------------------------------------------------------------

function referencedActIds(payload) {
    const ids = [];
    for (const section of Object.values(payload.related_information ?? {})) {
        for (const item of section?.items ?? []) {
            if (item.kind !== "attachment" && item.legal_act_id) ids.push(item.legal_act_id);
        }
    }
    for (const edition of payload.editions ?? []) {
        for (const change of edition.changes ?? []) {
            if (change.legal_act_id) ids.push(change.legal_act_id);
        }
    }
    return ids;
}

/**
 * Įrašo pilną dokumento atsakymą (`/{id}`, `/{id}/asr` arba `/{id}/{edition}`).
 *
 * Nepakitęs `md5` reiškia, kad normalizuotas turinys identiškas — tokiu atveju
 * atnaujinam tik `fetchedAt`, vaikų neperrašom, o dokumentų eilės trigeris tokį
 * techninį atnaujinimą sąmoningai ignoruoja.
 * `force: true` apeina šį trumpąjį kelią (reikalinga, kai pasikeitė pati
 * normalizacija, o ne šaltinis).
 *
 * @param {Object} payload - LegalActDocument
 * @param {Object} opts
 * @param {string} opts.category - route kategorija, sudėtinio akto rakto dalis
 * @param {string} opts.md5 - sidecar raktas (JSON be nepastovių laukų)
 * @param {{stage?: string, editionToken?: string}} [opts.mark] - ką pažymėti kaip atliktą toje pačioje tranzakcijoje
 * @param {boolean} [opts.force] - perrašyti net jei md5 nepasikeitė
 * @returns {Promise<{documentId: number, keitimas: "insert"|"patch"|null}>}
 */
export async function saveDocument(payload, { category, md5, mark = null, force = false } = {}) {
    if (!category) throw new Error("e-Seimas dokumentui trūksta category");
    const fixed = await loadFixedLookups();
    const anomalies = [];
    const vocab = await resolveVocabularies([payload], anomalies);
    const documentVariantId = requireLookup(fixed.documentVariant, payload.document_variant, "document_variant");

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        // Senoji eilutė paimama PRIEŠ upsert'ą (ir užrakinama): iš `md5` skirtumo
        // matom, ar tai naujas dokumentas, ar pasikeitęs, ar visai nepakitęs.
        const { rows: [existing] } = await client.query(
            `SELECT "documentId", "md5" FROM "eSeimasLegalActDocument"
              WHERE "category" = $1 AND "legalActId" = $2 AND "documentVariantId" = $3
                AND COALESCE("editionToken", '') = COALESCE($4, '')
              FOR UPDATE`,
            [category, payload.id, documentVariantId, payload.edition_token ?? null],
        );
        const keitimas = existing ? (existing.md5 === md5 && !force ? null : "patch") : "insert";

        if (keitimas === null) {
            await client.query(
                `UPDATE "eSeimasLegalActDocument" SET "fetchedAt" = $2 WHERE "documentId" = $1`,
                [existing.documentId, payload.fetched_at ?? new Date().toISOString()],
            );
            await markInTransaction(client, category, payload.id, mark);
            await client.query("COMMIT");
            return { documentId: Number(existing.documentId), keitimas: null };
        }

        await client.query(
            `INSERT INTO "eSeimasLegalAct" ("category", "legalActId", "title", "fetchedAt")
             VALUES ($1, $2, $3, now())
             ON CONFLICT ("category", "legalActId") DO UPDATE
                SET "title" = COALESCE(EXCLUDED."title", "eSeimasLegalAct"."title"),
                    "fetchedAt" = now()`,
            [category, payload.id, payload.title ?? null],
        );
        await client.query(
            `INSERT INTO "eSeimasLegalActScrape" ("category", "legalActId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [category, payload.id],
        );
        await ensureLegalActStubs(client, category, referencedActIds(payload));

        const officialText = payload.official_text ?? {};
        const { rows: [{ documentId }] } = await client.query(
            `INSERT INTO "eSeimasLegalActDocument" (
                "category", "legalActId", "documentVariantId", "editionToken", "sourceUrl", "title",
                "contentPresenceId", "contentMessage", "fetchedAt", "md5"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT ("category", "legalActId", "documentVariantId", COALESCE("editionToken", ''))
             DO UPDATE SET
                "sourceUrl" = EXCLUDED."sourceUrl",
                "title" = EXCLUDED."title",
                "contentPresenceId" = EXCLUDED."contentPresenceId",
                "contentMessage" = EXCLUDED."contentMessage",
                "fetchedAt" = EXCLUDED."fetchedAt",
                "md5" = EXCLUDED."md5"
             RETURNING "documentId"`,
            [
                category,
                payload.id,
                documentVariantId,
                payload.edition_token ?? null,
                payload.source_url,
                payload.title,
                requireLookup(fixed.presenceState, officialText.content_presence, "content_presence"),
                officialText.message ?? null,
                payload.fetched_at ?? new Date().toISOString(),
                md5,
            ],
        );

        // Vaikus perrašom, o ne bandom sulieti: šaltinis neturi stabilių vaikų id'ų.
        await client.query(`DELETE FROM "eSeimasOfficialTextResource" WHERE "documentId" = $1`, [documentId]);
        await client.query(`DELETE FROM "eSeimasDocumentMetadata" WHERE "documentId" = $1`, [documentId]);
        await client.query(`DELETE FROM "eSeimasRelatedSection" WHERE "documentId" = $1`, [documentId]);

        await insertRows(client, {
            table: "eSeimasOfficialTextResource",
            columns: ["documentId", "ordinal", "resourceFormatId", "url"],
            rows: (officialText.resources ?? []).map((resource, index) => ({
                documentId,
                ordinal: index,
                resourceFormatId: vocab.resourceFormat.get(vocabularyKey("resourceFormat", resource.format)),
                url: resource.url,
            })),
        });

        await insertMetadata(client, { documentId }, payload.metadata, vocab, fixed);
        await insertRelatedInformation(client, { documentId }, payload.related_information, vocab, fixed);
        await markInTransaction(client, category, payload.id, mark);
        await recordAnomalies(client, category, payload.id, anomalies);
        await client.query("COMMIT");
        return { documentId: Number(documentId), keitimas };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------
// redakcijų sąrašas
// ---------------------------------------------------------------

/**
 * Įrašo `/{id}/editions` atsakymą. Kaip ir `saveDocument`, nepakitęs md5 →
 * atnaujinam tik `fetchedAt`; dokumentų indeksavimo šiame modulyje nėra.
 * @param {Object} payload - EditionList
 * @param {Object} opts
 * @param {string} opts.category - route kategorija, sudėtinio akto rakto dalis
 * @param {string} opts.md5 - sidecar raktas
 * @param {{stage?: string, editionToken?: string}} [opts.mark]
 * @param {boolean} [opts.force]
 * @returns {Promise<{editionListId: number, keitimas: "insert"|"patch"|null}>}
 */
export async function saveEditionList(payload, { category, md5, mark = { stage: "editions" }, force = false } = {}) {
    if (!category) throw new Error("e-Seimas redakcijų sąrašui trūksta category");
    const fixed = await loadFixedLookups();
    const anomalies = [];
    const vocab = await resolveVocabularies([payload], anomalies);

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        const { rows: [existing] } = await client.query(
            `SELECT "editionListId", "md5" FROM "eSeimasEditionList"
              WHERE "category" = $1 AND "legalActId" = $2 FOR UPDATE`,
            [category, payload.id],
        );
        const keitimas = existing ? (existing.md5 === md5 && !force ? null : "patch") : "insert";

        if (keitimas === null) {
            await client.query(
                `UPDATE "eSeimasEditionList" SET "fetchedAt" = $2 WHERE "editionListId" = $1`,
                [existing.editionListId, payload.fetched_at ?? new Date().toISOString()],
            );
            await markInTransaction(client, category, payload.id, mark);
            await client.query("COMMIT");
            return { editionListId: Number(existing.editionListId), keitimas: null };
        }

        await client.query(
            `INSERT INTO "eSeimasLegalAct" ("category", "legalActId", "title", "fetchedAt")
             VALUES ($1, $2, $3, now())
             ON CONFLICT ("category", "legalActId") DO UPDATE
                SET "title" = COALESCE(EXCLUDED."title", "eSeimasLegalAct"."title"),
                    "fetchedAt" = now()`,
            [category, payload.id, payload.title ?? null],
        );
        await client.query(
            `INSERT INTO "eSeimasLegalActScrape" ("category", "legalActId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [category, payload.id],
        );
        await ensureLegalActStubs(client, category, referencedActIds(payload));

        const { rows: [{ editionListId }] } = await client.query(
            `INSERT INTO "eSeimasEditionList" (
                "category", "legalActId", "sourceUrl", "title", "editionsPresenceId", "fetchedAt", "md5"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT ("category", "legalActId") DO UPDATE SET
                "sourceUrl" = EXCLUDED."sourceUrl",
                "title" = EXCLUDED."title",
                "editionsPresenceId" = EXCLUDED."editionsPresenceId",
                "fetchedAt" = EXCLUDED."fetchedAt",
                "md5" = EXCLUDED."md5"
             RETURNING "editionListId"`,
            [
                category,
                payload.id,
                payload.source_url,
                payload.title,
                requireLookup(fixed.presenceState, payload.editions_presence, "editions_presence"),
                payload.fetched_at ?? new Date().toISOString(),
                md5,
            ],
        );

        // 4-o etapo progresas gyvena ant "eSeimasEdition"."scrapedAt", o eilutes perrašom —
        // tad prieš trynimą pasiimam žymas ir grąžinam jas toms pačioms redakcijoms.
        // Kartu keliauja ir klaidų skaitiklis su `retryAfter`: kitaip redakcijų
        // sąrašo atnaujinimas nutrintų backoff'ą ir lūžtanti redakcija iškart
        // grįžtų į eilę.
        const { rows: previous } = await client.query(
            `SELECT "editionToken", "scrapedAt", "failureCount", "lastError", "retryAfter"
               FROM "eSeimasEdition" WHERE "category" = $1 AND "legalActId" = $2`,
            [category, payload.id],
        );
        const busenaByToken = new Map(previous.map(row => [row.editionToken, row]));

        await client.query(`DELETE FROM "eSeimasEdition" WHERE "editionListId" = $1`, [editionListId]);
        await client.query(`DELETE FROM "eSeimasDocumentMetadata" WHERE "editionListId" = $1`, [editionListId]);
        await client.query(`DELETE FROM "eSeimasRelatedSection" WHERE "editionListId" = $1`, [editionListId]);

        const editions = payload.editions ?? [];
        const returned = await insertRows(client, {
            table: "eSeimasEdition",
            columns: ["editionListId", "category", "legalActId", "ordinal", "editionToken", "effectiveFrom", "effectiveTo", "url",
                "scrapedAt", "failureCount", "lastError", "retryAfter"],
            rows: editions.map((edition, index) => {
                const buvusi = busenaByToken.get(edition.edition_token);
                return {
                    editionListId,
                    category,
                    legalActId: payload.id,
                    ordinal: index,
                    editionToken: edition.edition_token,
                    effectiveFrom: edition.effective_from,
                    effectiveTo: edition.effective_to ?? null,
                    url: edition.url,
                    scrapedAt: buvusi?.scrapedAt ?? null,
                    failureCount: buvusi?.failureCount ?? 0,
                    lastError: buvusi?.lastError ?? null,
                    retryAfter: buvusi?.retryAfter ?? null,
                };
            }),
            returning: `"ordinal", "editionId"`,
        });
        const editionIdByOrdinal = new Map(returned.map(row => [row.ordinal, row.editionId]));

        const changes = [];
        editions.forEach((edition, index) => {
            const editionId = editionIdByOrdinal.get(index);
            (edition.changes ?? []).forEach((change, changeIndex) => {
                changes.push({
                    editionId,
                    ordinal: changeIndex,
                    amendingActId: change.legal_act_id,
                    adoptedAt: change.adopted_at,
                    linkText: change.text,
                    url: change.url,
                });
            });
        });
        await insertRows(client, {
            table: "eSeimasEditionChange",
            columns: ["editionId", "ordinal", "amendingActId", "adoptedAt", "linkText", "url"],
            rows: changes,
        });

        await insertMetadata(client, { editionListId }, payload.metadata, vocab, fixed);
        await insertRelatedInformation(client, { editionListId }, payload.related_information, vocab, fixed);
        await markInTransaction(client, category, payload.id, mark);
        await recordAnomalies(client, category, payload.id, anomalies);

        await client.query("COMMIT");
        return { editionListId: Number(editionListId), keitimas };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
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

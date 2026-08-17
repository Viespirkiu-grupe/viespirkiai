import { postgres } from "../../../postgres/postgres.js";

const PARAM_CHUNK_ROWS = 1000;

// ---------------------------------------------------------------
// fiksuoti žodynai (užpildyti schemoje, tik nuskaitom code → id)
// ---------------------------------------------------------------

let fixedLookups = null;

export async function loadFixedLookups() {
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

export function requireLookup(map, code, what) {
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
export function vocabularyKey(kind, raw, anomalies = null) {
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
export async function recordAnomalies(client, category, legalActId, anomalies) {
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
export async function resolveVocabularies(payloads, anomalies = null) {
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

export async function insertRows(client, { table, columns, rows, returning = "", conflict = "" }) {
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


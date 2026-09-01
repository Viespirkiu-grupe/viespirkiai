import { createHash } from "node:crypto";
import { postgres } from "../../postgres/postgres.js";
import { replaceRelations } from "./storeRelations.js";

const DICTIONARIES = {
    gavejoTipas: "subjektuTipai",
    pagalbosTipas: "pagalbosTipai",
    pagalbosRusis: "pagalbosRusys",
    pagalbosForma: "pagalbosFormos",
    busena: "busenos",
    priemonesTipas: "priemoniuTipai",
    produktoSektorius: "produktuSektoriai",
    gavejoVeiklosRusis: "veiklosRusys",
    pagrindinisTikslas: "tikslai",
    antrinisTikslas: "tikslai",
    taisykles: "taisykles",
};

function valuesFor(record, field) {
    if (field === "taisykles") return [...new Set(record.taisykles ?? [])].filter(Boolean);
    return record[field] ? [record[field]] : [];
}

async function ensureDictionary(client, table, values) {
    if (!values.length) return new Map();
    await client.query(
        `INSERT INTO kotis."${table}" ("pavadinimas")
         SELECT DISTINCT value FROM unnest($1::text[]) value
         WHERE nullif(btrim(value), '') IS NOT NULL ON CONFLICT ("pavadinimas") DO NOTHING`,
        [values],
    );
    const { rows } = await client.query(
        `SELECT "id", "pavadinimas" FROM kotis."${table}" WHERE "pavadinimas" = ANY($1)`,
        [values],
    );
    return new Map(rows.map((row) => [row.pavadinimas, row.id]));
}

function subjectKey(subject, foreign = null) {
    if (!subject) return null;
    if (subject.kodas) {
        const jurisdiction = foreign === true ? "foreign" : foreign === false ? "LT" : "unknown";
        return `${jurisdiction}:${subject.kodas}`;
    }
    return `name:${subject.pavadinimas.toLocaleLowerCase("lt").replace(/\s+/g, " ").trim()}`;
}

async function ensureSubjects(client, record, typeIds) {
    await client.query(
        `INSERT INTO kotis."salys" ("kodas", "pavadinimas") VALUES ('LT', 'Lietuva')
         ON CONFLICT ("kodas") DO NOTHING`,
    );
    const { rows: countries } = await client.query(`SELECT "id" FROM kotis."salys" WHERE "kodas" = 'LT'`);
    const lithuaniaId = countries[0].id;
    const subjects = new Map();
    const add = (subject, { foreign = null, type = null } = {}) => {
        if (!subject?.pavadinimas) return;
        const key = subjectKey(subject, foreign);
        subjects.set(key, {
            raktas: key,
            kodas: subject.kodas ?? null,
            pavadinimas: subject.pavadinimas,
            subjektoTipoId: typeIds.get(type) ?? null,
            registracijosSaliesId: foreign === false ? lithuaniaId : null,
            uzsienietis: foreign,
        });
    };
    add(record.gavejas, { foreign: record.gavejasUzsienietis, type: record.gavejoTipas });
    add(record.teikejas);
    add(record.duomenuPildytojas);
    for (const related of record.susijeSubjektai ?? []) add(related);
    const payload = [...subjects.values()];
    if (!payload.length) return new Map();
    await client.query(
        `INSERT INTO kotis."subjektai" (
            "raktas", "kodas", "pavadinimas", "subjektoTipoId", "registracijosSaliesId", "uzsienietis"
         ) SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
            "raktas" text, "kodas" text, "pavadinimas" text, "subjektoTipoId" integer,
            "registracijosSaliesId" integer, "uzsienietis" boolean
         ) ON CONFLICT ("raktas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "subjektoTipoId" = coalesce(EXCLUDED."subjektoTipoId", kotis."subjektai"."subjektoTipoId"),
            "registracijosSaliesId" = coalesce(
                EXCLUDED."registracijosSaliesId", kotis."subjektai"."registracijosSaliesId"
            ), "uzsienietis" = coalesce(EXCLUDED."uzsienietis", kotis."subjektai"."uzsienietis"),
            "paskutiniKartaMatytas" = now()`,
        [JSON.stringify(payload)],
    );
    const { rows } = await client.query(
        `SELECT "id", "raktas" FROM kotis."subjektai" WHERE "raktas" = ANY($1)`,
        [payload.map((row) => row.raktas)],
    );
    return new Map(rows.map((row) => [row.raktas, row.id]));
}

function attachIds(record, dictionaries, subjects) {
    const id = (field, value) => dictionaries[field]?.get(value) ?? null;
    return {
        ...record,
        gavejoId: subjects.get(subjectKey(record.gavejas, record.gavejasUzsienietis)),
        teikejoId: subjects.get(subjectKey(record.teikejas, null)),
        duomenuPildytojoId: subjects.get(subjectKey(record.duomenuPildytojas, null)),
        pagalbosTipoId: id("pagalbosTipas", record.pagalbosTipas),
        pagalbosRusiesId: id("pagalbosRusis", record.pagalbosRusis),
        pagalbosFormosId: id("pagalbosForma", record.pagalbosForma),
        busenosId: id("busena", record.busena),
        produktoSektoriausId: id("produktoSektorius", record.produktoSektorius),
        gavejoVeiklosRusiesId: id("gavejoVeiklosRusis", record.gavejoVeiklosRusis),
        priemonesTipoId: id("priemonesTipas", record.priemonesTipas),
    };
}

async function upsertAid(client, row) {
    await client.query(
        `INSERT INTO kotis."pagalbos" AS p (
            "id", "gavejoId", "teikejoId", "suteikimoData", "pagalbosPateikimoData",
            "busenosSuteikimoData", "suma", "pagalbosTipoId", "pagalbosRusiesId",
            "pagalbosFormosId", "busenosId", "produktoSektoriausId", "gavejoVeiklosRusiesId",
            "registracijosKodas", "europosKomisijosNumeris", "duomenuPildytojoId", "versija",
            "tinkamosDengtiIslaidos", "pastaba"
         ) SELECT x.* FROM jsonb_to_record($1::jsonb) AS x(
            "id" bigint, "gavejoId" bigint, "teikejoId" bigint, "suteikimoData" date,
            "pagalbosPateikimoData" date, "busenosSuteikimoData" date, "suma" numeric,
            "pagalbosTipoId" integer, "pagalbosRusiesId" integer, "pagalbosFormosId" integer,
            "busenosId" integer, "produktoSektoriausId" integer, "gavejoVeiklosRusiesId" integer,
            "registracijosKodas" text, "europosKomisijosNumeris" text, "duomenuPildytojoId" bigint,
            "versija" integer, "tinkamosDengtiIslaidos" text, "pastaba" text
         ) ON CONFLICT ("id") DO UPDATE SET
            "gavejoId" = EXCLUDED."gavejoId", "teikejoId" = EXCLUDED."teikejoId",
            "suteikimoData" = EXCLUDED."suteikimoData",
            "pagalbosPateikimoData" = EXCLUDED."pagalbosPateikimoData",
            "busenosSuteikimoData" = EXCLUDED."busenosSuteikimoData", "suma" = EXCLUDED."suma",
            "pagalbosTipoId" = EXCLUDED."pagalbosTipoId",
            "pagalbosRusiesId" = EXCLUDED."pagalbosRusiesId",
            "pagalbosFormosId" = EXCLUDED."pagalbosFormosId", "busenosId" = EXCLUDED."busenosId",
            "produktoSektoriausId" = EXCLUDED."produktoSektoriausId",
            "gavejoVeiklosRusiesId" = EXCLUDED."gavejoVeiklosRusiesId",
            "registracijosKodas" = EXCLUDED."registracijosKodas",
            "europosKomisijosNumeris" = EXCLUDED."europosKomisijosNumeris",
            "duomenuPildytojoId" = EXCLUDED."duomenuPildytojoId", "versija" = EXCLUDED."versija",
            "tinkamosDengtiIslaidos" = EXCLUDED."tinkamosDengtiIslaidos",
            "pastaba" = EXCLUDED."pastaba", "atnaujinta" = now()`,
        [JSON.stringify(row)],
    );
}

function validate(record) {
    if (!record.gavejas?.pavadinimas || !record.suteikimoData || record.suma == null
        || !record.pagalbosTipas || !record.pagalbosRusis || !record.busena) {
        throw new Error(`Nepilna privaloma KOTIS kortelė ${record.id}`);
    }
}

export async function publishCard(record, job, db = postgres) {
    validate(record);
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const claim = await client.query(
            `SELECT "claimToken" FROM kotis."saltinioIrasai"
             WHERE "pagalbosId" = $1 AND "claimToken" = $2 FOR UPDATE`,
            [job.pagalbosId, job.claimToken],
        );
        if (!claim.rows.length) throw new Error(`KOTIS kortelės ${record.id} lease nebegalioja`);
        const dictionaries = {};
        for (const [field, table] of Object.entries(DICTIONARIES)) {
            dictionaries[field] = await ensureDictionary(client, table, valuesFor(record, field));
        }
        const subjects = await ensureSubjects(client, record, dictionaries.gavejoTipas);
        const normalized = attachIds(record, dictionaries, subjects);
        await upsertAid(client, normalized);
        await replaceRelations(client, [normalized], dictionaries, (subject) =>
            subjects.get(subjectKey(subject, null)));
        const md5 = createHash("md5").update(JSON.stringify(record)).digest("hex");
        await client.query(
            `UPDATE kotis."saltinioIrasai" SET
                "apdorotaAtradimoVersija" = GREATEST("apdorotaAtradimoVersija", $3),
                "claimToken" = NULL, "claimIki" = NULL, "kitasBandymas" = NULL,
                "nesekminguBandymuSkaicius" = 0, "paskutineKlaida" = NULL,
                "nuskaitytas" = now(), "turinioMd5" = $4
             WHERE "pagalbosId" = $1 AND "claimToken" = $2`,
            [job.pagalbosId, job.claimToken, job.atradimoVersija, md5],
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

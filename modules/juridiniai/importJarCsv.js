#!/usr/bin/env node
/*
 * Srautinis penkių viešų Registrų centro JAR CSV failų importas į naują
 * normalizuotą modelį (modules/juridiniai/jar.sql).
 *
 * Typesense čia sąmoningai neliečiamas.
 */
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("juridiniai", { operation: "importJarCsv" });
import readline from "node:readline";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { acquireSessionLock } from "../../postgres/sessionLock.js";
import { log } from "../../utils/log.js";

const BASE = "https://www.registrucentras.lt/aduomenys/";
const BATCH_SIZE = 1_000;
const LOCK_KEY = "jar-rc-csv-import";

const SOURCES = [
    {
        name: "iregistruoti",
        file: "JAR_IREGISTRUOTI.csv",
        header: ["ja_kodas", "ja_pavadinimas", "adresas", "ja_reg_data", "form_kodas", "form_pavadinimas", "stat_kodas", "stat_pavadinimas", "stat_data_nuo", "formavimo_data"],
        map: (r) => ({
            jarKodas: integer(r[0]), pavadinimas: r[1], registravimoData: r[3],
            formosKodas: integer(r[4]), formosPavadinimas: r[5],
            statusoKodas: integer(r[6]), statusoPavadinimas: r[7],
            statusasNuo: r[8], isregistravimoData: null, duomenuData: r[9],
        }),
        write: upsertRegistered,
    },
    {
        name: "isregistruoti",
        file: "JAR_ISREGISTRUOTI.csv",
        header: ["ja_kodas", "ja_pavadinimas", "adresas", "ja_reg_data", "form_kodas", "form_pavadinimas", "isreg_data", "formavimo_data"],
        map: (r) => ({
            jarKodas: integer(r[0]), pavadinimas: r[1], registravimoData: r[3],
            formosKodas: integer(r[4]), formosPavadinimas: r[5],
            statusoKodas: null, statusoPavadinimas: null, statusasNuo: null,
            isregistravimoData: r[6], duomenuData: r[7],
        }),
        write: upsertPeople,
    },
    {
        name: "adresai",
        file: "JAR_ADRESAI.csv",
        header: ["ja_kodas", "adresas", "aob_kodas", "adresas_nuo", "formavimo_data"],
        map: (r) => ({
            jarKodas: integer(r[0]),
            aobKodas: r[2],
            // Turint AOB kodą adresas gaunamas iš Adresų registro. Tekstą
            // laikome tik RC eilutėms, kurių su AR susieti neįmanoma.
            adresas: r[2] ? null : r[1],
            adresasNuo: r[3],
            duomenuData: r[4],
        }),
        write: upsertAddresses,
    },
    {
        name: "valdymas",
        file: "JAR_VALDYMAS.csv",
        header: ["ja_kodas", "obj_pav", "ja_pavadinimas", "vadovas", "vad_org_nuo", "vad_lytis", "valdyba", "vald_org_nuo", "vyr_sk_valdyboje", "mot_sk_valdyboje", "nd_apie_lyt_sk_valdyboje", "steb_taryba", "steb_tar_org_nuo", "vyr_sk_steb_taryboje", "mot_sk_steb_taryboje", "nd_apie_lyt_sk_steb_taryboje", "taryba", "tar_org_nuo", "vyr_sk_taryboje", "mot_sk_taryboje", "nd_apie_lyt_sk_taryboje", "kiti_valdymo_organai", "formavimo_data"],
        map: mapManagement,
        write: upsertManagement,
    },
    {
        name: "kapitalas",
        file: "JAR_KAPITALAS.csv",
        header: ["ja_kodas", "ja_pavadinimas", "adresas", "ja_reg_data", "form_kodas", "form_pavadinimas", "ist_kap_nuo", "ist_kapitalas", "valiuta", "formavimo_data"],
        map: (r) => ({ jarKodas: integer(r[0]), kapitalasNuo: r[6], kapitalas: decimal(r[7]), valiuta: r[8], duomenuData: r[9] }),
        write: upsertCapital,
    },
];

export async function importJarCsv() {
    // Lock'as – atskiroje tiesioginėje jungtyje, nes jis gyvena visą importą,
    // per daugybę transakcijų (žr. postgres/sessionLock.js).
    const lock = await acquireSessionLock(LOCK_KEY);
    if (!lock) throw new Error("Kitas RC JAR CSV importas jau veikia");

    const client = await postgres.connect();
    try {
        for (const source of SOURCES) await importSource(client, source);
    } finally {
        client.release();
        await lock.release();
    }
}

async function importSource(client, source) {
    const url = `${BASE}?byla=${encodeURIComponent(source.file)}`;
    log(`JAR: siunčiama ${source.file}`);
    const response = await scrapeFetch(url, {
        signal: AbortSignal.timeout(30 * 60_000),
        headers: {
            accept: "text/csv, text/plain;q=0.9, */*;q=0.1",
            "user-agent": "Mozilla/5.0 (compatible; viespirkiai.org JAR importer)",
        },
    });
    if (!response.ok || !response.body) throw new Error(`${source.file}: HTTP ${response.status}`);

    const lines = readline.createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
    let headerChecked = false;
    let batch = [];
    let scanned = 0;
    let changed = 0;

    for await (const line of lines) {
        if (!headerChecked) {
            const header = parseCsvLine(line.replace(/^\uFEFF/, ""));
            if (header.join("|") !== source.header.join("|")) {
                throw new Error(`${source.file}: netikėta antraštė: ${header.join("|")}`);
            }
            headerChecked = true;
            continue;
        }
        if (!line.trim()) continue;
        const fields = parseCsvLine(line).map(clean);
        if (fields.length !== source.header.length) {
            throw new Error(`${source.file}: ${scanned + 2} eilutėje ${fields.length}, tikėtasi ${source.header.length} laukų`);
        }
        const row = source.map(fields);
        if (!row.jarKodas) throw new Error(`${source.file}: ${scanned + 2} eilutėje nėra JAR kodo`);
        batch.push(row);
        scanned++;
        if (batch.length >= BATCH_SIZE) {
            changed += await writeBatch(client, source.write, batch);
            batch = [];
            if (scanned % 10_000 === 0) log(`${source.name}: perskaityta ${scanned}, pakeista ${changed}`);
        }
    }
    if (!headerChecked) throw new Error(`${source.file}: tuščias atsakymas`);
    if (batch.length) changed += await writeBatch(client, source.write, batch);
    log(`${source.name}: baigta, perskaityta ${scanned}, pakeista ${changed}`);
}

async function writeBatch(client, writer, rows) {
    await client.query("BEGIN");
    try {
        const changed = await writer(client, rows);
        await client.query("COMMIT");
        return changed;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function upsertForms(client, rows) {
    await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS x("formosKodas" integer, "formosPavadinimas" text)
        )
        INSERT INTO public."jarFormos" ("_id", "_revision", "kodas", "pavadinimas")
        SELECT gen_random_uuid(), gen_random_uuid(), "formosKodas", max("formosPavadinimas")
        FROM input WHERE "formosKodas" IS NOT NULL AND "formosPavadinimas" IS NOT NULL
        GROUP BY "formosKodas"
        ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE "jarFormos"."pavadinimas" IS DISTINCT FROM EXCLUDED."pavadinimas"
    `, [JSON.stringify(rows)]);
}

async function upsertRegistered(client, rows) {
    await upsertForms(client, rows);
    await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS x("statusoKodas" integer, "statusoPavadinimas" text)
        )
        INSERT INTO public."jarStatusai" ("kodas", "pavadinimas")
        SELECT "statusoKodas", max("statusoPavadinimas") FROM input
        WHERE "statusoKodas" IS NOT NULL AND "statusoPavadinimas" IS NOT NULL
        GROUP BY "statusoKodas"
        ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE "jarStatusai"."pavadinimas" IS DISTINCT FROM EXCLUDED."pavadinimas"
    `, [JSON.stringify(rows)]);
    return upsertPeople(client, rows, false);
}

async function upsertPeople(client, rows, updateForms = true) {
    if (updateForms) await upsertForms(client, rows);
    const result = await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "pavadinimas" text, "registravimoData" date,
                "formosKodas" integer, "statusoKodas" integer, "statusasNuo" date,
                "isregistravimoData" date, "duomenuData" date
            )
        )
        INSERT INTO public."jarAsmenys" AS old
            ("jarKodas", "pavadinimas", "registravimoData", "formosKodas",
             "statusoKodas", "statusasNuo", "isregistravimoData", "duomenuData")
        SELECT "jarKodas", "pavadinimas", "registravimoData", "formosKodas",
               "statusoKodas", "statusasNuo", "isregistravimoData", "duomenuData"
        FROM input
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "statusasNuo" = EXCLUDED."statusasNuo",
            "isregistravimoData" = EXCLUDED."isregistravimoData",
            "duomenuData" = EXCLUDED."duomenuData"
        WHERE ROW(old."pavadinimas", old."registravimoData", old."formosKodas",
                  old."statusoKodas", old."statusasNuo", old."isregistravimoData", old."duomenuData")
          IS DISTINCT FROM
              ROW(EXCLUDED."pavadinimas", EXCLUDED."registravimoData", EXCLUDED."formosKodas",
                  EXCLUDED."statusoKodas", EXCLUDED."statusasNuo", EXCLUDED."isregistravimoData", EXCLUDED."duomenuData")
        RETURNING 1
    `, [JSON.stringify(rows)]);
    return result.rowCount;
}

async function upsertAddresses(client, rows) {
    const result = await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "aobKodas" text, "adresas" text,
                "adresasNuo" date, "duomenuData" date
            )
        )
        INSERT INTO public."jarAsmenuAdresai" AS old
            ("jarKodas", "aobKodas", "adresas", "adresasNuo", "duomenuData")
        SELECT "jarKodas", "aobKodas", "adresas", "adresasNuo", "duomenuData" FROM input
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "aobKodas" = EXCLUDED."aobKodas", "adresas" = EXCLUDED."adresas",
            "adresasNuo" = EXCLUDED."adresasNuo", "duomenuData" = EXCLUDED."duomenuData",
            "fallbackLocation" = CASE
                WHEN old."aobKodas" IS DISTINCT FROM EXCLUDED."aobKodas"
                  OR old."adresas" IS DISTINCT FROM EXCLUDED."adresas"
                THEN NULL ELSE old."fallbackLocation" END,
            "fallbackLocationState" = CASE
                WHEN old."aobKodas" IS DISTINCT FROM EXCLUDED."aobKodas"
                  OR old."adresas" IS DISTINCT FROM EXCLUDED."adresas"
                THEN NULL ELSE old."fallbackLocationState" END,
            "fallbackLocationVersion" = CASE
                WHEN old."aobKodas" IS DISTINCT FROM EXCLUDED."aobKodas"
                  OR old."adresas" IS DISTINCT FROM EXCLUDED."adresas"
                THEN NULL ELSE old."fallbackLocationVersion" END
        WHERE ROW(old."aobKodas", old."adresas", old."adresasNuo", old."duomenuData")
          IS DISTINCT FROM ROW(EXCLUDED."aobKodas", EXCLUDED."adresas", EXCLUDED."adresasNuo", EXCLUDED."duomenuData")
        RETURNING 1
    `, [JSON.stringify(rows)]);
    return result.rowCount;
}

async function upsertManagement(client, rows) {
    const result = await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "vadovas" boolean, "vadovasNuo" date,
                "vadovoLytis" text, "kitiValdymoOrganai" boolean, "duomenuData" date
            )
        )
        INSERT INTO public."jarValdymas" AS old
            ("jarKodas", "vadovas", "vadovasNuo", "vadovoLytis", "kitiValdymoOrganai", "duomenuData")
        SELECT "jarKodas", "vadovas", "vadovasNuo", "vadovoLytis", "kitiValdymoOrganai", "duomenuData" FROM input
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "vadovas" = EXCLUDED."vadovas", "vadovasNuo" = EXCLUDED."vadovasNuo",
            "vadovoLytis" = EXCLUDED."vadovoLytis", "kitiValdymoOrganai" = EXCLUDED."kitiValdymoOrganai",
            "duomenuData" = EXCLUDED."duomenuData"
        RETURNING 1
    `, [JSON.stringify(rows)]);

    const codes = rows.map((row) => row.jarKodas);
    await client.query(`DELETE FROM public."jarValdymoOrganai" WHERE "jarKodas" = ANY($1::integer[])`, [codes]);
    const organs = rows.flatMap((row) => row.organai);
    if (organs.length) await client.query(`
        INSERT INTO public."jarValdymoOrganai"
            ("jarKodas", "tipas", "nuo", "vyruKiekis", "moteruKiekis", "lytisNenurodytaKiekis", "duomenuData")
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "tipas" text, "nuo" date, "vyruKiekis" integer,
            "moteruKiekis" integer, "lytisNenurodytaKiekis" integer, "duomenuData" date
        )
    `, [JSON.stringify(organs)]);
    return result.rowCount;
}

async function upsertCapital(client, rows) {
    const result = await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "kapitalasNuo" date, "kapitalas" numeric,
                "valiuta" text, "duomenuData" date
            )
        )
        INSERT INTO public."jarKapitalas" AS old
            ("jarKodas", "kapitalasNuo", "kapitalas", "valiuta", "duomenuData")
        SELECT "jarKodas", "kapitalasNuo", "kapitalas", upper("valiuta"), "duomenuData" FROM input
        ON CONFLICT ("jarKodas", "kapitalasNuo") DO UPDATE SET
            "kapitalas" = EXCLUDED."kapitalas", "valiuta" = EXCLUDED."valiuta",
            "duomenuData" = EXCLUDED."duomenuData"
        WHERE ROW(old."kapitalas", old."valiuta", old."duomenuData")
          IS DISTINCT FROM ROW(EXCLUDED."kapitalas", EXCLUDED."valiuta", EXCLUDED."duomenuData")
        RETURNING 1
    `, [JSON.stringify(rows)]);
    return result.rowCount;
}

function mapManagement(r) {
    const jarKodas = integer(r[0]);
    const duomenuData = r[22];
    const organai = [];
    for (const organ of [
        ["valdyba", 6, 7, 8, 9, 10],
        ["stebetojuTaryba", 11, 12, 13, 14, 15],
        ["taryba", 16, 17, 18, 19, 20],
    ]) {
        const [tipas, yra, nuo, vyrai, moterys, nezinoma] = organ;
        if (boolean(r[yra])) organai.push({
            jarKodas, tipas, nuo: r[nuo], vyruKiekis: integer(r[vyrai]),
            moteruKiekis: integer(r[moterys]), lytisNenurodytaKiekis: integer(r[nezinoma]), duomenuData,
        });
    }
    return {
        jarKodas, vadovas: boolean(r[3]), vadovasNuo: r[4], vadovoLytis: r[5],
        kitiValdymoOrganai: boolean(r[21]), duomenuData, organai,
    };
}

export function parseCsvLine(line) {
    const result = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') { field += '"'; index++; }
            else quoted = !quoted;
        } else if (char === "|" && !quoted) { result.push(field); field = ""; }
        else field += char;
    }
    if (quoted) throw new Error("Neuždarytos CSV kabutės");
    result.push(field);
    return result;
}

const clean = (value) => value == null || value === "" ? null : value.trim();
const integer = (value) => value == null || value === "" ? null : Number.parseInt(value, 10);
const decimal = (value) => value == null || value === "" ? null : Number(String(value).replace(",", "."));
const boolean = (value) => value === "1" || value === "true";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await importJarCsv();
    } finally {
        await postgres.end();
    }
}

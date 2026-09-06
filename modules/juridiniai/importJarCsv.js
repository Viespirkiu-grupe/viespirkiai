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
import { Readable, Transform } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { acquireSessionLock } from "../../postgres/sessionLock.js";
import { log } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
import { JURIDINIAI_SOURCE_REFRESH_LOCK } from "./locks.js";

const BASE = "https://www.registrucentras.lt/aduomenys/";
const BATCH_SIZE = 1_000;
const LOCK_KEY = "jar-rc-csv-import";

export const SOURCES = [
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

export async function fetchJarMetadata(source) {
    const response = await scrapeFetch(sourceUrl(source), {
        method: "HEAD",
        signal: AbortSignal.timeout(60_000),
        headers: requestHeaders(),
    });
    if (!response.ok) {
        if (response.status === 405 || response.status === 501) {
            return { etag: null, lastModified: null, size: null };
        }
        throw new Error(`${source.file}: HEAD HTTP ${response.status}`);
    }
    return responseMetadata(response);
}

export async function downloadJarSource(source, path) {
    const response = await scrapeFetch(sourceUrl(source), {
        signal: AbortSignal.timeout(30 * 60_000),
        headers: requestHeaders(),
    });
    if (!response.ok || !response.body) {
        throw new Error(`${source.file}: HTTP ${response.status}`);
    }
    const hash = createHash("sha256");
    const hasher = new Transform({
        transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(response.body), hasher, createWriteStream(path));
    return { sha256: hash.digest("hex"), ...responseMetadata(response) };
}

export async function importJarCsv({
    sources = SOURCES,
    beforeSource,
    afterSource,
    onSourceError,
} = {}) {
    // Lock'as – atskiroje tiesioginėje jungtyje, nes jis gyvena visą importą,
    // per daugybę transakcijų (žr. postgres/sessionLock.js).
    const lock = await acquireSessionLock(LOCK_KEY);
    if (!lock) throw new Error("Kitas RC JAR CSV importas jau veikia");

    let refreshLock;
    let client;
    let changedTotal = 0;
    try {
        // Palaukiame tik einamos refresh porcijos. Toliau visą importą saugome
        // nuo refresh, kad jis neapdorotų dalinio snapshot'o.
        refreshLock = await acquireSessionLock(
            JURIDINIAI_SOURCE_REFRESH_LOCK,
            { wait: true },
        );
        client = await postgres.connect();
        for (const source of sources) {
            if (beforeSource && await beforeSource(source) === false) continue;
            try {
                const result = await importSource(client, source);
                changedTotal += result.changed;
                if (afterSource) await afterSource(source, result, client);
            } catch (error) {
                if (onSourceError) await onSourceError(source, error, client);
                throw error;
            }
        }
        changedTotal += await removeMissingPeople(client);
    } finally {
        client?.release();
        await refreshLock?.release();
        await lock.release();
    }
    if (changedTotal > 0) {
        signalWork(WORK_SIGNALS.JURIDINIAI_REFRESH_READY, {
            source: "jar-csv",
            count: changedTotal,
        });
    }
    return { changed: changedTotal };
}

export async function importSource(client, source) {
    const tracksPeople = source.name === "iregistruoti" || source.name === "isregistruoti";
    const importId = tracksPeople ? randomUUID() : null;
    // SVARBU: viskas, ko reikia laukti (`await`), turi įvykti PRIEŠ
    // readline.createInterface(). Sąsaja srautą pradeda skaityti iš karto ir
    // `line` įvykius siunčia nelaukdama, o `for await` buferį pradeda kaupti tik
    // nuo iteracijos pradžios — vienas `await` tarpe tyliai praryja tiek eilučių,
    // kiek per tą laiką suspėta perskaityti (2026-08-28 importe taip dingo pirmos
    // 4612 JAR_IREGISTRUOTI.csv eilutės, o su jomis ir MAXIMA LT).
    if (tracksPeople) {
        await client.query(
            `DELETE FROM "rcJar"."csvImportSeen"
             WHERE "sukurta" < now() - interval '2 days'`,
        );
    }

    let lines;
    let sourceSha256 = source.sha256 ?? null;
    let metadata = source.downloadMetadata ?? {};
    if (source.localPath) {
        log(`JAR: importuojama ${source.file} iš laikino failo`);
        lines = readline.createInterface({
            input: createReadStream(source.localPath),
            crlfDelay: Infinity,
        });
    } else {
        const url = sourceUrl(source);
        log(`JAR: siunčiama ${source.file}`);
        const response = await scrapeFetch(url, {
            signal: AbortSignal.timeout(30 * 60_000),
            headers: requestHeaders(),
        });
        if (!response.ok || !response.body) {
            throw new Error(`${source.file}: HTTP ${response.status}`);
        }
        const hash = createHash("sha256");
        const hashingBody = response.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                hash.update(chunk);
                controller.enqueue(chunk);
            },
        }));
        lines = readline.createInterface({
            input: Readable.fromWeb(hashingBody),
            crlfDelay: Infinity,
        });
        metadata = responseMetadata(response);
        sourceSha256 = hash;
    }
    let headerChecked = false;
    let batch = [];
    let scanned = 0;
    let changed = 0;

    for await (const line of lines) {
        let normalizedLine = line;
        if (!headerChecked) {
            normalizedLine = line.replace(/^\uFEFF/, "");
            const firstFields = parseCsvLine(normalizedLine);
            headerChecked = true;
            if (firstFields.join("|") === source.header.join("|")) continue;
            log(`${source.file}: antraštės nėra, pradedama nuo pirmos duomenų eilutės`);
        }
        if (!normalizedLine.trim()) continue;
        const row = parseSourceRow(normalizedLine, source, scanned + 1);
        batch.push(row);
        scanned++;
        if (batch.length >= BATCH_SIZE) {
            changed += await writeBatch(client, source, batch, importId);
            batch = [];
            if (scanned % 10_000 === 0) log(`${source.name}: perskaityta ${scanned}, pakeista ${changed}`);
        }
    }
    if (!headerChecked) throw new Error(`${source.file}: tuščias atsakymas`);
    if (batch.length) changed += await writeBatch(client, source, batch, importId);
    if (tracksPeople) await updatePeopleMembership(client, source, importId);
    log(`${source.name}: baigta, perskaityta ${scanned}, pakeista ${changed}`);
    return {
        scanned,
        changed,
        sha256: typeof sourceSha256 === "string"
            ? sourceSha256
            : sourceSha256.digest("hex"),
        peopleMembershipChanged: tracksPeople,
        ...metadata,
    };
}

export function parseSourceRow(line, source, lineNumber = 1) {
    const fields = parseCsvLine(line).map(clean);
    if (fields.length !== source.header.length) {
        throw new Error(
            `${source.file}: ${lineNumber} eilutėje ${fields.length}, ` +
            `tikėtasi ${source.header.length} laukų`,
        );
    }
    const row = source.map(fields);
    if (!row.jarKodas) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje nėra JAR kodo`);
    }
    return row;
}

const sourceUrl = (source) => `${BASE}?byla=${encodeURIComponent(source.file)}`;

function requestHeaders() {
    return {
        accept: "text/csv, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Mozilla/5.0 (compatible; viespirkiai.org JAR importer)",
    };
}

function responseMetadata(response) {
    const rawSize = response.headers.get("content-length");
    const size = rawSize == null ? null : Number(rawSize);
    return {
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    };
}

async function writeBatch(client, source, rows, importId) {
    await client.query("BEGIN");
    try {
        const changed = await source.write(client, rows);
        if (source.name === "iregistruoti" || source.name === "isregistruoti") {
            await client.query(
                `INSERT INTO "rcJar"."csvImportSeen" ("importoId", "jarKodas")
                 SELECT $1::uuid, "jarKodas"
                 FROM jsonb_to_recordset($2::jsonb) AS x("jarKodas" integer)
                 ON CONFLICT DO NOTHING`,
                [importId, JSON.stringify(rows)],
            );
        }
        await client.query("COMMIT");
        return changed;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function updatePeopleMembership(client, source, importId) {
    await client.query("BEGIN");
    try {
        await client.query(
            `DELETE FROM "rcJar"."csvAsmenuSaltiniai" WHERE "failas" = $1`,
            [source.file],
        );
        await client.query(
            `INSERT INTO "rcJar"."csvAsmenuSaltiniai" ("failas", "jarKodas")
             SELECT $1, "jarKodas"
             FROM "rcJar"."csvImportSeen"
             WHERE "importoId" = $2`,
            [source.file, importId],
        );
        await client.query(
            `DELETE FROM "rcJar"."csvImportSeen" WHERE "importoId" = $1`,
            [importId],
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function removeMissingPeople(client) {
    const files = ["JAR_IREGISTRUOTI.csv", "JAR_ISREGISTRUOTI.csv"];
    await client.query("BEGIN");
    try {
        const removed = await client.query(
            `DELETE FROM "rcJar"."asmenys" person
             WHERE (
                 SELECT count(DISTINCT "failas")
                 FROM "rcJar"."csvAsmenuSaltiniai"
                 WHERE "failas" = ANY($1::text[])
             ) = 2
               AND NOT EXISTS (
                   SELECT 1 FROM "rcJar"."csvAsmenuSaltiniai" membership
                   WHERE membership."jarKodas" = person."jarKodas"
                     AND membership."failas" = ANY($1::text[])
               )`,
            [files],
        );
        await client.query("COMMIT");
        return removed.rowCount;
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
        INSERT INTO "rcJar"."formos" ("_id", "_revision", "kodas", "pavadinimas")
        SELECT gen_random_uuid(), gen_random_uuid(), "formosKodas", max("formosPavadinimas")
        FROM input WHERE "formosKodas" IS NOT NULL AND "formosPavadinimas" IS NOT NULL
        GROUP BY "formosKodas"
        ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE "rcJar"."formos"."pavadinimas" IS DISTINCT FROM EXCLUDED."pavadinimas"
    `, [JSON.stringify(rows)]);
}

async function upsertRegistered(client, rows) {
    await upsertForms(client, rows);
    await client.query(`
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS x("statusoKodas" integer, "statusoPavadinimas" text)
        )
        INSERT INTO "rcJar"."statusai" ("kodas", "pavadinimas")
        SELECT "statusoKodas", max("statusoPavadinimas") FROM input
        WHERE "statusoKodas" IS NOT NULL AND "statusoPavadinimas" IS NOT NULL
        GROUP BY "statusoKodas"
        ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE "rcJar"."statusai"."pavadinimas" IS DISTINCT FROM EXCLUDED."pavadinimas"
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
        INSERT INTO "rcJar"."asmenys" AS old
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
        INSERT INTO "rcJar"."asmenuAdresai" AS old
            ("jarKodas", "aobKodas", "adresas", "adresasNuo", "duomenuData")
        SELECT input."jarKodas", input."aobKodas", input."adresas",
               input."adresasNuo", input."duomenuData"
        FROM input
        JOIN "rcJar"."asmenys" person
          ON person."jarKodas" = input."jarKodas"
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
        INSERT INTO "rcJar"."valdymas" AS old
            ("jarKodas", "vadovas", "vadovasNuo", "vadovoLytis", "kitiValdymoOrganai", "duomenuData")
        SELECT input."jarKodas", input."vadovas", input."vadovasNuo",
               input."vadovoLytis", input."kitiValdymoOrganai", input."duomenuData"
        FROM input
        JOIN "rcJar"."asmenys" person
          ON person."jarKodas" = input."jarKodas"
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "vadovas" = EXCLUDED."vadovas", "vadovasNuo" = EXCLUDED."vadovasNuo",
            "vadovoLytis" = EXCLUDED."vadovoLytis", "kitiValdymoOrganai" = EXCLUDED."kitiValdymoOrganai",
            "duomenuData" = EXCLUDED."duomenuData"
        RETURNING 1
    `, [JSON.stringify(rows)]);

    const codes = rows.map((row) => row.jarKodas);
    await client.query(`DELETE FROM "rcJar"."valdymoOrganai" WHERE "jarKodas" = ANY($1::integer[])`, [codes]);
    const organs = rows.flatMap((row) => row.organai);
    if (organs.length) await client.query(`
        INSERT INTO "rcJar"."valdymoOrganai"
            ("jarKodas", "tipas", "nuo", "vyruKiekis", "moteruKiekis", "lytisNenurodytaKiekis", "duomenuData")
        SELECT input.*
        FROM jsonb_to_recordset($1::jsonb) AS input(
                 "jarKodas" integer, "tipas" text, "nuo" date, "vyruKiekis" integer,
                 "moteruKiekis" integer, "lytisNenurodytaKiekis" integer, "duomenuData" date
             )
        JOIN "rcJar"."asmenys" person
          ON person."jarKodas" = input."jarKodas"
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
        INSERT INTO "rcJar"."kapitalas" AS old
            ("jarKodas", "kapitalasNuo", "kapitalas", "valiuta", "duomenuData")
        SELECT input."jarKodas", input."kapitalasNuo", input."kapitalas",
               upper(input."valiuta"), input."duomenuData"
        FROM input
        JOIN "rcJar"."asmenys" person
          ON person."jarKodas" = input."jarKodas"
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

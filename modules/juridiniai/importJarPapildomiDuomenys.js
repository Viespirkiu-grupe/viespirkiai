#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { acquireSessionLock } from "../../postgres/sessionLock.js";
import { postgres } from "../../postgres/postgres.js";
import { parseCSV } from "../../utils/csv.js";
import { log } from "../../utils/log.js";
import { createScraperFetch } from "../../utils/scrapeFetch.js";
import { getJarAdditionalDataSources } from "./jarPapildomiDataSources.js";

const scrapeFetch = createScraperFetch("juridiniai", {
    operation: "importJarPapildomiDuomenys",
});

const BATCH_SIZE = 1_000;
const LOCK_KEY = "jar-rc-additional-import";

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

export function metadataUnchanged(previous, current) {
    if (!previous) return false;
    if (previous.etag && current.etag) return previous.etag === current.etag;
    if (previous.lastModified && current.lastModified) {
        return new Date(previous.lastModified).getTime() ===
            new Date(current.lastModified).getTime() &&
            (previous.size == null || current.size == null ||
                Number(previous.size) === Number(current.size));
    }
    return false;
}

async function fetchMetadata(source) {
    const response = await scrapeFetch(source.url, {
        method: "HEAD",
        headers: requestHeaders(),
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        if (response.status === 405 || response.status === 501) {
            return { etag: null, lastModified: null, size: null };
        }
        throw new Error(`${source.file}: HEAD HTTP ${response.status}`);
    }
    return responseMetadata(response);
}

async function downloadSource(source, path) {
    const response = await scrapeFetch(source.url, {
        headers: requestHeaders(),
        signal: AbortSignal.timeout(60 * 60_000),
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

async function previousImport(file, db) {
    const { rows } = await db.query(
        `SELECT "etag", "lastModified", "dydis" AS "size", "sha256",
                "eiluciuSkaicius", "formavimoData"
         FROM public."jarRcImportai"
         WHERE "saltinioFailas" = $1`,
        [file],
    );
    return rows[0] ?? null;
}

function sourceDataset(source) {
    if (source.kind === "finansai") return `finansai:${source.ataskaitosTipas}`;
    if (source.kind === "zymos") return `zymos:${source.zymosTipas}:${source.intervalas}`;
    return source.kind;
}

async function saveImportMetadata(client, source, metadata, scanned, formavimoData) {
    await client.query(
        `INSERT INTO public."jarRcImportai" AS old
            ("saltinioFailas", "rinkinys", "saltinioMetai", "etag",
             "lastModified", "dydis", "sha256", "eiluciuSkaicius",
             "formavimoData", "importuota")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT ("saltinioFailas") DO UPDATE SET
             "rinkinys" = EXCLUDED."rinkinys",
             "saltinioMetai" = EXCLUDED."saltinioMetai",
             "etag" = EXCLUDED."etag",
             "lastModified" = EXCLUDED."lastModified",
             "dydis" = EXCLUDED."dydis",
             "sha256" = EXCLUDED."sha256",
             "eiluciuSkaicius" = EXCLUDED."eiluciuSkaicius",
             "formavimoData" = EXCLUDED."formavimoData",
             "importuota" = now()`,
        [source.file, sourceDataset(source), source.saltinioMetai ?? null,
            metadata.etag, metadata.lastModified, metadata.size, metadata.sha256,
            scanned, formavimoData],
    );
}

async function deleteSourceScope(client, source) {
    switch (source.kind) {
        case "finansai":
            await client.query(
                `DELETE FROM public."jarFinansinesAtaskaitos"
                 WHERE "ataskaitosTipas" = (
                     SELECT "id" FROM public."jarFinansiniuAtaskaituTipai"
                     WHERE "kodas" = $1
                 ) AND "saltinioMetai" = $2`,
                [source.ataskaitosTipas, source.saltinioMetai],
            );
            break;
        case "anuliavimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituAnuliavimai"`);
            break;
        case "velavimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituVelavimai"`);
            break;
        case "nepateikimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituNepateikimai"`);
            break;
        case "zymos":
            await client.query(
                `DELETE FROM public."jarZymuStatusai"
                 WHERE "zymosTipas" = $1
                   AND ("statusasIki" IS NULL) = $2`,
                [source.zymosTipas, source.intervalas === "aktyvus"],
            );
            break;
        case "savanoryste":
            await client.query(`DELETE FROM public."jarSavanoryste"`);
            break;
        case "jangis":
            await client.query(`DELETE FROM public."jarJangisTeikimai"`);
            break;
        case "dokumentai":
            if (source.nuoMetu) {
                await client.query(
                    `DELETE FROM public."jarDokumentai"
                     WHERE "dokumentoRegistravimoData" >= make_date($1, 1, 1)`,
                    [source.saltinioMetai],
                );
            } else {
                await client.query(
                    `DELETE FROM public."jarDokumentai"
                     WHERE "dokumentoRegistravimoData" >= make_date($1, 1, 1)
                       AND "dokumentoRegistravimoData" < make_date($1 + 1, 1, 1)`,
                    [source.saltinioMetai],
                );
            }
            break;
        default:
            throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    }
}

const clean = (value) => value == null || String(value).trim() === ""
    ? null
    : String(value).trim();

function normalizedRow(row) {
    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), clean(value)]),
    );
}

function required(value, field, source, lineNumber) {
    const result = clean(value);
    if (result == null) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje nėra ${field}`);
    }
    return result;
}

function integer(value, field, source, lineNumber, isRequired = false) {
    const text = isRequired ? required(value, field, source, lineNumber) : clean(value);
    if (text == null) return null;
    if (!/^-?\d+$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} nėra sveikasis skaičius: ${text}`);
    }
    const result = Number(text);
    if (!Number.isSafeInteger(result)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} per didelis: ${text}`);
    }
    return result;
}

function decimal(value, field, source, lineNumber) {
    const text = clean(value)?.replace(",", ".");
    if (text == null) return null;
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} nėra skaičius: ${text}`);
    }
    return text;
}

function date(value, field, source, lineNumber, isRequired = false) {
    const text = isRequired ? required(value, field, source, lineNumber) : clean(value);
    if (text == null) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje netinkama ${field}: ${text}`);
    }
    return text;
}

function commonFinancial(row, source, lineNumber) {
    const old = source.schema === "legacy";
    return {
        ataskaitosTipas: source.ataskaitosTipas,
        jarKodas: integer(row.ja_kodas ?? row.obj_kodas, "ja_kodas", source, lineNumber, true),
        pavadinimas: required(row.ja_pavadinimas ?? row.obj_pav, "ja_pavadinimas", source, lineNumber),
        formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
        formosPavadinimas: row.form_pavadinimas ?? row.form_pav,
        statusoKodas: integer(row.stat_kodas ?? row.stat_statusas, "stat_kodas", source, lineNumber),
        statusoPavadinimas: row.stat_pavadinimas ?? row.stat_pav,
        templateId: required(row.template_id, "template_id", source, lineNumber),
        templateName: row.template_name,
        standardId: required(row.standard_id, "standard_id", source, lineNumber),
        standardName: row.standard_name,
        laikotarpisNuo: date(old ? row.laikotarpis_nuo : row.beginning_date, "laikotarpis_nuo", source, lineNumber, true),
        laikotarpisIki: date(old ? row.laikotarpis_iki : row.turning_date, "laikotarpis_iki", source, lineNumber, true),
        registravimoData: date(row.reg_date, "reg_date", source, lineNumber, true),
        saltinioMetai: source.saltinioMetai,
        formavimoData: date(row.formavimo_data, "formavimo_data", source, lineNumber, true),
    };
}

const LEGACY_BALANCE_LINES = [
    ["nuosavas_kapitalas", "NUOSAVAS_KAPITALAS", "Nuosavas kapitalas"],
    ["mok_sumos_ir_isipareigojimai", "MOKETINOS_SUMOS_IR_ISIPAREIGOJIMAI", "Mokėtinos sumos ir įsipareigojimai"],
    ["ilgalaikis_turtas", "ILGALAIKIS_TURTAS", "Ilgalaikis turtas"],
    ["trumpalaikis_turtas", "TRUMPALAIKIS_TURTAS", "Trumpalaikis turtas"],
];

const LEGACY_PROFIT_LINES = [
    ["pelnas_pries_apmokestinima", "PELNAS_PRIES_APMOKESTINIMA", "Pelnas prieš apmokestinimą"],
    ["grynasis_pelnas", "GRYNASIS_PELNAS", "Grynasis pelnas"],
    ["pardavimo_pajamos", "PARDAVIMO_PAJAMOS", "Pardavimo pajamos"],
];

function mapFinancial(row, source, lineNumber) {
    const common = commonFinancial(row, source, lineNumber);
    if (source.schema === "long") {
        return [{
            ...common,
            lineTypeId: required(row.line_type_id, "line_type_id", source, lineNumber),
            lineName: required(row.line_name, "line_name", source, lineNumber),
            reiksme: decimal(row.reiksme, "reiksme", source, lineNumber),
        }];
    }
    const lines = source.ataskaitosTipas === "BALANSAS"
        ? LEGACY_BALANCE_LINES
        : LEGACY_PROFIT_LINES;
    return lines.map(([field, lineTypeId, lineName]) => ({
        ...common,
        lineTypeId,
        lineName,
        reiksme: decimal(row[field], field, source, lineNumber),
    }));
}

export function mapJarAdditionalRow(rawRow, source, lineNumber = 1) {
    const row = normalizedRow(rawRow);
    const jarKodas = () => integer(row.ja_kodas, "ja_kodas", source, lineNumber, true);
    const pavadinimas = () => required(row.ja_pavadinimas, "ja_pavadinimas", source, lineNumber);
    // JAR_DOKUMENTAI_2009–2024.csv realiai turi tik 6 stulpelius, nors RC
    // dabartinė struktūros XLSX nurodo ir formavimo_data. Kai jo faile nėra,
    // naudojame importo dieną (nustatomą DB current_date), kad neprimestume
    // dokumento ar registravimo datos kaip tariamos rinkinio formavimo datos.
    const formavimoData = () => date(
        row.formavimo_data ?? (source.kind === "dokumentai"
            ? source.fallbackFormavimoData
            : null),
        "formavimo_data", source, lineNumber, true,
    );

    switch (source.kind) {
        case "finansai":
            return mapFinancial(row, source, lineNumber);
        case "anuliavimai":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                statusoPavadinimas: row.stat_pavadinimas,
                templateId: required(row.template_id, "template_id", source, lineNumber),
                templateName: row.template_name,
                laikotarpisNuo: date(row.beginning_date, "beginning_date", source, lineNumber, true),
                laikotarpisIki: date(row.turning_date, "turning_date", source, lineNumber, true),
                anuliavimoRegistravimoData: date(
                    row.anul_ireg_date ?? row.anul_reg_date,
                    "anul_ireg_date", source, lineNumber, true,
                ),
                formavimoData: formavimoData(),
            }];
        case "velavimai":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                statusoKodas: integer(row.stat_kodas ?? row.status_kodas, "stat_kodas", source, lineNumber),
                paskutineAtaskaitaIki: date(row.paskutine_fa_iki, "paskutine_fa_iki", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        case "nepateikimai":
            return [{
                jarKodas: jarKodas(),
                nepateiktaUzMetus: integer(row.fa_nepateikta_uz_metus, "fa_nepateikta_uz_metus", source, lineNumber, true),
                pavadinimas: pavadinimas(),
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        case "zymos": {
            const isNvo = source.zymosTipas === "NVO";
            return [{
                jarKodas: jarKodas(), zymosTipas: source.zymosTipas,
                pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusasNuo: date(
                    isNvo ? row.nvo_nuo : row.paramos_gav_nuo,
                    isNvo ? "nvo_nuo" : "paramos_gav_nuo", source, lineNumber, true,
                ),
                statusasIki: date(
                    isNvo ? row.nvo_iki : row.paramos_gav_iki,
                    isNvo ? "nvo_iki" : "paramos_gav_iki", source, lineNumber,
                    source.intervalas === "pasibaiges",
                ),
                formavimoData: formavimoData(),
            }];
        }
        case "savanoryste":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pav,
                savanoriuSkaicius: integer(row.sav_skaicius, "sav_skaicius", source, lineNumber, true),
                savanorystesValanduSkaicius: integer(row.sav_val_skaicius, "sav_val_skaicius", source, lineNumber, true),
                laikotarpisNuo: date(row.laikotarpis_nuo, "laikotarpis_nuo", source, lineNumber, true),
                laikotarpisIki: date(row.laikotarpis_iki, "laikotarpis_iki", source, lineNumber, true),
                formavimoData: formavimoData(),
            }];
        case "jangis": {
            const pateiktas = integer(row.ar_pateiktas_ng_sarasas, "ar_pateiktas_ng_sarasas", source, lineNumber, true);
            if (pateiktas !== 0 && pateiktas !== 1) {
                throw new Error(`${source.file}: ${lineNumber} eilutėje ar_pateiktas_ng_sarasas turi būti 0 arba 1`);
            }
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                statusoPavadinimas: row.stat_pavadinimas,
                sarasasPateiktas: pateiktas === 1,
                sarasoBusena: clean(row.saraso_busena),
                sarasoPateikimoData: date(row.saraso_pateikimo_data, "saraso_pateikimo_data", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        }
        case "dokumentai":
            return [{
                jarKodas: jarKodas(),
                dokumentoTipas: integer(row.dokt_tipas, "dokt_tipas", source, lineNumber, true),
                dokumentoPotipis: integer(row.dokp_potipis, "dokp_potipis", source, lineNumber),
                dokumentoPotipioPavadinimas: row.dokp_pav,
                dokumentoData: date(row.dok_data, "dok_data", source, lineNumber),
                dokumentoRegistravimoData: date(row.dok_reg_data, "dok_reg_data", source, lineNumber, true),
                formavimoData: formavimoData(),
            }];
        default:
            throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    }
}

async function writeFinancialBatch(client, rows) {
    await client.query(
        `WITH input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                 "ataskaitosTipas" text, "jarKodas" integer, "pavadinimas" text,
                 "formosKodas" integer, "formosPavadinimas" text,
                 "statusoKodas" integer, "statusoPavadinimas" text,
                 "templateId" text, "templateName" text,
                 "standardId" text, "standardName" text,
                 "laikotarpisNuo" date, "laikotarpisIki" date,
                 "registravimoData" date, "saltinioMetai" smallint,
                 "formavimoData" date, "lineTypeId" text,
                 "lineName" text, "reiksme" numeric
             )
         ), resolved AS (
             SELECT input.*,
                    tipas."id" AS "ataskaitosTipasFk",
                    template."id" AS "templateIdFk",
                    standartas."id" AS "standardIdFk",
                    rodiklis."id" AS "lineTypeIdFk"
             FROM input
             JOIN public."jarFinansiniuAtaskaituTipai" tipas
               ON tipas."kodas" = input."ataskaitosTipas"
             JOIN public."jarFinansiniuAtaskaituTemplate" template
               ON template."kodas" = input."templateId"
             JOIN public."jarFinansiniuAtaskaituStandartai" standartas
               ON standartas."kodas" = input."standardId"
             JOIN public."jarFinansiniuAtaskaituRodikliuTipai" rodiklis
               ON rodiklis."kodas" = input."lineTypeId"
         ), report_input AS (
             SELECT DISTINCT ON (
                 "ataskaitosTipasFk", "jarKodas", "templateIdFk", "standardIdFk",
                 "laikotarpisNuo", "laikotarpisIki", "registravimoData"
             ) * FROM resolved
         ), reports AS (
             INSERT INTO public."jarFinansinesAtaskaitos" AS old (
                 "ataskaitosTipas", "jarKodas", "pavadinimas", "formosKodas",
                 "statusoKodas", "templateId", "standardId",
                 "laikotarpisNuo", "laikotarpisIki", "registravimoData",
                 "saltinioMetai", "formavimoData"
             )
             SELECT "ataskaitosTipasFk", "jarKodas", "pavadinimas", "formosKodas",
                    "statusoKodas", "templateIdFk", "standardIdFk",
                    "laikotarpisNuo", "laikotarpisIki", "registravimoData",
                    "saltinioMetai", "formavimoData"
             FROM report_input
             ON CONFLICT ON CONSTRAINT "jarFinansinesAtaskaitos_natural_key"
             DO UPDATE SET
                 "pavadinimas" = EXCLUDED."pavadinimas",
                 "formosKodas" = EXCLUDED."formosKodas",
                 "statusoKodas" = EXCLUDED."statusoKodas",
                 "saltinioMetai" = EXCLUDED."saltinioMetai",
                 "formavimoData" = EXCLUDED."formavimoData",
                 "importuota" = now()
             RETURNING "id", "ataskaitosTipas", "jarKodas", "templateId",
                       "standardId", "laikotarpisNuo", "laikotarpisIki",
                       "registravimoData"
         ), indicators AS (
             SELECT DISTINCT ON (reports."id", resolved."lineTypeIdFk")
                    reports."id" AS "ataskaitaId",
                    resolved."lineTypeIdFk" AS "lineTypeId",
                    resolved."reiksme"
             FROM resolved
             JOIN reports
               ON reports."ataskaitosTipas" = resolved."ataskaitosTipasFk"
              AND reports."jarKodas" = resolved."jarKodas"
              AND reports."templateId" = resolved."templateIdFk"
              AND reports."standardId" = resolved."standardIdFk"
              AND reports."laikotarpisNuo" = resolved."laikotarpisNuo"
              AND reports."laikotarpisIki" = resolved."laikotarpisIki"
              AND reports."registravimoData" = resolved."registravimoData"
         )
         INSERT INTO public."jarFinansiniuAtaskaituRodikliai" AS old
             ("ataskaitaId", "lineTypeId", "reiksme")
         SELECT "ataskaitaId", "lineTypeId", "reiksme"
         FROM indicators
         ON CONFLICT ("ataskaitaId", "lineTypeId") DO UPDATE SET
             "reiksme" = EXCLUDED."reiksme"`,
        [JSON.stringify(rows)],
    );
}

const BATCH_SQL = {
    anuliavimai: `
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
                "statusoKodas" integer, "templateId" text, "laikotarpisNuo" date,
                "laikotarpisIki" date, "anuliavimoRegistravimoData" date, "formavimoData" date)
        ), resolved AS (
            SELECT input."jarKodas", input."pavadinimas", input."formosKodas",
                   input."statusoKodas", template."id" AS "templateId",
                   input."laikotarpisNuo", input."laikotarpisIki",
                   input."anuliavimoRegistravimoData", input."formavimoData"
            FROM input
            JOIN public."jarFinansiniuAtaskaituTemplate" template
              ON template."kodas" = input."templateId"
        )
        INSERT INTO public."jarFinansiniuAtaskaituAnuliavimai" AS old
            ("jarKodas", "pavadinimas", "formosKodas",
             "statusoKodas", "templateId",
             "laikotarpisNuo", "laikotarpisIki", "anuliavimoRegistravimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "templateId", "laikotarpisNuo", "laikotarpisIki", "anuliavimoRegistravimoData") *
        FROM resolved
        ON CONFLICT ON CONSTRAINT "jarFinansiniuAtaskaituAnuliavimai_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    velavimai: `
        INSERT INTO public."jarFinansiniuAtaskaituVelavimai" AS old
            ("jarKodas", "pavadinimas", "formosKodas", "statusoKodas", "paskutineAtaskaitaIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas") * FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "statusoKodas" integer, "paskutineAtaskaitaIki" date, "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas", "paskutineAtaskaitaIki" = EXCLUDED."paskutineAtaskaitaIki",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    nepateikimai: `
        INSERT INTO public."jarFinansiniuAtaskaituNepateikimai" AS old
            ("jarKodas", "nepateiktaUzMetus", "pavadinimas", "registravimoData",
             "formosKodas", "statusoKodas", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "nepateiktaUzMetus") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "nepateiktaUzMetus" smallint, "pavadinimas" text,
            "registravimoData" date, "formosKodas" integer, "statusoKodas" integer, "formavimoData" date)
        ON CONFLICT ("jarKodas", "nepateiktaUzMetus") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas", "statusoKodas" = EXCLUDED."statusoKodas",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    zymos: `
        INSERT INTO public."jarZymuStatusai" AS old
            ("jarKodas", "zymosTipas", "pavadinimas", "formosKodas",
             "statusasNuo", "statusasIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "zymosTipas", "statusasNuo") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "zymosTipas" text, "pavadinimas" text,
            "formosKodas" integer, "statusasNuo" date, "statusasIki" date,
            "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "jarZymuStatusai_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusasIki" = EXCLUDED."statusasIki",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    savanoryste: `
        INSERT INTO public."jarSavanoryste" AS old
            ("jarKodas", "pavadinimas", "formosKodas",
             "savanoriuSkaicius", "savanorystesValanduSkaicius", "laikotarpisNuo",
             "laikotarpisIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "laikotarpisNuo", "laikotarpisIki") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "savanoriuSkaicius" integer, "savanorystesValanduSkaicius" bigint,
            "laikotarpisNuo" date,
            "laikotarpisIki" date, "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "jarSavanoryste_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "savanoriuSkaicius" = EXCLUDED."savanoriuSkaicius",
            "savanorystesValanduSkaicius" = EXCLUDED."savanorystesValanduSkaicius",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    jangis: `
        INSERT INTO public."jarJangisTeikimai" AS old
            ("jarKodas", "pavadinimas", "registravimoData", "formosKodas",
             "statusoKodas", "sarasasPateiktas", "sarasoBusena",
             "sarasoPateikimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas") * FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "registravimoData" date,
            "formosKodas" integer, "statusoKodas" integer,
            "sarasasPateiktas" boolean, "sarasoBusena" text,
            "sarasoPateikimoData" date, "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas", "statusoKodas" = EXCLUDED."statusoKodas",
            "sarasasPateiktas" = EXCLUDED."sarasasPateiktas", "sarasoBusena" = EXCLUDED."sarasoBusena",
            "sarasoPateikimoData" = EXCLUDED."sarasoPateikimoData", "formavimoData" = EXCLUDED."formavimoData",
            "importuota" = now()`,
    dokumentai: `
        INSERT INTO public."jarDokumentai" AS old
            ("jarKodas", "dokumentoTipas", "dokumentoPotipis",
             "dokumentoData", "dokumentoRegistravimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "dokumentoTipas", "dokumentoPotipis", "dokumentoData", "dokumentoRegistravimoData") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "dokumentoTipas" integer, "dokumentoPotipis" integer,
            "dokumentoData" date, "dokumentoRegistravimoData" date,
            "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "jarDokumentai_natural_key" DO UPDATE SET
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
};

async function upsertDictionaries(client, rows) {
    await client.query(
        `WITH input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                 "formosKodas" integer, "formosPavadinimas" text,
                 "statusoKodas" integer, "statusoPavadinimas" text,
                 "templateId" text, "templateName" text,
                 "standardId" text, "standardName" text,
                 "lineTypeId" text, "lineName" text,
                 "sarasoBusena" text, "dokumentoTipas" integer,
                 "dokumentoPotipis" integer, "dokumentoPotipioPavadinimas" text
             )
         ), forms AS (
             INSERT INTO public."jarFormos" ("_id", "_revision", "kodas", "pavadinimas")
             SELECT gen_random_uuid(), gen_random_uuid(), "formosKodas", max("formosPavadinimas")
             FROM input
             WHERE "formosKodas" IS NOT NULL AND "formosPavadinimas" IS NOT NULL
             GROUP BY "formosKodas"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), statuses AS (
             INSERT INTO public."jarStatusai" ("kodas", "pavadinimas")
             SELECT "statusoKodas", max("statusoPavadinimas") FROM input
             WHERE "statusoKodas" IS NOT NULL AND "statusoPavadinimas" IS NOT NULL
             GROUP BY "statusoKodas"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), templates AS (
             INSERT INTO public."jarFinansiniuAtaskaituTemplate" ("kodas", "pavadinimas")
             SELECT "templateId", COALESCE(max("templateName"), "templateId") FROM input
             WHERE "templateId" IS NOT NULL
             GROUP BY "templateId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), standards AS (
             INSERT INTO public."jarFinansiniuAtaskaituStandartai" ("kodas", "pavadinimas")
             SELECT "standardId", COALESCE(max("standardName"), "standardId") FROM input
             WHERE "standardId" IS NOT NULL
             GROUP BY "standardId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), lines AS (
             INSERT INTO public."jarFinansiniuAtaskaituRodikliuTipai" ("kodas", "pavadinimas")
             SELECT "lineTypeId", COALESCE(max("lineName"), "lineTypeId") FROM input
             WHERE "lineTypeId" IS NOT NULL
             GROUP BY "lineTypeId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), jangis_statuses AS (
             INSERT INTO public."jarJangisBusenos" ("kodas", "pavadinimas")
             SELECT "sarasoBusena", initcap(lower("sarasoBusena")) FROM input
             WHERE "sarasoBusena" IS NOT NULL
             GROUP BY "sarasoBusena"
             ON CONFLICT ("kodas") DO NOTHING
         ), document_subtypes AS (
             INSERT INTO public."jarDokumentuPotipiai"
                 ("dokumentoTipas", "dokumentoPotipis", "pavadinimas")
             SELECT "dokumentoTipas", "dokumentoPotipis",
                    max("dokumentoPotipioPavadinimas")
             FROM input
             WHERE "dokumentoTipas" IS NOT NULL
               AND "dokumentoPotipis" IS NOT NULL
               AND "dokumentoPotipioPavadinimas" IS NOT NULL
             GROUP BY "dokumentoTipas", "dokumentoPotipis"
             ON CONFLICT ("dokumentoTipas", "dokumentoPotipis") DO UPDATE
             SET "pavadinimas" = EXCLUDED."pavadinimas"
         )
         SELECT 1`,
        [JSON.stringify(rows)],
    );
}

export async function writeBatch(client, source, rows) {
    await upsertDictionaries(client, rows);
    if (source.kind === "finansai") return writeFinancialBatch(client, rows);
    const sql = BATCH_SQL[source.kind];
    if (!sql) throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    await client.query(sql, [JSON.stringify(rows)]);
}

export async function importDownloadedSource(client, source, path, metadata) {
    await client.query("BEGIN");
    let scanned = 0;
    let stored = 0;
    let batch = [];
    let formavimoData = null;
    try {
        await deleteSourceScope(client, source);
        const mappingSource = { ...source };
        if (source.kind === "dokumentai") {
            const metadataDate = metadata.lastModified == null
                ? null
                : new Date(metadata.lastModified);
            if (metadataDate && !Number.isNaN(metadataDate.getTime())) {
                mappingSource.fallbackFormavimoData = metadataDate
                    .toISOString().slice(0, 10);
            } else {
                const { rows } = await client.query(
                    `SELECT current_date::text AS "formavimoData"`,
                );
                mappingSource.fallbackFormavimoData = rows[0].formavimoData;
            }
        }
        for await (const rawRow of parseCSV(path)) {
            const mapped = mapJarAdditionalRow(rawRow, mappingSource, scanned + 2);
            scanned++;
            for (const row of mapped) {
                batch.push(row);
                stored++;
                formavimoData = row.formavimoData ?? formavimoData;
            }
            if (batch.length >= BATCH_SIZE) {
                await writeBatch(client, source, batch);
                batch = [];
            }
            if (scanned % 100_000 === 0) {
                log(`${source.file}: perskaityta ${scanned} CSV eilučių`);
            }
        }
        if (batch.length) await writeBatch(client, source, batch);
        if (scanned === 0) {
            throw new Error(`${source.file}: CSV neturi duomenų eilučių`);
        }
        await saveImportMetadata(client, source, metadata, scanned, formavimoData);
        await client.query("COMMIT");
        log(`${source.file}: importuota ${scanned} CSV eilučių, ${stored} DB rodinių`);
        return { scanned, stored, formavimoData };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

export async function atnaujintiJarPapildomusDuomenis(
    { force = false, sources: suppliedSources } = {},
    db = postgres,
) {
    const lock = await acquireSessionLock(LOCK_KEY);
    if (!lock) throw new Error("Kitas papildomų RC JAR duomenų importas jau veikia");

    const workDir = await mkdtemp(join(tmpdir(), "jar-rc-extra-"));
    const result = { checked: 0, downloaded: 0, imported: 0, unchanged: 0, rows: 0 };
    try {
        const sources = suppliedSources ?? await getJarAdditionalDataSources();
        for (const source of sources) {
            result.checked++;
            const previous = await previousImport(source.file, db);
            const head = await fetchMetadata(source);
            if (!force && metadataUnchanged(previous, head)) {
                result.unchanged++;
                log(`${source.file}: nepakito`);
                continue;
            }

            const localPath = join(workDir, source.file);
            log(`${source.file}: siunčiama`);
            const downloaded = await downloadSource(source, localPath);
            result.downloaded++;
            if (!force && previous?.sha256 && previous.sha256 === downloaded.sha256) {
                await saveImportMetadata(
                    db, source, downloaded,
                    Number(previous.eiluciuSkaicius ?? 0),
                    previous.formavimoData,
                );
                result.unchanged++;
                log(`${source.file}: SHA-256 nepakito`);
                continue;
            }

            const client = typeof db.connect === "function" ? await db.connect() : db;
            let imported;
            try {
                imported = await importDownloadedSource(
                    client, source, localPath, downloaded,
                );
            } finally {
                if (client !== db) client.release();
            }
            result.imported++;
            result.rows += imported.scanned;
        }
        return result;
    } finally {
        await rm(workDir, { recursive: true, force: true });
        await lock.release();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = await atnaujintiJarPapildomusDuomenis({
            force: process.argv.slice(2).includes("--force"),
        });
        console.log(result);
    } finally {
        await postgres.end();
    }
}

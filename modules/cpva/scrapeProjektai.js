/*
Parsiunčia ir importuoja CPVA adminstruojamų projektų ir tiekėjų sąrašą
*/

import * as XLSX from "xlsx";
import path from "node:path";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { parseHTML } from "linkedom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import config from "../../utils/config.js";
import { cpvaDocumentUrl, cpvaXlsxUrl } from "./sourceUrls.js";
import { parseCpvaWorkbook } from "./parseWorkbook.js";

const execFileAsync = promisify(execFile);

export async function nuskaitytiCpvaProjektaiTiekejai() {
    const url = cpvaDocumentUrl(config.esInvesticijos2021Url);
    logger.log(`Nuskaitymas iš ${url}`);

    // 1. Load HTML via curl
    const { stdout: html } = await execFileAsync("curl", ["-k", "-fsSL", url]);

    const { document } = parseHTML(html);

    // 2. Find first .xlsx link and keep using the configured mirror/proxy.
    const resolvedFileUrl = cpvaXlsxUrl(
        document,
        url,
        config.esInvesticijos2021Url,
    );
    if (!resolvedFileUrl) {
        throw new Error("Nepavyko rasti .xlsx nuorodos puslapyje");
    }
    const filename = path.basename(new URL(resolvedFileUrl).pathname);

    const { stdout: fileBuffer } = await execFileAsync(
        "curl",
        ["-k", "-fsSL", resolvedFileUrl],
        {
            encoding: "buffer",
            maxBuffer: 1024 * 1024 * 250, // 250 MB
        },
    );

    logger.log(`Fetched ${filename}, size: ${fileBuffer.length} bytes`);

    // Nuskaitome duomenis iš XLSX failo
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });

    const {
        projects: projektuSarasas,
        contracts: projektuPirkimuSutartys,
    } = parseCpvaWorkbook(workbook);

    logger.log(
        `Paruošta importuoti: ${projektuSarasas.length} projektų, ` +
        `${projektuPirkimuSutartys.length} sutarčių eilučių`,
    );

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        await assertMigratedSchema(client);

        // CPVA failas yra visas aktualus snapshot, ne pakeitimų srautas.
        // Tranzakcija užtikrina, kad skaitytojai matys arba visą seną, arba
        // visą naują snapshot — niekada pusiau importuotą būseną.
        await client.query(`DELETE FROM public."cpvaProjektuSutartys"`);
        await client.query(`DELETE FROM public."cpvaProjektuSarasas"`);

        const projectCount = await insertProjektuSarasas(
            projektuSarasas,
            client,
        );
        const contractCount = await insertCpvaProjektuSutartys(
            projektuPirkimuSutartys,
            client,
        );
        await client.query("COMMIT");
        return { projectCount, contractCount, filename };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function assertMigratedSchema(client) {
    const result = await client.query(
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'cpvaProjektuSutartys'
              AND column_name = 'id'
        ) AS migrated`,
    );
    if (!result.rows[0]?.migrated) {
        throw new Error(
            "CPVA DB schema neatnaujinta: paleiskite " +
            "modules/cpva/migrateCpvaProjektuSutartys.sql",
        );
    }
}

async function insertProjektuSarasas(rows, db = postgres) {
    const sql = `
      INSERT INTO public."cpvaProjektuSarasas" (
          "projektoNr",
          "finansavimoSaltinis",
          "projektoVykdytojas",
          "projektoVykdytojoKodas",
          "projektoPavadinimas",
          "atsakingaMinisterija",
          "projektasSuPartneriais",
          "sutartiesData",
          "projektoVeikluPradziosData",
          "projektoVeikluPabaigosData",
          "egadpSubsidijos",
          "egadpPaskolos",
          "iperpfLesos",
          "ipesfLesos",
          "ipsaFLesos",
          "iptpfLesos",
          "bendrojoFinansavimo",
          "lrBiudzetoLesos",
          "lrvbEsFonduLesos",
          "nuosavoInasoLesos",
          "nuosavasInasasNetinkamam",
          "isViso"
      ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
  `;

    let count = 0;
    for (const row of rows) {
        // If projektoVeikluPabaigosData is not a date string, set to null
        if (
            row.projektoVeikluPabaigosData &&
            !/^\d{4}-\d{2}-\d{2}$/.test(row.projektoVeikluPabaigosData)
        ) {
            row.projektoVeikluPabaigosData = null;
        }

        const values = [
            row.projektoNr,
            row.finansavimoSaltinis,
            row.projektoVykdytojas,
            row.projektoVykdytojoKodas,
            row.projektoPavadinimas,
            row.atsakingaMinisterija,
            row.projektasSuPartneriais,
            row.sutartiesData,
            row.projektoVeikluPradziosData,
            row.projektoVeikluPabaigosData,
            row.egadpSubsidijos,
            row.egadpPaskolos,
            row.iperpfLesos,
            row.ipesfLesos,
            row.ipsaFLesos,
            row.iptpfLesos,
            row.bendrojoFinansavimo,
            row.lrBiudzetoLesos,
            row.lrvbEsFonduLesos,
            row.nuosavoInasoLesos,
            row.nuosavasInasasNetinkamam,
            row.isViso,
        ];

        await db.query(sql, values);
        count++;
    }
    return count;
}

async function insertCpvaProjektuSutartys(rows, db = postgres) {
    const sql = `
        INSERT INTO public."cpvaProjektuSutartys" (
            "projektoNr",
            "projektoPavadinimas",
            "arProjektasFinansuojamasEGADPLesoms",
            "pirkimoNrCvpis",
            "pirkimaVykdantisSubjektas",
            "pirkimoObjektas",
            "pirkimoSutartiesNr",
            "pirkimoSutartiesData",
            "pirkimoSutartiesSumaSusijusiSuProjektu",
            "tiekejoPavadinimasVardasIrPavardeGimimoData",
            "tiekejoKodas",
            "subtiekejoPavadinimasVardasIrPavardeGimimoData",
            "subtiekejoKodas"
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
    `;

    let count = 0;
    for (const row of rows) {
        const values = [
            row.projektoNr,
            row.projektoPavadinimas,
            row.arProjektasFinansuojamasEGADPLesoms,
            row.pirkimoNrCvpis,
            row.pirkimaVykdantisSubjektas,
            row.pirkimoObjektas,
            row.pirkimoSutartiesNr,
            row.pirkimoSutartiesData,
            row.pirkimoSutartiesSumaSusijusiSuProjektu,
            row.tiekejoPavadinimasVardasIrPavardeGimimoData,
            row.tiekejoKodas,
            row.subtiekejoPavadinimasVardasIrPavardeGimimoData,
            row.subtiekejoKodas,
        ];

        try {
            await db.query(sql, values);
            count++;
        } catch (err) {
            throw new Error(
                `Klaida įterpiant CPVA sutartį: projektoNr=${row.projektoNr}, ` +
                `sutartiesNr=${row.pirkimoSutartiesNr}: ${err.message}`,
                { cause: err },
            );
        }
    }
    return count;
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        await nuskaitytiCpvaProjektaiTiekejai();
        logger.log("Importavimas baigtas");
    } catch (err) {
        console.error("Klaida importuojant:", err);
        process.exitCode = 1;
    } finally {
        postgres.end();
    }
}

/*
Parsiunčia ir importuoja CPVA administruojamų projektų ir tiekėjų sąrašą
į `cpva` schemą.
*/

import * as XLSX from "xlsx";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { parseHTML } from "linkedom";
import config from "../../utils/config.js";
import { cpvaDocumentUrl, cpvaXlsxUrl } from "./sourceUrls.js";
import { parseCpvaWorkbook } from "./parseWorkbook.js";
import {
    insertPirkimuSutartys,
    insertProjektai,
    insertProjektuLesos,
    upsertZodynai,
} from "./normalizedStore.js";

const logger = new Logger();
const execFileAsync = promisify(execFile);

async function parsisiustiWorkbook() {
    const url = cpvaDocumentUrl(config.esInvesticijos2021Url);
    logger.log(`Nuskaitymas iš ${url}`);

    const { stdout: html } = await execFileAsync("curl", ["-k", "-fsSL", url]);
    const { document } = parseHTML(html);

    // Nuoroda puslapyje būna į viešą domeną — kelią perkeliame į tą patį mirror/proxy.
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
        { encoding: "buffer", maxBuffer: 1024 * 1024 * 250 },
    );
    logger.log(`Fetched ${filename}, size: ${fileBuffer.length} bytes`);

    return { workbook: XLSX.read(fileBuffer, { type: "buffer" }), filename };
}

async function assertMigratedSchema(client) {
    const { rows } = await client.query(
        `SELECT to_regclass('cpva."pirkimuSutartys"') IS NOT NULL AS migrated`,
    );
    if (!rows[0]?.migrated) {
        throw new Error(
            "CPVA DB schema neatnaujinta: paleiskite cpvaMigracija.sql",
        );
    }
}

export async function nuskaitytiCpvaProjektaiTiekejai() {
    const { workbook, filename } = await parsisiustiWorkbook();
    const { projects, contracts } = parseCpvaWorkbook(workbook);

    logger.log(
        `Paruošta importuoti: ${projects.length} projektų, ` +
        `${contracts.length} sutarčių eilučių`,
    );

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        await assertMigratedSchema(client);

        // CPVA failas yra visas aktualus snapshot, ne pakeitimų srautas.
        // Tranzakcija užtikrina, kad skaitytojai matys arba visą seną, arba
        // visą naują snapshot — niekada pusiau importuotą būseną. Žodynai
        // neišvalomi, kad organizacijų id nesikeistų tarp perskaitymų.
        await client.query(`DELETE FROM cpva."pirkimuSutartys"`);
        await client.query(`DELETE FROM cpva."projektuLesos"`);
        await client.query(`DELETE FROM cpva."projektai"`);

        const zodynai = await upsertZodynai(client, projects, contracts);
        const projectCount = await insertProjektai(client, projects, zodynai);
        const lesuCount = await insertProjektuLesos(client, projects, zodynai);
        const projektuNr = new Set(projects.map((row) => row.projektoNr));
        const contractCount = await insertPirkimuSutartys(
            client,
            contracts,
            zodynai,
            projektuNr,
        );

        await client.query("COMMIT");
        logger.log(
            `Importuota: ${projectCount} projektų, ${lesuCount} lėšų eilučių, ` +
            `${contractCount} sutarčių`,
        );
        return { projectCount, lesuCount, contractCount, filename };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
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

import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

function decodeXmlEntities(text) {
    if (!text) return "";
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, num) =>
            String.fromCharCode(parseInt(num, 10)),
        );
}

function normalizeLt(text) {
    return decodeXmlEntities(text)
        .replace(/&#044;/g, ",")
        .replace(/&#040;/g, "(")
        .replace(/&#041;/g, ")")
        .trim();
}

function computeMask(codeBase) {
    let mask = codeBase.replace(/\D/g, "");
    while (mask.length > 2 && mask.endsWith("0")) {
        mask = mask.slice(0, -1);
    }
    if (mask.length < 2) {
        mask = codeBase.replace(/\D/g, "").slice(0, 2);
    }
    return mask;
}

function parseCpvXml(xmlText) {
    const rows = [];
    const cpvRegex = /<CPV\s+CODE="([^"]+)">([\s\S]*?)<\/CPV>/g;
    let match;
    while ((match = cpvRegex.exec(xmlText))) {
        const codeAttr = match[1];
        const body = match[2];
        const codeDigits = (codeAttr || "").replace(/\D/g, "");
        if (codeDigits.length < 8) continue;
        const codeBase = codeDigits.slice(0, 8);

        const ltMatch = body.match(/<TEXT\s+LANG="LT">([\s\S]*?)<\/TEXT>/);
        if (!ltMatch) continue;

        const pavadinimas = normalizeLt(ltMatch[1]);
        const mask = computeMask(codeBase);
        const checksumMatch = codeAttr.match(/-(\d)$/);
        const checksum = checksumMatch ? checksumMatch[1] : codeDigits[8] || "";

        rows.push({
            mask,
            code: codeBase,
            checksum,
            pavadinimas,
        });
    }
    return rows;
}

async function bulkInsertRows(rows, client) {
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        if (!chunk.length) continue;

        const values = [];
        const placeholders = chunk.map((row, idx) => {
            const base = idx * 4;
            values.push(row.mask, row.code, row.checksum, row.pavadinimas);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });

        await client.query(
            `INSERT INTO "bvpzKodai" ("mask", "code", "checksum", "pavadinimas")
             VALUES ${placeholders.join(", ")}
             ON CONFLICT ("mask") DO UPDATE
             SET "code" = EXCLUDED."code",
                 "checksum" = EXCLUDED."checksum",
                 "pavadinimas" = EXCLUDED."pavadinimas";`,
            values,
        );
    }
}

async function readZipXml(zipPath) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (entries.length === 0) {
        throw new Error(`Zip has no entries: ${zipPath}`);
    }
    if (entries.length > 1) {
        throw new Error(
            `Zip has multiple entries, expected one: ${entries
                .map((e) => e.entryName)
                .join(", ")}`,
        );
    }
    const entry = entries[0];
    const data = entry.getData().toString("utf8");
    return data;
}

async function main() {
    const zipArg = process.argv[2];
    const importerDir = path.dirname(new URL(import.meta.url).pathname);
    const zipPath = zipArg
        ? path.resolve(process.cwd(), zipArg)
        : path.join(importerDir, "cpv.zip");

    try {
        await fs.access(zipPath);
    } catch {
        throw new Error(`cpv.zip not found at ${zipPath}`);
    }

    const xmlText = await readZipXml(zipPath);
    const rows = parseCpvXml(xmlText);

    if (!rows.length) {
        logger.log("No LT CPV entries found in XML.");
        return;
    }

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        await bulkInsertRows(rows, client);
        await client.query("COMMIT");
        logger.log(`Imported ${rows.length} LT CPV codes.`);
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
        await postgres.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

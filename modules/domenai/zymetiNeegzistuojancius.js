import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import fs from "fs";
import readline from "readline";

const [, , filename] = process.argv;

if (!filename) {
    console.error("Usage: node script.js <filename>");
    process.exit(1);
}

async function updateDomain(domain, lineNumber) {
    try {
        const res = await postgres.query(
            `SELECT "domregNuskaitymas" FROM domenai WHERE domain = $1`,
            [domain],
        );

        if (res.rowCount === 0) {
            log(`Line ${lineNumber}: ${domain} not found, skipping`);
            return;
        }

        const currentValue = res.rows[0].domregNuskaitymas;
        if (currentValue === 1) {
            log(`Line ${lineNumber}: ${domain} domregNuskaitymas=1, skipping`);
            return;
        }

        await postgres.query(
            `UPDATE domenai
             SET "domregNuskaitymas" = -404
             WHERE domain = $1`,
            [domain],
        );
        log(`Line ${lineNumber}: updated ${domain} to -404`);
    } catch (err) {
        console.error(
            `Line ${lineNumber}: error updating ${domain}`,
            err.message,
        );
    }
}

async function main() {
    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let lineNumber = 0;
    for await (const line of rl) {
        lineNumber++;
        const domain = line.trim();
        if (domain) {
            await updateDomain(domain, lineNumber);
        }
    }

    log("All domains processed.");
    await postgres.end();
}

await main().catch(console.error);

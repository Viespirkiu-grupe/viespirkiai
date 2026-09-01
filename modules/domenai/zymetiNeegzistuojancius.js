import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import fs from "fs";
import readline from "readline";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const [, , filename] = process.argv;

if (!filename) {
    console.error("Usage: node script.js <filename>");
    process.exit(1);
}

async function updateDomain(domain, lineNumber) {
    try {
        const res = await postgres.query(
            `SELECT "domregNuskaitymas" FROM domenai.domenai WHERE domain = $1`,
            [domain],
        );

        if (res.rowCount === 0) {
            logger.log(`Line ${lineNumber}: ${domain} not found, skipping`);
            return;
        }

        const currentValue = res.rows[0].domregNuskaitymas;
        if (currentValue === 1) {
            logger.log(`Line ${lineNumber}: ${domain} domregNuskaitymas=1, skipping`);
            return;
        }

        const updated = await postgres.query(
            `UPDATE domenai.domenai
             SET "domregNuskaitymas" = -404
             WHERE domain = $1`,
            [domain],
        );
        if (updated.rowCount > 0) {
            signalWork(WORK_SIGNALS.DOMENAI_ADP_READY, {
                source: "zymetiNeegzistuojancius",
                domain,
            });
        }
        logger.log(`Line ${lineNumber}: updated ${domain} to -404`);
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

    logger.log("All domains processed.");
    await postgres.end();
}

await main().catch(console.error);

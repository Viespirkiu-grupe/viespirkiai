import { postgres } from "../../postgres/postgres.js";
import fs from "fs";
import readline from "readline";
import { Logger } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
const logger = new Logger();

const [, , filename, saltinioPavadinimas] = process.argv;

if (!filename || !saltinioPavadinimas) {
    console.error("Usage: node script.js <filename> <saltinioPavadinimas>");
    process.exit(1);
}

async function upsertDomain(domain, lineNumber) {
    try {
        await postgres.query(
            // Šaltinių rinkinys dabar yra žodyne, tad naujas šaltinis
            // pridedamas ne prie masyvo vietoje, o suskaičiuojant naują
            // rinkinį ir paimant (ar sukuriant) jo id.
            `INSERT INTO domenai.domenai (domain, "radimoSaltiniaiId", created)
              VALUES ($1, domenai.saltiniai_id(ARRAY[$2]), NOW())
              ON CONFLICT (domain)
              DO UPDATE
              SET "radimoSaltiniaiId" = domenai.saltiniai_id(
                    COALESCE(
                      (SELECT CASE
                                WHEN $2 = ANY(e.saltiniai) THEN e.saltiniai
                                ELSE array_append(e.saltiniai, $2)
                              END
                         FROM domenai."radimoSaltiniai" e
                        WHERE e.id = domenai.domenai."radimoSaltiniaiId"),
                      ARRAY[$2])),
                  updated = NOW()`,
            [domain, saltinioPavadinimas],
        );
        signalWork(WORK_SIGNALS.DOMENAI_ADP_READY, {
            source: "insertDomains",
            domain,
        });
        logger.log(`Line ${lineNumber}: upserted ${domain}`);
    } catch (err) {
        console.error(
            `Line ${lineNumber}: error upserting ${domain}`,
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
            await upsertDomain(domain, lineNumber);
        }
    }

    logger.log("All domains processed.");
    await postgres.end();
}

await main().catch(console.error);

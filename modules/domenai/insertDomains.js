import { postgres } from "../../postgres/postgres.js";
import fs from "fs";
import readline from "readline";

const [, , filename, saltinioPavadinimas] = process.argv;

if (!filename || !saltinioPavadinimas) {
    console.error("Usage: node script.js <filename> <saltinioPavadinimas>");
    process.exit(1);
}

async function upsertDomain(domain, lineNumber) {
    try {
        await postgres.query(
            `INSERT INTO domenai (domain, "radimoSaltiniai", created)
              VALUES ($1, ARRAY[$2], NOW())
              ON CONFLICT (domain)
              DO UPDATE
              SET "radimoSaltiniai" =
                CASE
                  WHEN NOT ($2 = ANY(domenai."radimoSaltiniai"))
                  THEN array_append(domenai."radimoSaltiniai", $2)
                  ELSE domenai."radimoSaltiniai"
                END,
                updated = NOW()`,
            [domain, saltinioPavadinimas],
        );
        console.log(`Line ${lineNumber}: upserted ${domain}`);
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

    console.log("All domains processed.");
    await postgres.end();
}

await main().catch(console.error);

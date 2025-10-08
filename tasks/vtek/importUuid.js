/*
 * Sukelia UUID į VTEK lentelę
 * grep -hoE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' *.har | sort -u > uuids.txt
 */

import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";

const batch_size = 1000;

async function sukeltiUuid(failoPavadinimas) {
    const fileStream = fs.createReadStream(failoPavadinimas, "utf-8");
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let batch = [];
    let count = 0;

    for await (const line of rl) {
        const uuid = line.trim();
        if (!uuid) continue;
        batch.push(uuid);

        if (batch.length >= batch_size) {
            await insertBatch(batch);
            count += batch.length;
            batch = [];
        }
    }

    if (batch.length > 0) {
        await insertBatch(batch);
        count += batch.length;
    }

    console.log(`Inserted ${count} UUIDs (duplicates ignored).`);
}

async function insertBatch(batch) {
    // Build placeholders like ($1), ($2), ...
    const placeholders = batch.map((_, i) => `($${i + 1})`).join(", ");
    const query = `INSERT INTO vtek (uuid) VALUES ${placeholders} ON CONFLICT DO NOTHING;`;
    await postgres.query(query, batch);
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await sukeltiUuid("uuids.txt");
    process.exit(0);
}

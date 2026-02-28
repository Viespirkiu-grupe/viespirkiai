/*
 * Sukelia privačių interesų deklaracijų UUID iš failo uuids.txt į pinreg lentelę
 * UUID galima gauti iš paieškos puslapių requestų failų naudojant šią komandą (Linux):
 * grep -hoE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' *.har | sort -u > uuids.txt
 */

import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 1000;
const FILE_NAME = "uuids.txt";

async function sukeltiUuid(failoPavadinimas) {
    // Nuskaitome failą eilutė po eilutės
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

        // Įterpiame in batches
        if (batch.length >= BATCH_SIZE) {
            await insertBatch(batch);
            count += batch.length;
            batch = [];
        }
    }

    // Įterpiame likusius UUID
    if (batch.length > 0) {
        await insertBatch(batch);
        count += batch.length;
    }

    log(`Inserted ${count} UUIDs (duplicates ignored).`);
}

/**
 * Įterpia UUID batch į duomenų bazę
 * @param {string[]} batch - UUID batch
 */
async function insertBatch(batch) {
    const placeholders = batch.map((_, i) => `($${i + 1})`).join(", ");
    const query = `INSERT INTO pinreg (uuid) VALUES ${placeholders} ON CONFLICT DO NOTHING;`;
    await postgres.query(query, batch);
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await sukeltiUuid(FILE_NAME);
    process.exit(0);
}

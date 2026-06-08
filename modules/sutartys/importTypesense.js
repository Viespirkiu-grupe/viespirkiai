/*
Importuoja sutarčių duomenis iš PostgreSQL į Typesense paieškos sistemą (indeksą).
*/

import {
    addDocumentsToSearch,
    ensureSearchCollection,
} from "../../typesense/typesense.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

// Užtikrina, kad Typesense kolekcija "sutartys" egzistuoja
await ensureSearchCollection({ ignoreTypesenseUp: true });

// Po kiek įterpti ant karto
const BATCH_SIZE = 10_000;

const fromIdArg = process.argv.find((a) => a.startsWith("--from-id="));
const FROM_ID = fromIdArg ? Number(fromIdArg.split("=")[1]) : null;
if (FROM_ID !== null) log(`Starting from sutartiesUnikalusId >= ${FROM_ID}`);

/**
 * Užkrauna sutartis iš PostgreSQL duomenų bazės po dalis (batches).
 * @param {number} batchSize - Dalies dydis
 * @param {function} onBatch - Callback funkcija, kuri kviečiama kiekvienai daliai
 */
async function fetchSutartysBatches(batchSize, onBatch) {
    const client = await postgres.connect();
    try {
        let offset = 0;
        let batchNumber = 1;

        while (true) {
            const res = FROM_ID !== null
                ? await client.query(
                    `SELECT * FROM sutartys WHERE "sutartiesUnikalusId" >= $3 ORDER BY "sutartiesUnikalusId" ASC LIMIT $1 OFFSET $2`,
                    [batchSize, offset, FROM_ID],
                )
                : await client.query(
                    `SELECT * FROM sutartys ORDER BY "sutartiesUnikalusId" ASC LIMIT $1 OFFSET $2`,
                    [batchSize, offset],
                );
            if (res.rows.length === 0) break;

            // log progress for this batch
            log(
                `Processing batch #${batchNumber}, ${res.rows.length} rows, last ID: ${res.rows[res.rows.length - 1].sutartiesUnikalusId}`,
            );

            await onBatch(res.rows); // call callback on each batch

            offset += res.rows.length;
            batchNumber++;
        }
    } finally {
        client.release();
    }
}

/**
 * Importuoja sutartis į Typesense kolekciją "sutartys".
 */
async function importToTypesense() {
    await fetchSutartysBatches(BATCH_SIZE, async (batch) => {
        // Remove docs where istrinta = true
        batch = batch.filter((doc) => !doc.istrinta);
        await addDocumentsToSearch(batch);
        log(`Imported batch of ${batch.length} documents`);
    });
}

importToTypesense()
    .then(() => {
        log("All rows imported successfully!");
        postgres.end();
    })
    .catch((err) => {
        console.error("Error importing:", err);
        postgres.end();
    });

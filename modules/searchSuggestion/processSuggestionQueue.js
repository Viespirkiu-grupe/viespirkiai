/*
Procesina paieškos pasiūlymų (autocomplete) indeksavimo eilę į Typesense.

Apdoroja "searchSuggestionChanges" lentelę partijomis (batches): kiekvienas
įrašas žymi pakeitimą (insert/patch/delete), kurį reikia atspindėti Typesense
kolekcijoje "searchSuggestion". Maitinama "searchSuggestion.sql" trigerių.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    ensureSuggestionCollection,
    addSuggestionsToSearch,
    deleteSuggestionsFromSearch,
} from "../../typesense/typesense.js";

const BATCH_SIZE = 500;

let processed = 0;

async function fetchBatch(client) {
    const res = await client.query(
        `SELECT q."id" AS "queueId", q."suggestionId", q."keitimas",
                s."pavadinimas", s."saltinis", s."count"
         FROM "searchSuggestionChanges" q
         LEFT JOIN "searchSuggestion" s ON s."id" = q."suggestionId"
         ORDER BY q."id" ASC
         LIMIT $1`,
        [BATCH_SIZE],
    );
    return res.rows;
}

async function deleteQueueRows(client, queueIds) {
    if (queueIds.length === 0) return;
    await client.query(
        `DELETE FROM "searchSuggestionChanges" WHERE "id" = ANY($1)`,
        [queueIds],
    );
}

async function processBatch(client, rows) {
    const toIndex = [];
    const toDelete = [];
    const queueIds = [];

    for (const row of rows) {
        queueIds.push(row.queueId);
        if (row.keitimas === "delete" || row.pavadinimas === null) {
            // delete arba šaltinio eilutė jau ištrinta (LEFT JOIN -> null)
            toDelete.push(row.suggestionId.toString());
        } else {
            // insert arba patch
            toIndex.push({
                id: row.suggestionId,
                pavadinimas: row.pavadinimas,
                saltinis: row.saltinis,
                count: row.count,
            });
        }
    }

    // Indeksuojam (upsert), tada trinam — kad delete liktų galutinė būsena
    if (toIndex.length > 0) {
        await addSuggestionsToSearch(toIndex);
    }
    if (toDelete.length > 0) {
        await deleteSuggestionsFromSearch(toDelete);
    }

    // Pašalinam apdorotus eilės įrašus
    await deleteQueueRows(client, queueIds);
    processed += rows.length;
}

async function main() {
    await ensureSuggestionCollection({ ignoreTypesenseUp: true });

    const client = await postgres.connect();
    try {
        while (true) {
            const rows = await fetchBatch(client);
            if (rows.length === 0) break;
            await processBatch(client, rows);
            log(`Processed ${processed} queue rows so far...`);
        }
        log(`Done. Total processed: ${processed}`);
    } finally {
        client.release();
    }
}

main()
    .then(() => {
        log("Search suggestion queue processing complete.");
        postgres.end();
    })
    .catch((err) => {
        console.error("Error processing search suggestion queue:", err);
        postgres.end();
    });

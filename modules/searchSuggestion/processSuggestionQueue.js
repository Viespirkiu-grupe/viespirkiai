/*
Procesina paieškos pasiūlymų (autocomplete) indeksavimo eilę į Typesense.

Apdoroja searchSuggestion."pakeitimai" lentelę partijomis (batches): kiekvienas
įrašas žymi pakeitimą (insert/patch/delete), kurį reikia atspindėti Typesense
kolekcijoje "searchSuggestion" (kolekcijos vardas nesikeitė). Eilę pildo
searchSuggestion.track_changes() trigeris ant searchSuggestion."pasiulymai".
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    ensureSuggestionCollection,
    addSuggestionsToSearch,
    deleteSuggestionsFromSearch,
} from "../../typesense/typesense.js";

const BATCH_SIZE = 500;

let collectionReady = false;

async function fetchBatch(client) {
    const res = await client.query(
        `SELECT q."id" AS "queueId", q."suggestionId", q."keitimas",
                s."pavadinimas", s."saltinis", s."count"
         FROM "searchSuggestion"."pakeitimai" q
         LEFT JOIN "searchSuggestion"."pasiulymai" s ON s."id" = q."suggestionId"
         ORDER BY q."id" ASC
         LIMIT $1`,
        [BATCH_SIZE],
    );
    return res.rows;
}

async function deleteQueueRows(client, queueIds) {
    if (queueIds.length === 0) return;
    await client.query(
        `DELETE FROM "searchSuggestion"."pakeitimai" WHERE "id" = ANY($1)`,
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
}

/**
 * Apdoroja vieną eilės partiją. Grąžina `true` jei buvo darbo (dar gali būti),
 * `false` jei eilė tuščia — taip TaskRunner žino kada eiti į cooldown.
 */
export async function processSuggestionQueue() {
    if (!collectionReady) {
        await ensureSuggestionCollection({ ignoreTypesenseUp: true });
        collectionReady = true;
    }

    const rows = await fetchBatch(postgres);
    if (rows.length === 0) return false;

    await processBatch(postgres, rows);
    log(`Processed ${rows.length} search suggestion queue rows`);
    return true;
}

// CLI — nudreniruoja visą eilę ir baigia
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    while (await processSuggestionQueue()) {}
    log("Search suggestion queue processing complete.");
    await postgres.end();
    process.exit(0);
}

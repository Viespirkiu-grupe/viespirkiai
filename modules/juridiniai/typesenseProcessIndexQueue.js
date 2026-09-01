/*
Juridinių asmenų indeksavimo eilės nudreniravimas į Typesense.

Apdoroja "juridiniaiTypesenseQueue" partijomis. Eilę pildo tie patys trigeriai
ant public."juridiniai", kurie maitina ir Quickwit eilę (žr.
juridiniaiTypesenseQueue.sql), todėl abu indeksai mato tuos pačius pakeitimus.

Būsenos šaltinis yra pati lentelė, o ne eilės "keitimas" reikšmė: jei įrašo
public."juridiniai" nebėra, LEFT JOIN grąžina NULL ir dokumentas trinamas.

Kaip ir quickwit/indexQueueDrainer.js: eilutės pasiimamos su FOR UPDATE SKIP
LOCKED, indeksuojama dar neužbaigus transakcijos, ir tik tada trinamos bei
commit'inama. Klaidos atveju ROLLBACK grąžina jas į eilę — apdorojama bent kartą.
*/

import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    ensureJarCollection,
    addDocumentsToJarSearch,
    deleteJarFromSearch,
} from "../../typesense/typesense.js";
import { toBaseCompanyName } from "./pavadinimas.js";

const DEFAULT_BATCH_SIZE = 1_000;

let collectionReady = false;

async function claimQueueRows(client, batchSize) {
    const { rows } = await client.query(
        `SELECT "id", "jarKodas"
         FROM public."juridiniaiTypesenseQueue"
         ORDER BY "id" ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize],
    );
    return rows;
}

async function fetchJuridiniai(client, jarKodai) {
    const { rows } = await client.query(
        `SELECT j."jarKodas",
                j."pavadinimas",
                j."adresas",
                j."registravimoData",
                j."isregistruotas",
                f."pavadinimas" AS "formosPavadinimas",
                s."pavadinimas" AS "statusoPavadinimas"
         FROM public."juridiniai" j
         LEFT JOIN public."juridiniaiFormos" f ON f."kodas" = j."formosKodas"
         LEFT JOIN public."juridiniaiStatusai" s ON s."kodas" = j."statusoKodas"
         WHERE j."jarKodas" = ANY($1::text[])`,
        [jarKodai],
    );
    return rows;
}

/**
 * Suformuoja Typesense dokumentą iš public."juridiniai" eilutės.
 * @param {Object} row - Užklausos eilutė su formos/statuso pavadinimais
 */
export function buildDoc(row) {
    return {
        jarKodas: String(row.jarKodas),
        pavadinimas: row.pavadinimas,
        pavadinimasBase: toBaseCompanyName(row.pavadinimas),
        adresas: row.adresas,
        registravimoData: row.registravimoData,
        isregistruotas: row.isregistruotas,
        formosPavadinimas: row.formosPavadinimas,
        statusoPavadinimas: row.statusoPavadinimas,
    };
}

/**
 * Vienos partijos apdorojimas: ką upsert'inti, ką trinti.
 * Tas pats jarKodas eilėje gali pasitaikyti kelis kartus, todėl dirbama su
 * unikaliais kodais — į Typesense keliauja vienas dokumentas vietoj kelių vienodų.
 * @param {Object[]} claimed - Užrakintos eilės eilutės
 * @param {Object[]} rows - Rastos public."juridiniai" eilutės
 */
export function splitBatch(claimed, rows) {
    const esami = new Map(rows.map((row) => [String(row.jarKodas), row]));
    const kodai = new Set(claimed.map((row) => String(row.jarKodas)));

    const toIndex = [];
    const toDelete = [];
    for (const jarKodas of kodai) {
        const row = esami.get(jarKodas);
        if (row) toIndex.push(buildDoc(row));
        else toDelete.push(jarKodas);
    }
    return { toIndex, toDelete };
}

/**
 * Apdoroja vieną eilės partiją. Grąžina `true` jei buvo darbo (dar gali būti),
 * `false` jei eilė tuščia — taip TaskRunner žino kada eiti į cooldown.
 * @param {{ batchSize?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function processJuridiniaiTypesenseQueue(
    { batchSize = DEFAULT_BATCH_SIZE } = {},
    db = postgres,
) {
    if (!collectionReady) {
        await ensureJarCollection({ ignoreTypesenseUp: true });
        collectionReady = true;
    }

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const claimed = await claimQueueRows(client, batchSize);
        if (claimed.length === 0) {
            await client.query("COMMIT");
            return false;
        }

        const jarKodai = [...new Set(claimed.map((row) => String(row.jarKodas)))];
        const rows = await fetchJuridiniai(client, jarKodai);
        const { toIndex, toDelete } = splitBatch(claimed, rows);

        // Pirma indeksuojam, paskui trinam — kad delete liktų galutinė būsena.
        if (toIndex.length > 0) await addDocumentsToJarSearch(toIndex);
        if (toDelete.length > 0) await deleteJarFromSearch(toDelete);

        await client.query(
            `DELETE FROM public."juridiniaiTypesenseQueue"
             WHERE "id" = ANY($1::bigint[])`,
            [claimed.map((row) => row.id)],
        );
        await client.query("COMMIT");

        log(
            `Typesense juridiniai: ${toIndex.length} atnaujinti, ` +
                `${toDelete.length} ištrinti (${claimed.length} eilės įrašų)`,
        );
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// CLI — nudreniruoja visą eilę ir baigia
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    while (await processJuridiniaiTypesenseQueue()) {}
    log("Juridinių asmenų Typesense eilė apdorota.");
    await postgres.end();
    process.exit(0);
}

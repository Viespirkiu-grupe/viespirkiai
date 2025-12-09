/*
Importuoja sutarčių duomenis iš PostgreSQL į Typesense paieškos sistemą (indeksą).
*/

import {
    client as typesenseClient,
    ensureSearchCollection,
} from "../../typesense/typesense.js";
import { postgres } from "../../postgres/postgres.js";

/**
 * Konvertuoja datą į Unix timestamp (sekundėmis nuo 1970-01-01).
 * @param {Date|string} date - Data, kurią reikia konvertuoti
 * @returns {number} Unix timestamp
 */
function toUnixTimestamp(date) {
    const ts = new Date(date).getTime();
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

// Užtikrina, kad Typesense kolekcija "sutartys" egzistuoja
await ensureSearchCollection();

// Po kiek įterpti ant karto
const BATCH_SIZE = 10_000;

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
            const res = await client.query(
                `SELECT * FROM sutartys ORDER BY "sutartiesUnikalusId" ASC LIMIT $1 OFFSET $2`,
                [batchSize, offset],
            );
            if (res.rows.length === 0) break;

            // log progress for this batch
            console.log(
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
        const formattedDocs = batch.map((doc) => {
            return {
                id: doc.sutartiesUnikalusId?.toString() || "",
                tipas: doc.tipas || "",
                pavadinimas: doc.pavadinimas || "",
                kategorija: doc.kategorija || "",
                perkanciojiOrganizacija: doc.perkanciojiOrganizacija || "",
                perkanciosiosOrganizacijosKodas:
                    doc.perkanciosiosOrganizacijosKodas || "",
                tiekejas: doc.tiekejas || "",
                tiekejoKodas: doc.tiekejoKodas || "",
                verte: typeof doc.verte === "number" ? doc.verte : 0,
                faktineIvykdimoVerte:
                    typeof doc.faktineIvykdimoVerte === "number"
                        ? doc.faktineIvykdimoVerte
                        : 0,
                sudarymoData: toUnixTimestamp(doc.sudarymoData),
                galiojimoData: toUnixTimestamp(doc.galiojimoData),
                paskelbimoData: toUnixTimestamp(doc.paskelbimoData),
                paskutinioAtnaujinimoData: toUnixTimestamp(
                    doc.paskutinioAtnaujinimoData,
                ),
                paskutinioRedagavimoData: toUnixTimestamp(
                    doc.paskutinioRedagavimoData,
                ),
                faktineIvykdimoData: toUnixTimestamp(doc.faktineIvykdimoData),
                bvpzKodas: doc.bvpzKodas || "",
                bvpzPavadinimas: doc.bvpzPavadinimas || "",
                sutartiesNumeris: doc.sutartiesNumeris || "",
                sutartiesUnikalusId: Number(doc.sutartiesUnikalusId),
                dokumentuKiekis: doc.dokumentuKiekis || 0,
                pirkimoNumeris: doc.pirkimoNumeris || "",
                papildomiTiekejai: doc.papildomiTiekejai || [],
                papildomiTiekejaiKodai: doc.papildomiTiekejaiKodai || [],
                papildomiBvpzKodai: doc.papildomiBvpzKodai || [],
                papildomiBvpzPavadinimai: doc.papildomiBvpzPavadinimai || [],
                paskutiniKartaMatyta: toUnixTimestamp(doc.paskutiniKartaMatyta),
            };
        });

        await typesenseClient
            .collections("sutartys")
            .documents()
            .import(formattedDocs, { action: "upsert" });

        console.log(`Imported batch of ${formattedDocs.length} documents`);
    });
}

importToTypesense()
    .then(() => {
        console.log("All rows imported successfully!");
        postgres.end();
    })
    .catch((err) => {
        console.error("Error importing:", err);
        postgres.end();
    });

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
if (FROM_ID !== null && !Number.isSafeInteger(FROM_ID)) {
  throw new TypeError("--from-id must be a safe integer");
}
if (FROM_ID !== null) log(`Starting from sutartiesUnikalusId >= ${FROM_ID}`);

const SELECT_FIELDS = [
  '"sutartiesUnikalusId"',
  "tipas",
  "pavadinimas",
  '"perkanciojiOrganizacija"',
  '"perkanciosiosOrganizacijosKodas"',
  "tiekejas",
  '"tiekejoKodas"',
  "verte",
  '"faktineIvykdimoVerte"',
  '"dokumentuKiekis"',
  '"paskutinioRedagavimoData"',
  '"sudarymoData"',
  '"paskelbimoData"',
  '"bvpzPavadinimas"',
  '"sutartiesNumeris"',
  '"papildomiTiekejai"',
  '"papildomiTiekejaiKodai"',
  '"papildomiBvpzPavadinimai"',
  '"pirkimoNumeris"',
].join(", ");

/**
 * Užkrauna sutartis iš PostgreSQL duomenų bazės po dalis (batches).
 * @param {number} batchSize - Dalies dydis
 * @param {function} onBatch - Callback funkcija, kuri kviečiama kiekvienai daliai
 */
async function fetchSutartysBatches(batchSize, onBatch) {
  const client = await postgres.connect();
  try {
    let batchNumber = 1;
    const initialIdFilter =
      FROM_ID === null ? "" : 'AND "sutartiesUnikalusId" >= $2';
    const initialParams = FROM_ID === null ? [batchSize] : [batchSize, FROM_ID];
    let res = await client.query(
      `SELECT ${SELECT_FIELDS}
             FROM sutartys
             WHERE COALESCE(istrinta, false) = false
               ${initialIdFilter}
             ORDER BY "sutartiesUnikalusId" ASC
             LIMIT $1`,
      initialParams,
    );

    while (res.rows.length > 0) {
      const afterId = res.rows[res.rows.length - 1].sutartiesUnikalusId;
      log(
        `Processing batch #${batchNumber}, ${res.rows.length} rows, last ID: ${afterId}`,
      );

      // PostgreSQL is the slower side, so overlap the next fetch with the
      // current Typesense upsert while keeping only one batch buffered.
      const nextBatch = client.query(
        `SELECT ${SELECT_FIELDS}
                 FROM sutartys
                 WHERE COALESCE(istrinta, false) = false
                   AND "sutartiesUnikalusId" > $2
                 ORDER BY "sutartiesUnikalusId" ASC
                 LIMIT $1`,
        [batchSize, afterId],
      );
      const results = await Promise.allSettled([nextBatch, onBatch(res.rows)]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;

      batchNumber++;
      res = results[0].value;
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

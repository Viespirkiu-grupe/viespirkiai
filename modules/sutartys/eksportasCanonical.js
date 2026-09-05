/**
 * Sutarčių eksportas standartine canonical schema (schemas/sutartis.schema.json)
 * forma. Naudoja tą pačią SQL logiką (DOC_JSONB_SQL/DOC_JOINS_SQL), kuri
 * upsertVpmSutartis.js atstato canonical dokumentą iš normalizuotų vpm lentelių
 * (naudojama pakeitimų archyvavimui ir markVpmSutartisIstrinta), todėl dump'as
 * visada atitinka tą pačią schemą, kuria tikrinamas rašymas.
 *
 * Naudojama: modules/sutartys/eksportuotiCanonicalJsonl.js
 */
import { postgres } from "../../postgres/postgres.js";
import { DOC_JOINS_SQL, DOC_JSONB_SQL } from "./upsertVpmSutartis.js";

export const DEFAULT_BATCH_SIZE = 1000;

export async function fetchCanonicalBatch(afterId, batchSize = DEFAULT_BATCH_SIZE) {
    const { rows } = await postgres.query(
        `SELECT ${DOC_JSONB_SQL} AS doc
         FROM "vpmSutartys"."sutartys" e
         ${DOC_JOINS_SQL}
         WHERE e."unikalusId" > $1
         ORDER BY e."unikalusId" ASC
         LIMIT $2`,
        [afterId, batchSize],
    );
    return rows;
}

/**
 * Async generator: iteruoja per visas sutartis batch'ais ir grąžina
 * `{ rows, afterId }`, kur kiekvienas `rows[i].doc` yra pilnas canonical
 * dokumentas.
 */
export async function* iterateCanonicalBatches({ batchSize = DEFAULT_BATCH_SIZE, startAfterId = 0 } = {}) {
    let afterId = startAfterId;
    while (true) {
        const rows = await fetchCanonicalBatch(afterId, batchSize);
        if (!rows.length) return;
        afterId = Number(rows[rows.length - 1].doc.unikalusId);
        yield { rows, afterId };
    }
}

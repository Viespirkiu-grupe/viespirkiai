import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

const QW_URL = config.quickwitUrl;

/**
 * Get dead ratio for a table across all shards.
 * Used to estimate live hit count from Quickwit's total.
 */
async function getDeadRatio(lentele) {
  const { rows } = await postgres.query(
    `SELECT
       SUM("gyvosEilutes") AS gyva,
       SUM("mirusiosEilutes") AS mirusi
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1`,
    [lentele]
  );
  const { gyva, mirusi } = rows[0];
  const total = Number(gyva) + Number(mirusi);
  if (!total) return 0;
  return Number(mirusi) / total;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function qwGet(path) {
  const res = await fetch(`${QW_URL}${path}`);
  if (!res.ok) throw new Error(`Quickwit GET ${path} → ${res.status}`);
  return res.json();
}

async function qwCreateIndex(yaml) {
  const res = await fetch(`${QW_URL}/api/v1/indexes`, {
    method: "POST",
    headers: { "Content-Type": "application/yaml" },
    body: yaml,
  });
  if (!res.ok)
    throw new Error(`Quickwit create index → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function qwIngestNdjson(indeksas, docs) {
  const body = docs.map((d) => JSON.stringify(d)).join("\n");
  const res = await fetch(`${QW_URL}/api/v1/${indeksas}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body,
  });
  if (!res.ok)
    throw new Error(`Quickwit ingest ${indeksas} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function qwSearch(indeksas, params) {
  const res = await fetch(`${QW_URL}/api/v1/${indeksas}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok)
    throw new Error(`Quickwit search ${indeksas} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Index creation ───────────────────────────────────────────────────────────

async function ensureQuickwitIndex(indeksas, indexConfig) {
  try {
    await qwGet(`/api/v1/indexes/${indeksas}`);
  } catch {
    const yaml = indexConfig.replace(/^index_id:.*$/m, `index_id: ${indeksas}`);
    await qwCreateIndex(yaml);
  }
}

// ── Shard management ─────────────────────────────────────────────────────────

/**
 * Returns the indeksas of the current active shard, creating one if needed.
 * Must be called within an open transaction with the advisory lock held.
 */
async function getOrCreateActiveShard(lentele, client) {
  const { rows } = await client.query(
    `SELECT "indeksas"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1
       AND "gyvosEilutes" < "shardSize"
     ORDER BY "seq" DESC
     LIMIT 1`,
    [lentele]
  );

  if (rows.length) return rows[0].indeksas;

  const { rows: cfg } = await client.query(
    `SELECT "defaultShardSize", "indexConfig"
     FROM "quickwitLenteles"
     WHERE "lentele" = $1`,
    [lentele]
  );
  if (!cfg.length) throw new Error(`Unknown lentele: ${lentele}`);
  const { defaultShardSize, indexConfig } = cfg[0];

  const { rows: seqRows } = await client.query(
    `SELECT COALESCE(MAX("seq"), 0) + 1 AS "nextSeq"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1`,
    [lentele]
  );
  const nextSeq = seqRows[0].nextSeq;
  const indeksas = `${lentele}_${nextSeq}`;

  await client.query(
    `INSERT INTO "quickwitIndeksai"("lentele", "seq", "shardSize", "indexConfig")
     VALUES ($1, $2, $3, $4)`,
    [lentele, nextSeq, defaultShardSize, indexConfig]
  );

  // Outside transaction — Quickwit is not transactional
  await ensureQuickwitIndex(indeksas, indexConfig);

  return indeksas;
}

// ── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Index a single document.
 *
 * @param {string} lentele
 * @param {string} eilutesId  - source row ID as string
 * @param {object} doc        - fields to push; quickwitId injected automatically
 */
export async function indexDoc(lentele, eilutesId, doc) {
  return indexDocs(lentele, [{ eilutesId, doc }]);
}

/**
 * Batch index multiple documents from the same table.
 *
 * @param {string} lentele
 * @param {{ eilutesId: string, doc: object }[]} items
 */
export async function indexDocs(lentele, items) {
  if (!items.length) return;

  const byEilutesId = new Map(items.map((i) => [i.eilutesId, i.doc]));
  const eilutesIds = [...byEilutesId.keys()];

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      [lentele]
    );

    // ── Fetch existing rows ──────────────────────────────────────────────────
    const { rows: existing } = await client.query(
      `SELECT "eilutesId", "indeksas"
       FROM "quickwitEilutes"
       WHERE "lentele" = $1 AND "eilutesId" = ANY($2)`,
      [lentele, eilutesIds]
    );

    const existingMap = new Map(existing.map((r) => [r.eilutesId, r.indeksas]));
    const toInsert = eilutesIds.filter((id) => !existingMap.has(id));
    const toUpdate = eilutesIds.filter((id) => existingMap.has(id));

    // ── Assign a UUID to every item ──────────────────────────────────────────
    // Map<eilutesId, { quickwitId, indeksas, doc }>
    const assigned = new Map();

    for (const eilutesId of toUpdate) {
      assigned.set(eilutesId, {
        quickwitId: crypto.randomUUID(),
        indeksas: existingMap.get(eilutesId),
        doc: byEilutesId.get(eilutesId),
      });
    }

    // One shard for the entire insert batch — going slightly over shardSize is fine
    if (toInsert.length) {
      const indeksas = await getOrCreateActiveShard(lentele, client);
      for (const eilutesId of toInsert) {
        assigned.set(eilutesId, {
          quickwitId: crypto.randomUUID(),
          indeksas,
          doc: byEilutesId.get(eilutesId),
        });
      }
    }

    // ── Batch UPDATE quickwitEilutes for re-indexed rows ─────────────────────
    if (toUpdate.length) {
      // UPDATE ... FROM (VALUES ...) — single query regardless of batch size
      const vals = toUpdate
        .map((id, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::uuid)`)
        .join(", ");
      const params = toUpdate.flatMap((id) => [id, assigned.get(id).quickwitId]);

      await client.query(
        `UPDATE "quickwitEilutes" AS qe
         SET "quickwitId" = v."quickwitId"
         FROM (VALUES ${vals}) AS v("eilutesId", "quickwitId")
         WHERE qe."lentele" = $${params.length + 1}
           AND qe."eilutesId" = v."eilutesId"`,
        [...params, lentele]
      );

      // Batch increment mirusiosEilutes per shard
      // Group updates by indeksas
      const deadByShard = new Map();
      for (const eilutesId of toUpdate) {
        const indeksas = existingMap.get(eilutesId);
        deadByShard.set(indeksas, (deadByShard.get(indeksas) ?? 0) + 1);
      }

      await Promise.all(
        [...deadByShard.entries()].map(([indeksas, count]) =>
          client.query(
            `UPDATE "quickwitIndeksai"
             SET "mirusiosEilutes" = "mirusiosEilutes" + $2
             WHERE "indeksas" = $1`,
            [indeksas, count]
          )
        )
      );
    }

    // ── Batch INSERT quickwitEilutes for new rows ────────────────────────────
    if (toInsert.length) {
      const indeksas = assigned.get(toInsert[0]).indeksas;

      const vals = toInsert
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::uuid)`)
        .join(", ");
      const params = toInsert.flatMap((id) => [id, assigned.get(id).quickwitId]);

      await client.query(
        `INSERT INTO "quickwitEilutes"("lentele", "eilutesId", "indeksas", "quickwitId")
         SELECT $${params.length + 1}, v."eilutesId", $${params.length + 2}, v."quickwitId"
         FROM (VALUES ${vals}) AS v("eilutesId", "quickwitId")`,
        [...params, lentele, indeksas]
      );

      await client.query(
        `UPDATE "quickwitIndeksai"
         SET "gyvosEilutes" = "gyvosEilutes" + $2
         WHERE "indeksas" = $1`,
        [indeksas, toInsert.length]
      );
    }

    await client.query("COMMIT");

    // ── Ingest into Quickwit — group by shard ────────────────────────────────
    const shardDocs = new Map();
    for (const { quickwitId, indeksas, doc } of assigned.values()) {
      if (!shardDocs.has(indeksas)) shardDocs.set(indeksas, []);
      shardDocs.get(indeksas).push({ ...doc, quickwitId });
    }

    await Promise.all(
      [...shardDocs.entries()].map(([indeksas, docs]) =>
        qwIngestNdjson(indeksas, docs)
      )
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Staleness filter ─────────────────────────────────────────────────────────

/**
 * Given Quickwit search hits, return only those whose quickwitId is still live.
 *
 * @param {{ quickwitId: string, [key: string]: any }[]} hits
 */
export async function filterLive(hits) {
  if (!hits.length) return [];

  const ids = hits.map((h) => h.quickwitId);
  const { rows } = await postgres.query(
    `SELECT "quickwitId" FROM "quickwitEilutes" WHERE "quickwitId" = ANY($1)`,
    [ids]
  );
  const live = new Set(rows.map((r) => r.quickwitId));
  return hits.filter((h) => live.has(h.quickwitId));
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search across all shards of a table, filtering dead hits, fetching more if needed.
 *
 * @param {string} lentele
 * @param {object} params                - Quickwit search body
 * @param {object} [opts]
 * @param {number} [opts.minHits]        - minimum live hits to return; fetches additional
 *                                         pages if needed. Defaults to Infinity (all results)
 * @returns {Promise<{
 *   hits: object[],
 *   numHitsMax: number,                 - raw Quickwit total (includes dead)
 *   numHitsEstimate: number,            - estimated live total based on dead ratio
 *   deadRatio: number,                  - ratio of dead rows
 * }>}
 */
export async function search(lentele, params, { minHits = Infinity } = {}) {
    const deadRatio = await getDeadRatio(lentele);
    const fetchSize = Number.isFinite(minHits)
        ? Math.ceil(minHits / (1 - deadRatio || 1)) + 10
        : 100; // page size when fetching all

    let liveHits = [];
    let searchAfter = null;
    let numHitsMax = null;

    let requests = 0;
    let totalElapsed = 0;
    while (liveHits.length < minHits) {
        requests++;
        const reqParams = {
            ...params,
            max_hits: fetchSize,
            ...(searchAfter ? { search_after: searchAfter } : {}),
        };

        const data = await qwSearch(`${lentele}_*`, reqParams);
        totalElapsed += data.elapsed_time_micros ?? 0;
        const hits = data.hits ?? [];

        if (numHitsMax === null) numHitsMax = data.num_hits ?? 0;

        const live = await filterLive(hits);
        liveHits.push(...live);

        if (hits.length < fetchSize) break;

        searchAfter = hits[hits.length - 1].sort ?? null;
        if (!searchAfter) break;
    }

    return {
        hits: liveHits,
        numHitsMax,
        numHitsEstimate: numHitsMax * (1 - deadRatio),
        deadRatio,
        elapsedTimeMicros: totalElapsed,
        requests
    };
}

// ── Shard stats ───────────────────────────────────────────────────────────────

export async function shardStats(lentele) {
  const { rows } = await postgres.query(
    `SELECT
       "indeksas",
       "seq",
       "shardSize",
       "gyvosEilutes",
       "mirusiosEilutes",
       ROUND(
         "mirusiosEilutes"::numeric
         / NULLIF("gyvosEilutes" + "mirusiosEilutes", 0)
         * 100,
         1
       ) AS "mirusiuProc"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1
     ORDER BY "seq"`,
    [lentele]
  );
  return rows;
}
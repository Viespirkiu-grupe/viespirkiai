import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

const QW_URL = config.quickwitUrl ?? config.quickwitHost ?? "http://localhost:7280";

// ── Dead-ratio cache ─────────────────────────────────────────────────────────
// The ratio mirusios/(gyvos+mirusios) is only used to decide how many hits to
// over-fetch from Quickwit so we can skip tombstones. It's stable between
// compactions, so we cache it briefly to avoid a Postgres roundtrip on every
// search. 60s is a pragmatic tradeoff: long enough to amortize well, short
// enough that fresh ingest activity is reflected quickly.
const _deadRatioCache = new Map(); // lentele → { value, expiresAt }

async function getDeadRatio(lentele) {
  const cached = _deadRatioCache.get(lentele);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const { rows } = await postgres.query(
    `SELECT
       SUM("gyvosEilutes")     AS gyva,
       SUM("mirusiosEilutes")  AS mirusi
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1`,
    [lentele]
  );
  const { gyva, mirusi } = rows[0];
  const total = Number(gyva) + Number(mirusi);
  const value = total ? Number(mirusi) / total : 0;
  _deadRatioCache.set(lentele, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

// ── Quickwit HTTP helpers ────────────────────────────────────────────────────

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
  const text = await res.text();
  const parsed = JSON.parse(text);

  if (!res.ok) throw new Error(`Quickwit search ${indeksas} → ${res.status}: ${text}`);
  return parsed;
}

// ── Index creation ───────────────────────────────────────────────────────────

async function ensureQuickwitIndex(indeksas, indexConfig) {
  try {
    await qwGet(`/api/v1/indexes/${indeksas}`);
  } catch {
    // Rewrite the index_id in the YAML so every shard gets its own Quickwit
    // index while sharing the same schema blob in quickwitLenteles.
    const yaml = indexConfig.replace(/^index_id:.*$/m, `index_id: ${indeksas}`);
    await qwCreateIndex(yaml);
  }
}

// ── Shard management ─────────────────────────────────────────────────────────

/**
 * Return the indeksas of a shard that can accept new inserts, creating one if
 * none has room. "current = true" marks shards whose schema matches the latest
 * indexConfig — older non-current shards keep accepting re-indexes for rows
 * they already hold, but new rows only land on current shards.
 *
 * Must be called inside a transaction that already holds the per-lentele
 * advisory lock, so concurrent writers can't race on shard creation.
 *
 * @param {string} lentele
 * @param {import('pg').PoolClient} client
 * @returns {Promise<string>} indeksas
 */
async function getOrCreateActiveShard(lentele, client) {
  // iterptosEilutes is monotonic (every Quickwit ingest event bumps it), so
  // it's the right "has this shard been filled?" signal. gyvos + mirusios
  // would also work but requires reading the generated column.
  const { rows } = await client.query(
    `SELECT "indeksas"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1
       AND "iterptosEilutes" < "shardSize"
       AND "current" = true
     ORDER BY "seq" DESC
     LIMIT 1`,
    [lentele]
  );

  if (rows.length) return rows[0].indeksas;

  // No current shard has room — create a fresh one.
  const { rows: cfg } = await client.query(
    `SELECT "defaultShardSize", "indexConfig", "indexConfigHash"
     FROM "quickwitLenteles"
     WHERE "lentele" = $1`,
    [lentele]
  );
  if (!cfg.length) throw new Error(`Unknown lentele: ${lentele}`);
  const { defaultShardSize, indexConfig, indexConfigHash } = cfg[0];

  const { rows: seqRows } = await client.query(
    `SELECT COALESCE(MAX("seq"), 0) + 1 AS "nextSeq"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1`,
    [lentele]
  );
  const nextSeq = seqRows[0].nextSeq;
  const indeksas = `${lentele}_${nextSeq}`;

  await client.query(
    `INSERT INTO "quickwitIndeksai"
       ("lentele", "seq", "shardSize", "indexConfig", "indexConfigHash", "current")
     VALUES ($1, $2, $3, $4, $5, true)`,
    [lentele, nextSeq, defaultShardSize, indexConfig, indexConfigHash]
  );

  // Quickwit is not transactional with Postgres; create the index after the
  // insert. If this fails, a later retry will see the row already exists and
  // just try the index create again. Idempotent by design.
  await ensureQuickwitIndex(indeksas, indexConfig);

  return indeksas;
}

// ── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Index a single document. Thin wrapper around indexDocs.
 */
export async function indexDoc(lentele, eilutesId, doc) {
  return indexDocs(lentele, [{ eilutesId, doc }]);
}

/**
 * Batch-index multiple documents from the same table.
 *
 * Per-row behaviour:
 *   - NEW eilutesId: INSERT into quickwitEilutes on the current shard.
 *   - EXISTING on a current shard: UPDATE quickwitEilutes (rotate quickwitId
 *     in place). The old quickwitId becomes a tombstone once the new doc
 *     lands in Quickwit.
 *   - EXISTING on a non-current shard: migrate — UPDATE quickwitEilutes to
 *     point at the active current shard with a fresh quickwitId.
 *
 * Counter ownership split:
 *   - gyvosEilutes (live row count per shard) is maintained by statement-
 *     level triggers on quickwitEilutes. The triggers watch INSERT/UPDATE/
 *     DELETE and aggregate deltas per shard.
 *   - iterptosEilutes (cumulative Quickwit ingest events per shard) is bumped
 *     by THIS code, right after a successful Quickwit ingest. iterptos means
 *     literally "how many docs we've ingested into this shard's Quickwit
 *     index", which is a count this layer owns.
 *   - mirusiosEilutes is a generated column (iterptos - gyvos).
 *
 * @param {string} lentele
 * @param {{ eilutesId: string, doc: object }[]} items
 */
export async function indexDocs(lentele, items) {
  if (!items.length) return;

  const t0 = Date.now();
  const timings = {};
  const mark = (phase, since) => { timings[phase] = Date.now() - since; };

  const byEilutesId = new Map(items.map((i) => [i.eilutesId, i.doc]));
  const eilutesIds = [...byEilutesId.keys()];

  const client = await postgres.connect();
  mark("connect", t0);

  try {
    const tTx = Date.now();
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      [lentele]
    );
    mark("beginAndLock", tTx);

    // ── Figure out which ids are new vs. existing ───────────────────────────
    const tExisting = Date.now();
    const { rows: existing } = await client.query(
      `SELECT "eilutesId", "indeksas"
       FROM "quickwitEilutes"
       WHERE "lentele" = $1 AND "eilutesId" = ANY($2)`,
      [lentele, eilutesIds]
    );
    mark("selectExisting", tExisting);

    const existingMap = new Map(existing.map((r) => [r.eilutesId, r.indeksas]));
    const toInsert = eilutesIds.filter((id) => !existingMap.has(id));
    const toUpdate = eilutesIds.filter((id) => existingMap.has(id));

    // assigned: eilutesId → { quickwitId, oldIndeksas, indeksas, doc }
    const assigned = new Map();
    let currentShard = null;

    // ── Resolve target shard for updates ────────────────────────────────────
    // Every re-index goes to the newest active shard. Old shards retain rows
    // only until those rows are touched again; once touched, they migrate
    // forward. This keeps hot data concentrated on recent shards and lets
    // older ones drain naturally over time.
    const tAssignUpdates = Date.now();
    if (toUpdate.length) {
      currentShard ??= await getOrCreateActiveShard(lentele, client);
      for (const eilutesId of toUpdate) {
        assigned.set(eilutesId, {
          quickwitId: crypto.randomUUID(),
          oldIndeksas: existingMap.get(eilutesId),
          indeksas: currentShard,
          doc: byEilutesId.get(eilutesId),
        });
      }
    }
    mark("assignUpdates", tAssignUpdates);

    // ── Resolve target shard for inserts ────────────────────────────────────
    const tAssignInserts = Date.now();
    if (toInsert.length) {
      currentShard ??= await getOrCreateActiveShard(lentele, client);
      for (const eilutesId of toInsert) {
        assigned.set(eilutesId, {
          quickwitId: crypto.randomUUID(),
          oldIndeksas: null,
          indeksas: currentShard,
          doc: byEilutesId.get(eilutesId),
        });
      }
    }
    mark("assignInserts", tAssignInserts);

    // ── Batch UPDATE quickwitEilutes for existing rows ──────────────────────
    // Split into stayed (same shard, rotate quickwitId) and moved (migration
    // across shards). Two statements so the stayed path only rewrites the
    // quickwitId column. The trigger on quickwitEilutes handles gyvos.
    let stayedCount = 0;
    let movedCount = 0;
    const tUpdate = Date.now();
    if (toUpdate.length) {
      const stayed = toUpdate.filter((id) => {
        const a = assigned.get(id);
        return a.indeksas === a.oldIndeksas;
      });
      const moved = toUpdate.filter((id) => {
        const a = assigned.get(id);
        return a.indeksas !== a.oldIndeksas;
      });
      stayedCount = stayed.length;
      movedCount = moved.length;

      if (stayed.length) {
        const tStayed = Date.now();
        const vals = stayed
          .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::uuid)`)
          .join(", ");
        const params = stayed.flatMap((id) => [id, assigned.get(id).quickwitId]);
        await client.query(
          `UPDATE "quickwitEilutes" AS qe
           SET "quickwitId" = v."quickwitId"
           FROM (VALUES ${vals}) AS v("eilutesId", "quickwitId")
           WHERE qe."lentele" = $${params.length + 1}
             AND qe."eilutesId" = v."eilutesId"`,
          [...params, lentele]
        );
        mark("updateStayed", tStayed);
      }

      if (moved.length) {
        const tMoved = Date.now();
        const vals = moved
          .map((_, i) => `($${i * 3 + 1}::text, $${i * 3 + 2}::uuid, $${i * 3 + 3}::text)`)
          .join(", ");
        const params = moved.flatMap((id) => {
          const { quickwitId, indeksas } = assigned.get(id);
          return [id, quickwitId, indeksas];
        });
        await client.query(
          `UPDATE "quickwitEilutes" AS qe
           SET "quickwitId" = v."quickwitId",
               "indeksas"   = v."indeksas"
           FROM (VALUES ${vals}) AS v("eilutesId", "quickwitId", "indeksas")
           WHERE qe."lentele" = $${params.length + 1}
             AND qe."eilutesId" = v."eilutesId"`,
          [...params, lentele]
        );
        mark("updateMoved", tMoved);
      }
    }
    mark("updateTotal", tUpdate);

    // ── Batch INSERT quickwitEilutes for new rows ───────────────────────────
    const tInsert = Date.now();
    if (toInsert.length) {
      const indeksas = currentShard;
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
    }
    mark("insert", tInsert);

    const tCommit = Date.now();
    await client.query("COMMIT");
    mark("commit", tCommit);

    // ── Ingest into Quickwit, grouped by shard ──────────────────────────────
    // Postgres is committed at this point. Any ingest failure here leaves
    // rows "live" in Postgres but missing from Quickwit — search won't find
    // them, filterLive still thinks they exist. If that becomes a real
    // problem, wire up retries or a deadletter queue here.
    const tIngest = Date.now();
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
    mark("ingest", tIngest);

    // ── Bump iterptosEilutes per shard ──────────────────────────────────────
    // One row per affected shard, so this is cheap regardless of batch size.
    // Done AFTER ingest so a failed ingest doesn't falsely advance iterptos
    // (which drives shard-fullness decisions in getOrCreateActiveShard).
    const tIterptos = Date.now();
    const shardCounts = [...shardDocs.entries()];
    if (shardCounts.length) {
      const vals = shardCounts
        .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::int)`)
        .join(", ");
      const params = shardCounts.flatMap(([indeksas, docs]) => [indeksas, docs.length]);
      await postgres.query(
        `UPDATE "quickwitIndeksai" i
         SET "iterptosEilutes" = i."iterptosEilutes" + v.cnt
         FROM (VALUES ${vals}) AS v("indeksas", "cnt")
         WHERE i."indeksas" = v."indeksas"`,
        params
      );
    }
    mark("iterptos", tIterptos);

    const total = Date.now() - t0;
    const phases = Object.entries(timings)
      .map(([k, v]) => `${k}=${v}ms`)
      .join(" ");
    console.log(
      `indexDocs ${lentele}: ${items.length} items ` +
      `(${toInsert.length} new, ${toUpdate.length} updated: ` +
      `${stayedCount} stayed, ${movedCount} moved) ` +
      `→ ${shardDocs.size} shard(s) in ${total}ms [${phases}]`
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Staleness filter ─────────────────────────────────────────────────────────

/**
 * Given Quickwit search hits, return only those whose quickwitId is still
 * live in Postgres. Scoped by lentele so it plays well with a (lentele,
 * quickwitId) index and to sidestep the vanishingly-unlikely UUID collision
 * across tables.
 *
 * @param {string} lentele
 * @param {{ quickwitId: string, [key: string]: any }[]} hits
 */
export async function filterLive(lentele, hits) {
  if (!hits.length) return [];

  const ids = hits.map((h) => h.quickwitId);
  const { rows } = await postgres.query(
    `SELECT "quickwitId"
     FROM "quickwitEilutes"
     WHERE "lentele" = $1 AND "quickwitId" = ANY($2)`,
    [lentele, ids]
  );
  const live = new Set(rows.map((r) => r.quickwitId));
  return hits.filter((h) => live.has(h.quickwitId));
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search all shards of a table, filter out tombstones, and keep paging until
 * we've collected `minHits` live hits (or exhausted results).
 *
 * Over-fetch math: if deadRatio is e.g. 0.2, fetching N hits yields ~0.8N
 * live ones on average, so size the first fetch as ceil(minHits / (1-dead))
 * plus a small buffer. If that underestimates, the loop keeps paging.
 *
 * @param {string} lentele
 * @param {object} params                - Quickwit search body
 * @param {object} [opts]
 * @param {number} [opts.minHits]        - minimum live hits; Infinity = exhaust
 */
export async function search(lentele, params, { minHits = Infinity } = {}) {
  const deadRatio = await getDeadRatio(lentele);

  // Guard against deadRatio being 1 (everything dead — div-by-zero) or >1
  // (shouldn't happen but cheap to defend against).
  const liveRatio = Math.max(0.01, 1 - deadRatio);
  const fetchSize = Number.isFinite(minHits)
    ? Math.ceil(minHits / liveRatio) + 10
    : 100;

  const liveHits = [];
  let searchAfter = null;
  let numHitsMax = null;
  let requests = 0;
  let totalElapsed = 0;
  let qwMs = 0;
  let filterMs = 0;
  let rawExhausted = false;

  while (liveHits.length < minHits) {
    requests++;
    const reqParams = {
      ...params,
      max_hits: fetchSize,
      format: "json",
      ...(searchAfter ? { search_after: searchAfter } : {}),
    };

    const qwStart = Date.now();
    const data = await qwSearch(`${lentele}_*`, reqParams);
    qwMs += Date.now() - qwStart;
    totalElapsed += data.elapsed_time_micros ?? 0;
    const hits = data.hits ?? [];

    if (numHitsMax === null) numHitsMax = data.num_hits ?? 0;

    // Skip the Postgres roundtrip only when the table has zero dead rows.
    // deadRatio is cached for 60s so this can occasionally lie; the impact
    // is that a handful of tombstones slip through right after the first
    // ingest on a previously-clean table. Acceptable tradeoff.
    const filterStart = Date.now();
    const live = deadRatio === 0 ? hits : await filterLive(lentele, hits);
    filterMs += Date.now() - filterStart;
    liveHits.push(...live);

    // Quickwit returned fewer docs than requested → index truly exhausted.
    if (hits.length < fetchSize) {
      rawExhausted = true;
      break;
    }
    // No sort key → can't paginate further, but the index is NOT exhausted.
    searchAfter = hits[hits.length - 1].sort ?? null;
    if (!searchAfter) break;
  }

  return {
    hits: liveHits,
    numHitsMax,
    numHitsEstimate: Math.round(numHitsMax * liveRatio),
    rawExhausted,
    deadRatio,
    elapsedTimeMicros: totalElapsed,
    requests,
    qwMs,
    filterMs,
  };
}

// ── Count ────────────────────────────────────────────────────────────────────

/**
 * Estimated live document count for rows matching `params.query`. Uses
 * max_hits=0 so Quickwit skips document fetching and only returns the total.
 */
export async function countDocs(lentele, params) {
  const deadRatio = await getDeadRatio(lentele);
  const data = await qwSearch(`${lentele}_*`, { ...params, max_hits: 0 });
  const numHits = data.num_hits ?? 0;
  return Math.round(numHits * (1 - deadRatio));
}

// ── Shard stats ──────────────────────────────────────────────────────────────

export async function shardStats(lentele) {
  const { rows } = await postgres.query(
    `SELECT
       "indeksas",
       "seq",
       "current",
       "shardSize",
       "iterptosEilutes",
       "gyvosEilutes",
       "mirusiosEilutes",
       ROUND(
         "mirusiosEilutes"::numeric
         / NULLIF("iterptosEilutes", 0)
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

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * One-shot repair: recompute gyvosEilutes per shard from the ground truth in
 * quickwitEilutes, and bump iterptosEilutes up to gyvos wherever it's lower
 * (shouldn't happen under the current code but may on legacy data from
 * earlier buggy counter logic). Run after schema changes to counter tracking
 * or whenever drift is suspected.
 *
 * Note: iterptosEilutes is monotonically increasing and represents cumulative
 * ingest events — we can only ever *increase* it during reconciliation; we
 * never have ground truth for how many Quickwit ingests have happened, only
 * a lower bound (gyvos, since every live row has been ingested at least once).
 *
 * mirusiosEilutes is a generated column (iterptos - gyvos) and doesn't need
 * to be touched directly.
 */
export async function reconcileCounters(lentele) {
  await postgres.query("BEGIN");
  try {
    // Recompute gyvos from quickwitEilutes. Shards with no rows get 0.
    await postgres.query(
      `UPDATE "quickwitIndeksai" i
       SET "gyvosEilutes" = COALESCE(a.cnt, 0)
       FROM (
         SELECT "indeksas", COUNT(*)::int AS cnt
         FROM "quickwitEilutes"
         WHERE "lentele" = $1
         GROUP BY "indeksas"
       ) a
       WHERE i."lentele" = $1 AND i."indeksas" = a."indeksas"`,
      [lentele]
    );
    await postgres.query(
      `UPDATE "quickwitIndeksai" i
       SET "gyvosEilutes" = 0
       WHERE i."lentele" = $1
         AND NOT EXISTS (
           SELECT 1 FROM "quickwitEilutes" e
           WHERE e."lentele" = $1 AND e."indeksas" = i."indeksas"
         )`,
      [lentele]
    );
    // Keep the generated mirusios >= 0.
    await postgres.query(
      `UPDATE "quickwitIndeksai"
       SET "iterptosEilutes" = "gyvosEilutes"
       WHERE "lentele" = $1 AND "iterptosEilutes" < "gyvosEilutes"`,
      [lentele]
    );
    await postgres.query("COMMIT");
  } catch (err) {
    await postgres.query("ROLLBACK").catch(() => {});
    throw err;
  }
  _deadRatioCache.delete(lentele);
}
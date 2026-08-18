import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { Logger } from "../utils/log.js";
import { QW_URL } from "./qwHttp.js";
const logger = new Logger();

export { QW_URL };
const QW_TIMEOUT_MS = config.quickwitTimeoutMs ?? 120_000;

// ── Dead-ratio cache ─────────────────────────────────────────────────────────
// The ratio mirusios/(gyvos+mirusios) is only used to decide how many hits to
// over-fetch from Quickwit so we can skip tombstones. It's stable between
// compactions, so we cache it briefly to avoid a Postgres roundtrip on every
// search. 60s is a pragmatic tradeoff: long enough to amortize well, short
// enough that fresh ingest activity is reflected quickly.
const _deadRatioCache = new Map(); // lentele → { value, expiresAt }

/**
 * An estimated total may be off by a few rows, but it can never truthfully be
 * lower than the live matches we have already observed.
 */
export function clampHitsEstimate(estimate, observedHits) {
  if (estimate == null) return observedHits;
  return Math.max(estimate, observedHits);
}
const _tableIdCache = new Map(); // lentele -> id

export async function getDeadRatio(lentele) {
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

async function getQuickwitTableId(lentele, client = postgres) {
  const cached = _tableIdCache.get(lentele);
  if (cached != null) return cached;

  const { rows } = await client.query(
    `SELECT id
     FROM "quickwitLenteles"
     WHERE "lentele" = $1`,
    [lentele]
  );
  if (!rows.length) throw new Error(`Unknown lentele: ${lentele}`);

  const id = rows[0].id;
  _tableIdCache.set(lentele, id);
  return id;
}

// ── Quickwit HTTP helpers ────────────────────────────────────────────────────

async function qwGet(path) {
  const res = await fetch(`${QW_URL}${path}`, {
    signal: AbortSignal.timeout(QW_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Quickwit GET ${path} → ${res.status}`);
  return res.json();
}

async function qwCreateIndex(yaml) {
  const res = await fetch(`${QW_URL}/api/v1/indexes`, {
    method: "POST",
    headers: { "Content-Type": "application/yaml" },
    body: yaml,
    signal: AbortSignal.timeout(QW_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`Quickwit create index → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Quickwit handles concurrent ingests to the same index fine, and a single
// 15 MiB POST is latency-bound on one connection. Split large batches so the
// chunks overlap on the wire.
const QW_INGEST_CHUNK_BYTES = 4 * 1024 * 1024;

function chunkNdjsonLines(lines) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const bytes = Buffer.byteLength(line, "utf8") + 1;
    if (current.length && size + bytes > QW_INGEST_CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function qwIngestNdjson(indeksas, docs, commit = "auto") {
  const lines = docs.map((d) => JSON.stringify(d));
  const chunks = chunkNdjsonLines(lines);
  if (chunks.length > 1) {
    const results = await Promise.all(
      chunks.map((chunk) => qwIngestNdjsonBody(indeksas, chunk.join("\n"), commit))
    );
    return {
      result: { num_docs_for_processing: docs.length },
      serializedBytes: results.reduce((total, r) => total + r.serializedBytes, 0),
    };
  }
  return qwIngestNdjsonBody(indeksas, lines.join("\n"), commit);
}

async function qwIngestNdjsonBody(indeksas, body, commit) {
  const serializedBytes = Buffer.byteLength(body, "utf8");
  const qs = commit && commit !== "auto" ? `?commit=${encodeURIComponent(commit)}` : "";
  const res = await fetch(`${QW_URL}/api/v1/${indeksas}/ingest${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body,
    signal: AbortSignal.timeout(QW_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`Quickwit ingest ${indeksas} → ${res.status}: ${await res.text()}`);
  const result = await res.json();
  if (result.num_rejected_docs) {
    throw new Error(
      `Quickwit ingest ${indeksas} rejected ${result.num_rejected_docs}/${result.num_docs_for_processing} docs`,
    );
  }
  return { result, serializedBytes };
}

async function qwSearch(indeksas, params) {
  const res = await fetch(`${QW_URL}/api/v1/${indeksas}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(QW_TIMEOUT_MS),
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
 * Newest current shard that still has room, or null. "current = true" marks
 * shards whose schema matches the latest indexConfig — older non-current shards
 * keep accepting re-indexes for rows they already hold, but new rows only land
 * on current shards.
 *
 * iterptosEilutes is monotonic (every Quickwit ingest event bumps it), so it's
 * the right "has this shard been filled?" signal. gyvos + mirusios would also
 * work but requires reading the generated column.
 */
async function selectActiveShard(lentele, client) {
  const { rows } = await client.query(
    `SELECT id, "indeksas"
     FROM "quickwitIndeksai"
     WHERE "lentele" = $1
       AND "iterptosEilutes" < "shardSize"
       AND "current" = true
     ORDER BY "seq" DESC
     LIMIT 1`,
    [lentele]
  );
  return rows[0] ?? null;
}

/**
 * Return a shard that can accept new inserts, creating one if none has room.
 *
 * The common case is a plain unlocked SELECT — shards only need serialising
 * when one has to be *created*, so the per-lentele advisory lock is taken in
 * its own short transaction on the slow path only. Holding it across a caller's
 * whole indexing transaction (which includes a multi-second Quickwit ingest)
 * would serialise the entire pipeline for the sake of a rare create.
 *
 * @param {string} lentele
 * @returns {Promise<{ id: number, indeksas: string }>}
 */
async function getOrCreateActiveShard(lentele) {
  const found = await selectActiveShard(lentele, postgres);
  if (found) return found;

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [lentele]);

    // Re-check under the lock: another writer may have created it while we
    // were queued.
    const again = await selectActiveShard(lentele, client);
    if (again) {
      await client.query("COMMIT");
      return again;
    }

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

    const { rows: inserted } = await client.query(
      `INSERT INTO "quickwitIndeksai"
         ("lentele", "seq", "shardSize", "indexConfig", "indexConfigHash", "current")
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, "indeksas"`,
      [lentele, nextSeq, defaultShardSize, indexConfig, indexConfigHash]
    );

    // Quickwit is not transactional with Postgres; create the index after the
    // insert. If this fails, a later retry will see the row already exists and
    // just try the index create again. Idempotent by design.
    await ensureQuickwitIndex(indeksas, indexConfig);

    await client.query("COMMIT");
    return inserted[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function allocateQuickwitIdInts(client, count) {
  if (!count) return [];

  const { rows } = await client.query(
    `SELECT nextval('"quickwitIdIntSeq"'::regclass)::int AS id
     FROM generate_series(1, $1)`,
    [count]
  );
  if (rows.length !== count) {
    throw new Error(`Expected ${count} quickwitIdInt values, got ${rows.length}`);
  }
  return rows.map((r) => r.id);
}

// ── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Index a single document. Thin wrapper around indexDocs.
 */
export async function indexDoc(lentele, eilutesId, doc, opts) {
  return indexDocs(lentele, [{ eilutesId, doc }], opts);
}

/**
 * Batch-index multiple documents from the same table.
 *
 * Per-row behaviour:
 *   - NEW eilutesId: INSERT into quickwitEilutes on the current shard.
 *   - EXISTING on a current shard: UPDATE quickwitEilutes (rotate quickwitIdInt
 *     in place). The old quickwitIdInt becomes a tombstone once the new doc
 *     lands in Quickwit.
 *   - EXISTING on a non-current shard: migrate — UPDATE quickwitEilutes to
 *     point at the active current shard with a fresh quickwitIdInt.
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
 * @param {{ commit?: "auto" | "wait_for" | "force" }} [opts]
 * @returns {Promise<{ documentCount: number, serializedBytes: number }>}
 */
export async function indexDocs(lentele, items, opts = {}) {
  if (!items.length) return { documentCount: 0, serializedBytes: 0 };

  const t0 = Date.now();
  const timings = {};
  const mark = (phase, since) => { timings[phase] = Date.now() - since; };

  const byEilutesId = new Map(items.map((i) => [i.eilutesId, i.doc]));
  const eilutesIds = [...byEilutesId.keys()];

  // ── Plan the batch, outside any transaction ───────────────────────────────
  // Nothing here needs isolation: the "existing" read only decides INSERT vs
  // UPDATE (the publish step below is written to be correct either way), and
  // sequence values are never rolled back anyway.
  const tPlan = Date.now();
  const lentelesId = await getQuickwitTableId(lentele);
  const [{ rows: existing }, currentShard] = await Promise.all([
    postgres.query(
      `SELECT e."eilutesId", e."indeksaiId", i."indeksas"
       FROM "quickwitEilutes" e
       JOIN "quickwitIndeksai" i ON i.id = e."indeksaiId"
       WHERE e."lentelesId" = $1 AND e."eilutesId" = ANY($2::bigint[])`,
      [lentelesId, eilutesIds]
    ),
    getOrCreateActiveShard(lentele),
  ]);
  mark("plan", tPlan);

  // Every re-index goes to the newest active shard. Old shards retain rows
  // only until those rows are touched again; once touched, they migrate
  // forward. This keeps hot data concentrated on recent shards and lets older
  // ones drain naturally over time.
  const existingMap = new Map(existing.map((r) => [r.eilutesId, r.indeksas]));
  const toInsert = eilutesIds.filter((id) => !existingMap.has(id));
  const toUpdate = eilutesIds.filter((id) => existingMap.has(id));
  const stayedCount = toUpdate.filter(
    (id) => existingMap.get(id) === currentShard.indeksas
  ).length;
  const movedCount = toUpdate.length - stayedCount;

  const tAllocate = Date.now();
  const quickwitIdInts = await allocateQuickwitIdInts(postgres, eilutesIds.length);
  const quickwitIdIntByEilutesId = new Map(
    eilutesIds.map((id, i) => [id, quickwitIdInts[i]])
  );
  mark("allocate", tAllocate);

  // ── Ingest into Quickwit ──────────────────────────────────────────────────
  // Deliberately outside the transaction. The old mapping stays live until the
  // publish below commits, so a failure here leaves search untouched; the only
  // residue is orphan docs in Quickwit that no quickwitEilutes row points at,
  // and filterLive already treats those as tombstones.
  //
  // Keeping this inside the transaction (and, worse, under the per-lentele
  // advisory lock) serialised every writer behind a multi-second HTTP call.
  const tIngest = Date.now();
  const shardDocs = new Map([[currentShard.indeksas, eilutesIds.map((id) => ({
    ...byEilutesId.get(id),
    quickwitId: String(quickwitIdIntByEilutesId.get(id)),
  }))]]);

  const ingestResults = await Promise.all(
    [...shardDocs.entries()].map(([indeksas, docs]) =>
      qwIngestNdjson(indeksas, docs, opts.commit)
    )
  );
  const serializedBytes = ingestResults.reduce(
    (total, ingest) => total + ingest.serializedBytes,
    0
  );
  mark("ingest", tIngest);

  // ── Publish the new mappings ──────────────────────────────────────────────
  // Short transaction: only row writes, no HTTP, no advisory lock.
  const tConnect = Date.now();
  const client = await postgres.connect();
  mark("connect", tConnect);

  try {
    const tTx = Date.now();
    await client.query("BEGIN");
    mark("begin", tTx);

    // One statement for all existing rows. indeksaiId is always rewritten
    // rather than only on a detected shard change: `existing` was read without
    // a lock, so a concurrent writer may have moved the row since, and the doc
    // we just ingested definitely lives on currentShard.
    const tUpdate = Date.now();
    if (toUpdate.length) {
      const vals = toUpdate
        .map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::int)`)
        .join(", ");
      const params = toUpdate.flatMap((id) => [id, quickwitIdIntByEilutesId.get(id)]);
      await client.query(
        `UPDATE "quickwitEilutes" AS qe
         SET "quickwitIdInt" = v."quickwitIdInt",
             "indeksaiId" = $${params.length + 2}
         FROM (VALUES ${vals}) AS v("eilutesId", "quickwitIdInt")
         WHERE qe."lentelesId" = $${params.length + 1}
           AND qe."eilutesId" = v."eilutesId"`,
        [...params, lentelesId, currentShard.id]
      );
    }
    mark("update", tUpdate);

    // ── Batch INSERT quickwitEilutes for new rows ───────────────────────────
    // ON CONFLICT because the new/existing split was decided outside a lock:
    // a concurrent batch holding the same eilutesId may have inserted it in
    // between, and last writer wins is the same outcome the update path gives.
    const tInsert = Date.now();
    if (toInsert.length) {
      const vals = toInsert
        .map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::int)`)
        .join(", ");
      const params = toInsert.flatMap((id) => [id, quickwitIdIntByEilutesId.get(id)]);

      await client.query(
        `INSERT INTO "quickwitEilutes"("lentelesId", "eilutesId", "indeksaiId", "quickwitIdInt")
         SELECT $${params.length + 1}, v."eilutesId", $${params.length + 2}, v."quickwitIdInt"
         FROM (VALUES ${vals}) AS v("eilutesId", "quickwitIdInt")
         ON CONFLICT ("lentelesId", "eilutesId") DO UPDATE
           SET "quickwitIdInt" = EXCLUDED."quickwitIdInt",
               "indeksaiId" = EXCLUDED."indeksaiId"`,
        [...params, lentelesId, currentShard.id]
      );
    }
    mark("insert", tInsert);

    // ── Bump iterptosEilutes per shard ──────────────────────────────────────
    // One row per affected shard, so this is cheap regardless of batch size.
    // Kept last in the transaction: it's the one write every concurrent batch
    // contends on (same shard row), so the row lock is held for as little of
    // the transaction as possible.
    const tIterptos = Date.now();
    const shardCounts = [...shardDocs.entries()];
    if (shardCounts.length) {
      const vals = shardCounts
        .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::int)`)
        .join(", ");
      const params = shardCounts.flatMap(([indeksas, docs]) => [indeksas, docs.length]);
      await client.query(
        `UPDATE "quickwitIndeksai" i
         SET "iterptosEilutes" = i."iterptosEilutes" + v.cnt
         FROM (VALUES ${vals}) AS v("indeksas", "cnt")
         WHERE i."indeksas" = v."indeksas"`,
        params
      );
    }
    mark("iterptos", tIterptos);

    const tCommit = Date.now();
    await client.query("COMMIT");
    mark("commit", tCommit);

    const total = Date.now() - t0;
    const phases = Object.entries(timings)
      .map(([k, v]) => `${k}=${v}ms`)
      .join(" ");
    logger.log(
      `indexDocs ${lentele}: ${items.length} items ` +
      `(${toInsert.length} new, ${toUpdate.length} updated: ` +
      `${stayedCount} stayed, ${movedCount} moved) ` +
      `→ ${shardDocs.size} shard(s) in ${total}ms [${phases}]`
    );
    return { documentCount: items.length, serializedBytes };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Staleness filter ─────────────────────────────────────────────────────────

/**
 * Given Quickwit search hits, return only those whose id is still live in
 * Postgres. The Quickwit document field is named quickwitId and holds the
 * quickwitEilutes."quickwitIdInt" value as a string; anything that isn't a
 * plain integer is a pre-migration document and counts as dead.
 *
 * @param {string} lentele
 * @param {{ quickwitId: string, [key: string]: any }[]} hits
 */
export async function filterLive(lentele, hits) {
  if (!hits.length) return [];
  const lentelesId = await getQuickwitTableId(lentele);

  const quickwitIdInts = [];
  for (const hit of hits) {
    const id = String(hit.quickwitId);
    if (/^\d+$/.test(id)) quickwitIdInts.push(id);
  }
  if (!quickwitIdInts.length) return [];

  const { rows } = await postgres.query(
    `SELECT "quickwitIdInt"
     FROM "quickwitEilutes"
     WHERE "lentelesId" = $1 AND "quickwitIdInt" = ANY($2::int[])`,
    [lentelesId, quickwitIdInts]
  );
  const live = new Set(rows.map((row) => String(row.quickwitIdInt)));

  return hits.filter((h) => live.has(String(h.quickwitId)));
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search all shards of a table, filter out tombstones, and keep paging until
 * we've collected `minHits` live hits (or exhausted results).
 *
 * Over-fetch math: if deadRatio is e.g. 0.2, fetching N hits yields ~0.8N
 * live ones on average, so size the first fetch as ceil(minHits / (1-dead))
 * plus a small buffer. That average is only a starting guess — tombstones are
 * not spread evenly, and a sort can pile them all at one end (e.g. juridiniai
 * sorted by `darbuotojai` puts dozens of stale copies of the largest employers
 * on top, so the first 63 raw hits can yield 2 live ones). So every follow-up
 * request is sized from the live ratio *observed so far* instead of the global
 * one, which lets a tombstone-heavy stretch be cleared in one wide fetch rather
 * than by many fixed-size steps that never catch up.
 *
 * @param {string} lentele
 * @param {object} params                - Quickwit search body
 * @param {object} [opts]
 * @param {number} [opts.minHits]        - minimum live hits; Infinity = exhaust
 * @param {number} [opts.maxScan]        - raw-document budget; caps how far a
 *                                          pathological stretch is chased
 */
export async function search(
  lentele,
  params,
  { minHits = Infinity, maxScan = DEFAULT_MAX_SCAN } = {},
) {
  const deadRatio = await getDeadRatio(lentele);

  // Guard against deadRatio being 1 (everything dead — div-by-zero) or >1
  // (shouldn't happen but cheap to defend against).
  const liveRatio = Math.max(0.01, 1 - deadRatio);

  const liveHits = [];
  let offset = 0;
  let scanned = 0;
  let numHitsMax = null;
  let requests = 0;
  let totalElapsed = 0;
  let qwMs = 0;
  let filterMs = 0;
  let rawExhausted = false;
  let scanBudgetSpent = false;

  // Quickwit 0.8 has no `search_after` (the body only accepts `start_offset`),
  // so we page forward with start_offset until we've gathered `minHits` live
  // hits or run out. NOTE: offset paging assumes a stable order across
  // requests, so callers paging deep must sort by a concrete field — an
  // all-equal `_score` (match-all) gives an arbitrary order.
  //
  // `sizeFetch` turns "how many live hits do I still need" into "how many raw
  // docs to ask for", using `ratio` (the global estimate first, the observed
  // one afterwards) and clamped to Quickwit's own max_hits ceiling.
  const sizeFetch = (needed, ratio) =>
    Math.max(1, Math.min(QW_MAX_HITS, Math.ceil(needed / ratio) + 10));

  let fetchSize = Number.isFinite(minHits)
    ? Math.min(sizeFetch(minHits, liveRatio), maxScan)
    : 100;

  while (liveHits.length < minHits) {
    requests++;
    const reqParams = {
      ...params,
      max_hits: fetchSize,
      start_offset: offset,
      format: "json",
    };

    const qwStart = Date.now();
    const data = await qwSearch(`${lentele}_*`, reqParams);
    qwMs += Date.now() - qwStart;
    totalElapsed += data.elapsed_time_micros ?? 0;
    const hits = data.hits ?? [];
    scanned += hits.length;

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

    offset += hits.length;
    // Next offset would exceed Quickwit's start_offset ceiling → 400.
    if (offset > QW_MAX_START_OFFSET) break;

    const needed = minHits - liveHits.length;
    if (needed <= 0) break;

    // Stop chasing once the raw-document budget is spent, so a stretch that is
    // dead end-to-end cannot walk the whole index.
    if (scanned >= maxScan) {
      scanBudgetSpent = true;
      break;
    }

    // Re-size from what this run actually saw. Falling back to `liveRatio`
    // while nothing is live yet would repeat the same too-small fetch, so use
    // a floor of one live hit per page scanned instead.
    const observedRatio = Math.max(1 / scanned, liveHits.length / scanned);
    fetchSize = Math.min(sizeFetch(needed, observedRatio), maxScan - scanned);
    if (fetchSize < 1) {
      scanBudgetSpent = true;
      break;
    }
  }

  return {
    hits: liveHits,
    numHitsMax,
    numHitsEstimate: clampHitsEstimate(
      Math.round(numHitsMax * liveRatio),
      liveHits.length,
    ),
    rawExhausted,
    // True when the loop gave up with fewer than `minHits` live hits because
    // the scan budget ran out — the caller got a short page, not the end of
    // the index. Worth surfacing/logging rather than silently showing "19".
    scanBudgetSpent,
    scanned,
    deadRatio,
    elapsedTimeMicros: totalElapsed,
    requests,
    qwMs,
    filterMs,
  };
}

// Quickwit 0.8 riboja ir max_hits, ir start_offset iki 10 000 (400 Bad Request
// virš to). Tad puslapiuojam po 10 000 ir galim pasiekti nebent offset 10 000 —
// t.y. iš viso ne daugiau kaip 20 000 rezultatų. Eksporto riba tuo ir remiasi.
const QW_MAX_HITS = 10_000;
const QW_MAX_START_OFFSET = 10_000;
export const QW_EXPORT_CEILING = QW_MAX_HITS + QW_MAX_START_OFFSET;

// Raw-document budget for one `search` call. Because start_offset tops out at
// 10 000, no offset walk can reach past QW_EXPORT_CEILING anyway, so this is
// simply "as far as Quickwit lets us look". It exists to bound a stretch that
// is dead end-to-end; the adaptive re-sizing normally clears such a stretch in
// one extra request, long before the budget matters.
const DEFAULT_MAX_SCAN = QW_EXPORT_CEILING;

/**
 * Page a table's shards `QW_MAX_HITS` hits at a time (Quickwit's hard `max_hits`
 * ceiling), filtering out tombstones, until the raw index is exhausted, `limit`
 * live hits are collected, or Quickwit's `start_offset` ceiling is reached.
 * Unlike `search`, this never sets a `max_hits` above the ceiling — it walks
 * `start_offset` forward — so it suits large exports. Because `start_offset`
 * itself tops out at 10 000, at most `QW_EXPORT_CEILING` (20 000) hits are
 * reachable.
 *
 * @param {string} lentele
 * @param {object} params        - Quickwit search body (must sort by a concrete
 *                                  field for stable offset paging)
 * @param {object} [opts]
 * @param {number} [opts.limit]  - stop after this many live hits; Infinity = all
 * @param {number} [opts.pageSize] - raw hits per request (max 10 000)
 * @param {number} [opts.maxPages] - optional request cap for cursor windows
 */
export async function searchAll(
  lentele,
  params,
  { limit = Infinity, pageSize = QW_MAX_HITS, maxPages = Infinity } = {},
) {
  const fetchSize = Math.max(1, Math.min(QW_MAX_HITS, Math.trunc(pageSize)));
  const deadRatio = await getDeadRatio(lentele);
  const liveHits = [];
  let offset = 0;
  let numHitsMax = null;
  let lastRawHit = null;
  let rawExhausted = false;
  let pages = 0;

  while (liveHits.length < limit && pages < maxPages) {
    pages++;
    const data = await qwSearch(`${lentele}_*`, {
      ...params,
      max_hits: fetchSize,
      start_offset: offset,
      format: "json",
    });
    const hits = data.hits ?? [];
    if (hits.length) lastRawHit = hits[hits.length - 1];
    if (numHitsMax === null) numHitsMax = data.num_hits ?? 0;

    const live = deadRatio === 0 ? hits : await filterLive(lentele, hits);
    liveHits.push(...live);

    // Short page → index exhausted. Also stop before exceeding Quickwit's
    // start_offset ceiling (next offset would 400).
    if (hits.length < fetchSize) {
      rawExhausted = true;
      break;
    }
    if (offset >= QW_MAX_START_OFFSET) break;
    offset += fetchSize;
  }

  return {
    hits: Number.isFinite(limit) ? liveHits.slice(0, limit) : liveHits,
    numHitsMax,
    numHitsEstimate: clampHitsEstimate(
      numHitsMax == null ? null : Math.round(numHitsMax * (1 - deadRatio)),
      liveHits.length,
    ),
    // Cursor callers must advance past the last raw hit, not the last live hit:
    // the tail of a page may consist entirely of tombstones.
    lastRawHit,
    rawExhausted,
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
  const lentelesId = await getQuickwitTableId(lentele);
  await postgres.query("BEGIN");
  try {
    // Recompute gyvos from quickwitEilutes. Shards with no rows get 0.
    await postgres.query(
      `UPDATE "quickwitIndeksai" i
       SET "gyvosEilutes" = COALESCE(a.cnt, 0)
       FROM (
         SELECT "indeksaiId", COUNT(*)::int AS cnt
         FROM "quickwitEilutes"
         WHERE "lentelesId" = $2
         GROUP BY "indeksaiId"
       ) a
       WHERE i."lentele" = $1 AND i.id = a."indeksaiId"`,
      [lentele, lentelesId]
    );
    await postgres.query(
      `UPDATE "quickwitIndeksai" i
       SET "gyvosEilutes" = 0
       WHERE i."lentele" = $1
         AND NOT EXISTS (
           SELECT 1 FROM "quickwitEilutes" e
           WHERE e."lentelesId" = $2 AND e."indeksaiId" = i.id
         )`,
      [lentele, lentelesId]
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

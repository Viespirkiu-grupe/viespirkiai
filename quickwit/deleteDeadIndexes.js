import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

// Deletes every Quickwit shard that is 100% dead.
//
// What "dead" means here: a dead shard still PHYSICALLY holds all of its docs in
// Quickwit (old, superseded versions) — its Quickwit num_docs is not 0. Liveness
// is not tracked inside Quickwit; it lives in Postgres. A shard is dead when:
//   - it is not the `current` write target for its table, AND
//   - nothing in `quickwitEilutes` (the authoritative row -> shard map) still
//     points at it — i.e. every row it ever held has been re-indexed elsewhere.
// We gate on `quickwitEilutes` directly (the fact), not on the cached
// `gyvosEilutes` counter, which is only shown for information.
//
// usage:
//   node deleteDeadIndexes.js                  # dry run — list what would go
//   node deleteDeadIndexes.js --apply          # actually delete
//   node deleteDeadIndexes.js --apply --force  # delete even if live rows remain (dangerous)

const QW_URL = config.quickwitUrl;
const args = process.argv.slice(2);
const apply = args.includes("--apply") || args.includes("--yes");
const force = args.includes("--force");

async function quickwitNumDocs(indeksas) {
  try {
    const res = await fetch(`${QW_URL}/api/v1/${indeksas}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "*", max_hits: 0 }),
    });
    if (!res.ok) return res.status === 404 ? "absent" : `err ${res.status}`;
    const d = await res.json();
    return d?.num_hits ?? "?";
  } catch {
    return "unreachable";
  }
}

// Every superseded (non-current) shard is a candidate; the fact check decides.
const { rows: candidates } = await postgres.query(
  `SELECT "indeksas", "lentele", "gyvosEilutes", "mirusiosEilutes"
   FROM "quickwitIndeksai"
   WHERE "current" = false
   ORDER BY "lentele", "indeksas"`
);

const dead = [];
for (const c of candidates) {
  // Authoritative liveness: count rows that still point at this shard.
  const { rows } = await postgres.query(
    `SELECT COUNT(*)::int AS live
     FROM "quickwitEilutes"
     WHERE "lentele" = $1 AND "indeksas" = $2`,
    [c.lentele, c.indeksas]
  );
  const live = rows[0].live;
  const counterMismatch = Number(c.gyvosEilutes) !== live;

  if (live === 0 || force) {
    const physical = await quickwitNumDocs(c.indeksas);
    dead.push({ ...c, live, physical });
    if (live > 0 && force) {
      console.log(`⚠ ${c.indeksas}: ${live} live rows in quickwitEilutes — deleting anyway (--force)`);
    }
    if (counterMismatch) {
      console.log(`note ${c.indeksas}: gyvosEilutes counter=${c.gyvosEilutes} but fact live=${live}`);
    }
  } else {
    console.log(`skip ${c.indeksas}: ${live} live rows still point here (not dead)`);
  }
}

if (!dead.length) {
  console.log("no 100% dead shards to delete.");
  await postgres.end();
  process.exit(0);
}

console.log(`\n${dead.length} dead shard(s)${apply ? "" : " (dry run)"}:`);
for (const d of dead) {
  console.log(
    `  ${d.indeksas.padEnd(18)} live=${d.live}  mirusios=${d.mirusiosEilutes}  quickwitDocs=${d.physical}`
  );
}

if (!apply) {
  console.log("\nre-run with --apply to delete them.");
  await postgres.end();
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const d of dead) {
  // Quickwit is not transactional with Postgres; drop the index first. A 404
  // means it was already gone — still clean up the Postgres row.
  const res = await fetch(`${QW_URL}/api/v1/indexes/${d.indeksas}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    console.error(`  ✗ ${d.indeksas}: Quickwit DELETE → ${res.status}: ${await res.text()}`);
    failed++;
    continue;
  }
  await postgres.query(`DELETE FROM "quickwitIndeksai" WHERE "indeksas" = $1`, [d.indeksas]);
  console.log(`  ✓ deleted ${d.indeksas}${res.status === 404 ? " (already gone in Quickwit)" : ""}`);
  ok++;
}

console.log(`\ndone: ${ok} deleted, ${failed} failed`);
await postgres.end();
process.exit(failed ? 1 : 0);

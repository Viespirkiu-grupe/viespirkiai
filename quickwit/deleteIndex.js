import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

const QW_URL = config.quickwitUrl;
const args = process.argv.slice(2);
const force = args.includes("--force");
const indeksas = args.find((a) => !a.startsWith("--"));

if (!indeksas) {
  console.error("usage: node deleteIndex.js <indeksas> [--force]");
  process.exit(1);
}

const lentele = indeksas.replace(/_\d+$/, "");

// Check shard exists
const { rows: shardRows } = await postgres.query(
  `SELECT "gyvosEilutes", "mirusiosEilutes", "current"
   FROM "quickwitIndeksai"
   WHERE "indeksas" = $1`,
  [indeksas]
);

if (!shardRows.length) {
  console.error(`no shard found for ${indeksas}`);
  process.exit(1);
}

const { gyvosEilutes, mirusiosEilutes, current } = shardRows[0];
console.log(`indeksas:  ${indeksas}`);
console.log(`lentele:   ${lentele}`);
console.log(`current:   ${current}`);
console.log(`gyva:      ${gyvosEilutes}`);
console.log(`mirusios:  ${mirusiosEilutes}`);

// Check for live rows in quickwitEilutes
if (!force) {
  const { rows: liveRows } = await postgres.query(
    `SELECT COUNT(*) AS cnt
     FROM "quickwitEilutes"
     WHERE "lentele" = $1 AND "indeksas" = $2`,
    [lentele, indeksas]
  );
  const live = Number(liveRows[0].cnt);
  if (live > 0) {
    console.error(`\n${live} live rows still point to this shard. migrate them first or use --force.`);
    process.exit(1);
  }
}

// Delete from Quickwit
const res = await fetch(`${QW_URL}/api/v1/indexes/${indeksas}`, {
  method: "DELETE",
});
if (!res.ok) {
  console.error(`Quickwit DELETE ${indeksas} → ${res.status}: ${await res.text()}`);
  process.exit(1);
}

// Delete from Postgres
await postgres.query(
  `DELETE FROM "quickwitIndeksai" WHERE "indeksas" = $1`,
  [indeksas]
);

console.log(`deleted ${indeksas}`);
await postgres.end();
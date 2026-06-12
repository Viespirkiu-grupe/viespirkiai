import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { postgres } from "../postgres/postgres.js";

const TABLES = {
  dokumentai: { queue: "dokumentaiIndexQueue", queueId: "dokumentoId", source: "dokumentai" },
  failai: { queue: "failaiIndexQueue", queueId: "failoId", source: "failai" },
};

const HELP = `Perkelia pasirinktų Quickwit indeksų gyvas eilutes į indeksavimo eilę.
Apdorojus eilę pasirinkti indeksai turės 0 gyvų eilučių (100% mirusių).

Naudojimas:
  npm run quickwit:requeue-live -- [indeksas ...] [parinktys]

Pasirinkimas:
  --top N             N indeksų, turinčių daugiausia mirusių eilučių
  --top-ratio N       N indeksų, turinčių didžiausią mirusių eilučių procentą
  --all               visi filtrus atitinkantys indeksai
  --list              tik parodyti indeksus
  --lentele PAV       dokumentai (numatyta) arba failai
  --min-dead N        tik turintys bent N mirusių eilučių
  --min-dead-ratio N  tik turintys bent N% mirusių eilučių

Vykdymas:
  --dry-run           parodyti rezultatą nekeičiant DB
  --help              parodyti šią pagalbą

Be pasirinkimo argumentų terminale atidaromas interaktyvus pasirinkimas.

Pavyzdžiai:
  npm run quickwit:requeue-live -- dokumentai_12 dokumentai_18
  npm run quickwit:requeue-live -- --top 3 --min-dead 100000
  npm run quickwit:requeue-live -- --top-ratio 5 --dry-run
  npm run quickwit:requeue-live -- --all --min-dead-ratio 80`;

function parseNonNegativeNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${option} reikšmė turi būti neneigiamas skaičius`);
  return number;
}

function parsePositiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${option} reikšmė turi būti teigiamas sveikasis skaičius`);
  return number;
}

export function parseArgs(argv) {
  const options = {
    all: false, dryRun: false, help: false, indexes: [], lentele: "dokumentai",
    list: false, minDead: 0, minDeadRatio: 0, top: null, topRatio: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") options.all = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--lentele") options.lentele = argv[++i];
    else if (arg === "--min-dead") options.minDead = parseNonNegativeNumber(argv[++i], arg);
    else if (arg === "--min-dead-ratio") options.minDeadRatio = parseNonNegativeNumber(argv[++i], arg);
    else if (arg === "--top") options.top = parsePositiveInteger(argv[++i], arg);
    else if (arg === "--top-ratio") options.topRatio = parsePositiveInteger(argv[++i], arg);
    else if (arg.startsWith("--")) throw new Error(`Nežinoma parinktis: ${arg}`);
    else options.indexes.push(arg);
  }

  if (!TABLES[options.lentele]) throw new Error(`--lentele turi būti viena iš: ${Object.keys(TABLES).join(", ")}`);
  if (options.minDeadRatio > 100) throw new Error("--min-dead-ratio negali būti daugiau nei 100");
  const selectors = [options.all, options.indexes.length > 0, options.top !== null, options.topRatio !== null].filter(Boolean);
  if (selectors.length > 1) throw new Error("Naudokite tik vieną pasirinkimo būdą: indeksus, --top, --top-ratio arba --all");
  return options;
}

async function getIndexes({ lentele, minDead, minDeadRatio }) {
  const { rows } = await postgres.query(
    `SELECT i."indeksas", i."seq", i."current",
            i."gyvosEilutes", i."mirusiosEilutes", i."iterptosEilutes",
            CASE WHEN i."iterptosEilutes" = 0 THEN 0
                 ELSE 100.0 * i."mirusiosEilutes" / i."iterptosEilutes" END AS "deadRatio"
     FROM "quickwitIndeksai" i
     WHERE i."lentele" = $1 AND i."mirusiosEilutes" >= $2
       AND CASE WHEN i."iterptosEilutes" = 0 THEN 0
                ELSE 100.0 * i."mirusiosEilutes" / i."iterptosEilutes" END >= $3
     ORDER BY i."seq"`,
    [lentele, minDead, minDeadRatio],
  );
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    ["deadRatio", "gyvosEilutes", "iterptosEilutes", "mirusiosEilutes", "seq"].includes(key)
      ? [key, Number(value)] : [key, value])));
}

function formatNumber(number) {
  return number.toLocaleString("lt-LT");
}

function printIndexes(indexes) {
  if (!indexes.length) return console.log("Filtrus atitinkančių indeksų nėra.");
  console.table(indexes.map((index, i) => ({
    nr: i + 1,
    indeksas: index.indeksas,
    gyvos: formatNumber(index.gyvosEilutes),
    mirusios: formatNumber(index.mirusiosEilutes),
    "mirusios_%": index.deadRatio.toFixed(2),
    current: index.current,
  })));
}

export function parseInteractiveSelection(input, indexes) {
  const normalized = input.trim().toLowerCase();
  if (normalized === "all" || normalized === "visi") return indexes;
  const topMatch = normalized.match(/^(top|ratio)\s+(\d+)$/);
  if (topMatch) {
    const count = parsePositiveInteger(topMatch[2], topMatch[1]);
    const field = topMatch[1] === "ratio" ? "deadRatio" : "mirusiosEilutes";
    return [...indexes].sort((a, b) => b[field] - a[field]).slice(0, count);
  }

  const numbers = new Set();
  for (const part of normalized.split(",")) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Nesuprastas pasirinkimas: ${part.trim()}`);
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    if (from > to || from < 1 || to > indexes.length) throw new Error(`Pasirinkimas nepatenka į 1-${indexes.length}: ${part.trim()}`);
    for (let number = from; number <= to; number++) numbers.add(number);
  }
  return [...numbers].map((number) => indexes[number - 1]);
}

function selectIndexes(indexes, options) {
  if (options.indexes.length) {
    const byName = new Map(indexes.map((index) => [index.indeksas, index]));
    const missing = options.indexes.filter((name) => !byName.has(name));
    if (missing.length) throw new Error(`Indeksai nerasti arba neatitinka filtrų: ${missing.join(", ")}`);
    return options.indexes.map((name) => byName.get(name));
  }
  if (options.top !== null) return [...indexes].filter((x) => x.gyvosEilutes > 0)
    .sort((a, b) => b.mirusiosEilutes - a.mirusiosEilutes || a.seq - b.seq).slice(0, options.top);
  if (options.topRatio !== null) return [...indexes].filter((x) => x.gyvosEilutes > 0)
    .sort((a, b) => b.deadRatio - a.deadRatio || b.mirusiosEilutes - a.mirusiosEilutes).slice(0, options.topRatio);
  if (options.all) return indexes.filter((index) => index.gyvosEilutes > 0);
  return null;
}

async function chooseInteractively(indexes) {
  printIndexes(indexes);
  if (!indexes.length) return [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Pasirinkite numerius / intervalus (pvz. 1,3-5), „top N“, „ratio N“ arba „all“: ");
    return parseInteractiveSelection(answer, indexes);
  } finally {
    rl.close();
  }
}

async function requeueIndexes(indexes, { dryRun, lentele }) {
  const table = TABLES[lentele];
  const names = indexes.map((index) => index.indeksas);
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [lentele]);
    await client.query(`LOCK TABLE "${table.queue}" IN SHARE ROW EXCLUSIVE MODE`);
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM "quickwitEilutes"
       WHERE "lentele" = $1 AND "indeksas" = ANY($2::text[])`,
      [lentele, names],
    );
    if (dryRun) {
      await client.query("ROLLBACK");
      return { queuedDeletes: 0, queuedPatches: 0, replacedQueueRows: 0, total: countRows[0].total };
    }

    // Otherwise re-indexed rows could land back in a selected current shard.
    await client.query(`UPDATE "quickwitIndeksai" SET "current" = false WHERE "lentele" = $1 AND "indeksas" = ANY($2::text[])`, [lentele, names]);
    const { rowCount: replacedQueueRows } = await client.query(
      `DELETE FROM "${table.queue}" q USING "quickwitEilutes" e
       WHERE e."lentele" = $1 AND e."indeksas" = ANY($2::text[])
         AND q."${table.queueId}" = e."eilutesId"::bigint`,
      [lentele, names],
    );

    const { rowCount: queuedPatches } = await client.query(
      `INSERT INTO "${table.queue}" ("${table.queueId}", "keitimas")
       SELECT e."eilutesId"::bigint, 'patch'
       FROM "quickwitEilutes" e
       JOIN "${table.source}" s ON s.id = e."eilutesId"::bigint
       WHERE e."lentele" = $1 AND e."indeksas" = ANY($2::text[])`,
      [lentele, names],
    );
    const { rowCount: queuedDeletes } = await client.query(
      `INSERT INTO "${table.queue}" ("${table.queueId}", "keitimas")
       SELECT e."eilutesId"::bigint, 'delete'
       FROM "quickwitEilutes" e
       LEFT JOIN "${table.source}" s ON s.id = e."eilutesId"::bigint
       WHERE e."lentele" = $1 AND e."indeksas" = ANY($2::text[]) AND s.id IS NULL`,
      [lentele, names],
    );
    await client.query("COMMIT");
    return {
      queuedPatches,
      queuedDeletes,
      replacedQueueRows,
      total: countRows[0].total,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const indexes = await getIndexes(options);
  if (options.list) return printIndexes(indexes);
  let selected = selectIndexes(indexes, options);
  if (selected === null) {
    if (!process.stdin.isTTY) throw new Error("Nurodykite indeksus, --top, --top-ratio arba --all");
    selected = await chooseInteractively(indexes);
  }
  if (!selected.length) return console.log("Nėra indeksų su gyvomis eilutėmis.");
  console.log(options.dryRun ? "Pasirinkta [dry-run]:" : "Pasirinkta:");
  printIndexes(selected);
  const result = await requeueIndexes(selected, options);
  if (options.dryRun) return console.log(`[dry-run] Į eilę būtų įdėta ${formatNumber(result.total)} gyvų eilučių.`);
  console.log(`Į eilę įdėta ${formatNumber(result.queuedPatches)} patch ir ${formatNumber(result.queuedDeletes)} delete eilučių; pakeista senų eilės eilučių: ${formatNumber(result.replacedQueueRows)}.`);
  console.log("Apdorojus eilę pasirinkti indeksai turės 0 gyvų eilučių ir galės būti ištrinti.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Nepavyko perkelti Quickwit eilučių: ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => postgres.end());
}

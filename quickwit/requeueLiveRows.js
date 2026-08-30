import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { postgres } from "../postgres/postgres.js";
import { closeNats } from "../utils/natsHub.js";
import { signalWork, WORK_SIGNALS } from "../utils/taskSignals.js";

// `signal` – NATS signalas, kuriuo po commit'o pažadinamas atitinkamas
// taskRunner'io indeksavimo eilės darbas (žr. tasks/*.js `wakeOn`).
const TABLES = {
  // Eilės keitimo stulpelis čia vadinasi „change", o ne „keitimas".
  documents: {
    queue: "indexQueue",
    queueSchema: "documents",
    queueId: "documentId",
    changeColumn: "change",
    source: "documents",
    sourceSchema: "documents",
    sourceId: "id",
    signal: WORK_SIGNALS.DOCUMENTS_INDEX_READY,
  },
  sutartys: {
    queue: "vpmSutartysIndexQueue",
    queueId: "unikalusId",
    source: "vpmSutartys",
    sourceId: "unikalusId",
    signal: WORK_SIGNALS.SUTARTYS_CHANGED,
  },
  viesiejiPirkimai: {
    queue: "indexQueue",
    queueSchema: "eppsViesiejiPirkimai",
    queueId: "pirkimoId",
    source: "pirkimai",
    sourceSchema: "eppsViesiejiPirkimai",
    sourceId: "pirkimoId",
    signal: WORK_SIGNALS.VIESIEJI_PIRKIMAI_CHANGED,
  },
  // jarKodas yra text, o quickwitEilutes."eilutesId" – bigint, tad reikia ::text.
  juridiniai: {
    queue: "juridiniaiIndexQueue",
    queueId: "jarKodas",
    queueValue: `e."eilutesId"::text`,
    source: "juridiniai",
    sourceId: "jarKodas",
    sourceValue: `e."eilutesId"::text`,
    signal: WORK_SIGNALS.JURIDINIAI_INDEX_READY,
  },
  // Raktas – `quickwitIndeksai."lentele"` reikšmė (Quickwit indekso etiketė);
  // pačios lentelės gyvena `mcp` schemoje.
  mcpToolCalls: {
    queue: "indexQueue",
    queueSchema: "mcp",
    queueId: "mcpToolCallId",
    source: "toolCalls",
    sourceSchema: "mcp",
    sourceId: "id",
    signal: WORK_SIGNALS.MCP_TOOL_CALLS_INDEX_READY,
  },
};

// Schemą prirašom tik tada, kai ji ne `public`: taip užklausos toms lentelėms,
// kurios visada gyveno public, lieka žodis žodin tokios pačios.
const ref = (schema, name) =>
    schema && schema !== "public" ? `"${schema}"."${name}"` : `"${name}"`;
const queueRef = (table) => ref(table.queueSchema, table.queue);
const sourceRef = (table) => ref(table.sourceSchema, table.source);

const HELP = `Perkelia pasirinktų Quickwit indeksų gyvas eilutes į indeksavimo eilę.
Apdorojus eilę pasirinkti indeksai turės 0 gyvų eilučių (100% mirusių).

Naudojimas:
  npm run quickwit:requeue-live -- [QUICKWIT_INDEKSO_PAVADINIMAS ...] [parinktys]

Indeksą nurodykite stulpelio „quickwit_indeksas“ reikšme, pvz. documents_32.
Šaltinio lentelės įrašo ID ir vidinis quickwitIndeksai.id čia nenaudojami.

Pasirinkimas:
  --top N             N indeksų, turinčių daugiausia mirusių eilučių
  --top-ratio N       N indeksų, turinčių didžiausią mirusių eilučių procentą
  --all               visi filtrus atitinkantys indeksai
  --list              tik parodyti indeksus
  --lentele PAV       filtruoti pagal documents, sutartys, viesiejiPirkimai arba juridiniai
  --min-dead N        tik turintys bent N mirusių eilučių
  --min-dead-ratio N  tik turintys bent N% mirusių eilučių

Vykdymas:
  --dry-run           parodyti rezultatą nekeičiant DB
  --help              parodyti šią pagalbą

Be pasirinkimo argumentų terminale atidaromas interaktyvus pasirinkimas. Jame
įvedamos pirmojo stulpelio „pasirinkimo_nr“ reikšmės, o ne DB įrašų ID.
Nenurodžius --lentele rodomi visų lentelių Quickwit indeksai.

Pavyzdžiai:
  npm run quickwit:requeue-live -- documents_12 documents_18
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
    all: false, dryRun: false, help: false, indexes: [], lentele: null,
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

  if (options.lentele !== null && !TABLES[options.lentele]) {
    throw new Error(`--lentele turi būti viena iš: ${Object.keys(TABLES).join(", ")}`);
  }
  if (options.minDeadRatio > 100) throw new Error("--min-dead-ratio negali būti daugiau nei 100");
  const numericIndex = options.indexes.find((index) => /^\d+$/.test(index));
  if (numericIndex) {
    throw new Error(
      `„${numericIndex}“ yra tik skaičius. Komandinėje eilutėje nurodykite Quickwit indekso ` +
      `pavadinimą iš stulpelio „quickwit_indeksas“ (pvz. documents_32); ` +
      "sąrašo numeriai naudojami tik interaktyviame pasirinkime",
    );
  }
  const selectors = [options.all, options.indexes.length > 0, options.top !== null, options.topRatio !== null].filter(Boolean);
  if (selectors.length > 1) throw new Error("Naudokite tik vieną pasirinkimo būdą: indeksus, --top, --top-ratio arba --all");
  return options;
}

async function getIndexes({ lentele, minDead, minDeadRatio }) {
  const { rows } = await postgres.query(
    `SELECT i.id, i."lentele", i."indeksas", i."seq", i."current",
            i."gyvosEilutes", i."mirusiosEilutes", i."iterptosEilutes",
            CASE WHEN i."iterptosEilutes" = 0 THEN 0
                 ELSE 100.0 * i."mirusiosEilutes" / i."iterptosEilutes" END AS "deadRatio"
     FROM "quickwitIndeksai" i
     WHERE ($1::text IS NULL OR i."lentele" = $1) AND i."mirusiosEilutes" >= $2
       AND CASE WHEN i."iterptosEilutes" = 0 THEN 0
                ELSE 100.0 * i."mirusiosEilutes" / i."iterptosEilutes" END >= $3
     ORDER BY i."lentele", i."seq"`,
    [lentele, minDead, minDeadRatio],
  );
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    ["deadRatio", "gyvosEilutes", "id", "iterptosEilutes", "mirusiosEilutes", "seq"].includes(key)
      ? [key, Number(value)] : [key, value])));
}

function formatNumber(number) {
  return number.toLocaleString("lt-LT");
}

export function formatIndexesTable(indexes) {
  const columns = [
    { key: "selection", label: "pasirinkimo_nr", align: "right" },
    { key: "table", label: "lentele", align: "left" },
    { key: "index", label: "quickwit_indeksas", align: "left" },
    { key: "live", label: "gyvos", align: "right" },
    { key: "dead", label: "mirusios", align: "right" },
    { key: "ratio", label: "mirusios_%", align: "right" },
    { key: "current", label: "current", align: "left" },
  ];
  const rows = indexes.map((index, i) => ({
    selection: String(i + 1),
    table: index.lentele,
    index: index.indeksas,
    live: formatNumber(index.gyvosEilutes),
    dead: formatNumber(index.mirusiosEilutes),
    ratio: index.deadRatio.toFixed(2),
    current: String(index.current),
  }));
  const widths = Object.fromEntries(columns.map(({ key, label }) => [
    key,
    Math.max(label.length, ...rows.map((row) => row[key].length)),
  ]));
  const formatRow = (row) => columns.map(({ key, align }) =>
    align === "right" ? row[key].padStart(widths[key]) : row[key].padEnd(widths[key])).join("  ");
  const header = Object.fromEntries(columns.map(({ key, label }) => [key, label]));
  const separator = columns.map(({ key }) => "─".repeat(widths[key])).join("  ");
  return [formatRow(header), separator, ...rows.map(formatRow)].join("\n");
}

function printIndexes(indexes) {
  if (!indexes.length) return console.log("Filtrus atitinkančių indeksų nėra.");
  console.log(formatIndexesTable(indexes));
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
    if (!range) throw new Error(`Nesuprasta „pasirinkimo_nr“ reikšmė: ${part.trim()}`);
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    if (from > to || from < 1 || to > indexes.length) {
      throw new Error(`„pasirinkimo_nr“ turi patekti į 1-${indexes.length}: ${part.trim()}`);
    }
    for (let number = from; number <= to; number++) numbers.add(number);
  }
  return [...numbers].map((number) => indexes[number - 1]);
}

function selectIndexes(indexes, options) {
  if (options.indexes.length) {
    const byName = new Map(indexes.map((index) => [index.indeksas, index]));
    const missing = options.indexes.filter((name) => !byName.has(name));
    if (missing.length) {
      throw new Error(
        `Quickwit indeksai nerasti arba neatitinka filtrų: ${missing.join(", ")}. ` +
        "Naudokite „quickwit_indeksas“ stulpelio reikšmes iš --list",
      );
    }
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
    const answer = await rl.question(
      "Įveskite „pasirinkimo_nr“ reikšmes / intervalus (pvz. 1,3-5), „top N“, „ratio N“ arba „all“: ",
    );
    return parseInteractiveSelection(answer, indexes);
  } finally {
    rl.close();
  }
}

export async function requeueIndexes(indexes, { dryRun, lentele }, db = postgres) {
  const table = TABLES[lentele];
  if (!table) {
    throw new Error(
      `Lentelė „${lentele}“ nepalaikoma – nėra indeksavimo eilės aprašo. ` +
      `Palaikomos: ${Object.keys(TABLES).join(", ")}`,
    );
  }
  const names = indexes.map((index) => index.indeksas);
  const indexIds = indexes.map((index) => index.id);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [lentele]);
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM "quickwitEilutes"
       WHERE "indeksaiId" = ANY($1::int[])`,
      [indexIds],
    );
    if (dryRun) {
      await client.query("ROLLBACK");
      return { queuedDeletes: 0, queuedPatches: 0, replacedQueueRows: 0, total: countRows[0].total };
    }

    // Otherwise re-indexed rows could land back in a selected current shard.
    await client.query(`UPDATE "quickwitIndeksai" SET "current" = false WHERE "lentele" = $1 AND "indeksas" = ANY($2::text[])`, [lentele, names]);
    const { rowCount: replacedQueueRows } = await client.query(
      `DELETE FROM ${queueRef(table)} q USING "quickwitEilutes" e
       WHERE e."indeksaiId" = ANY($1::int[])
         AND q."${table.queueId}" = ${table.queueValue ?? `e."eilutesId"::bigint`}`,
      [indexIds],
    );

    const { rowCount: queuedPatches } = await client.query(
      `INSERT INTO ${queueRef(table)} ("${table.queueId}", "${table.changeColumn ?? "keitimas"}")
       SELECT ${table.queueValue ?? `e."eilutesId"::bigint`}, 'patch'
       FROM "quickwitEilutes" e
       JOIN ${sourceRef(table)} s ON s."${table.sourceId}" = ${table.sourceValue ?? `e."eilutesId"::bigint`}
       WHERE e."indeksaiId" = ANY($1::int[])`,
      [indexIds],
    );
    const { rowCount: queuedDeletes } = await client.query(
      `INSERT INTO ${queueRef(table)} ("${table.queueId}", "${table.changeColumn ?? "keitimas"}")
       SELECT ${table.queueValue ?? `e."eilutesId"::bigint`}, 'delete'
       FROM "quickwitEilutes" e
       LEFT JOIN ${sourceRef(table)} s ON s."${table.sourceId}" = ${table.sourceValue ?? `e."eilutesId"::bigint`}
       WHERE e."indeksaiId" = ANY($1::int[]) AND s."${table.sourceId}" IS NULL`,
      [indexIds],
    );
    await client.query("COMMIT");
    // Signalas siunčiamas TIK po commit'o – kitaip taskRunner'is pabustų
    // anksčiau, nei eilės eilutės jam matomos (natsHub publish netransakcinis).
    if (queuedPatches + queuedDeletes > 0) {
      signalWork(table.signal, { source: "quickwit-requeue-live-rows", lentele, indeksai: names });
    }
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

export async function requeueSelectedIndexes(indexes, options, db = postgres) {
  const byTable = Map.groupBy(indexes, (index) => index.lentele);
  const results = [];
  for (const [lentele, tableIndexes] of byTable) {
    results.push(await requeueIndexes(tableIndexes, { ...options, lentele }, db));
  }
  return results.reduce((total, result) => ({
    queuedPatches: total.queuedPatches + result.queuedPatches,
    queuedDeletes: total.queuedDeletes + result.queuedDeletes,
    replacedQueueRows: total.replacedQueueRows + result.replacedQueueRows,
    total: total.total + result.total,
  }), { queuedPatches: 0, queuedDeletes: 0, replacedQueueRows: 0, total: 0 });
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
  const result = await requeueSelectedIndexes(selected, options);
  if (options.dryRun) return console.log(`[dry-run] Į eilę būtų įdėta ${formatNumber(result.total)} gyvų eilučių.`);
  console.log(`Į eilę įdėta ${formatNumber(result.queuedPatches)} patch ir ${formatNumber(result.queuedDeletes)} delete eilučių; pakeista senų eilės eilučių: ${formatNumber(result.replacedQueueRows)}.`);
  console.log("Apdorojus eilę pasirinkti indeksai turės 0 gyvų eilučių ir galės būti ištrinti.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Nepavyko perkelti Quickwit eilučių: ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    // closeNats() drain'ina jungtį – be jo procesas išeitų anksčiau, nei
    // fire-and-forget publish spėtų išsiųsti signalą.
    await closeNats().catch(() => {});
    await postgres.end();
  });
}

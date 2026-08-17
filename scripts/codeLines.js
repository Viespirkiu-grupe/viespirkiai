import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Suskaičiuoja projekto kodo eilutes (be tuščių eilučių ir komentarų) ir surašo
// medį į codeLines.txt: katalogai su sumomis → failai, viskas mažėjančia tvarka.
// Reikalauja `cloc` (apt install cloc).
//
// node scripts/codeLines.js            – visas medis į stdout
// node scripts/codeLines.js --min=100  – plokščias sąrašas failų, didesnių nei
//                                        100 eilučių (be katalogų)
// node scripts/codeLines.js --out      – įrašyti į codeLines.txt

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, "codeLines.txt");

// Katalogai ir šakniniai failai, kuriuose laikomas mūsų kodas.
const SOURCE_PATHSPECS = [
    "modules",
    "src",
    "test",
    "utils",
    "tasks",
    "scripts",
    "runner",
    "benchmarks",
    "quickwit",
    "typesense",
    "postgres",
    "*.ts",
    "*.mjs",
    "*.js",
    "*.sh",
];

// public/ laiko vendorintą PDF.js (~101 000 eilučių) ir statiką – ne mūsų kodas.
const EXCLUDED_PREFIXES = ["public/"];

// JSON – duomenų failai ir package-lock.json (~1 000 000 eilučių), ne kodas.
const EXCLUDED_LANGUAGES = ["JSON", "XML", "SQL"];

const LABEL_WIDTH = 62;

// --min=N / --min N: išvesti tik failus, didesnius nei N eilučių.
function parseMinLines(argv) {
    const index = argv.findIndex((arg) => arg === "--min" || arg.startsWith("--min="));
    if (index === -1) return 0;

    const raw = argv[index].startsWith("--min=") ? argv[index].slice("--min=".length) : argv[index + 1];
    const min = Number(raw);
    if (!Number.isInteger(min) || min < 0) {
        console.error(`Netinkama --min reikšmė: ${raw ?? "(nenurodyta)"}`);
        process.exit(1);
    }

    return min;
}

function git(args) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\n")
        .filter(Boolean);
}

function cloc(files, extraArgs) {
    if (files.length === 0) return new Map();

    const listFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codeLines-")), "files.txt");
    fs.writeFileSync(listFile, files.join("\n"));

    try {
        const csv = execFileSync(
            "cloc",
            [`--list-file=${listFile}`, "--by-file", "--csv", "--timeout", "0", "--quiet", ...extraArgs],
            { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        );
        return parseClocCsv(csv);
    } finally {
        fs.rmSync(path.dirname(listFile), { recursive: true, force: true });
    }
}

// cloc --by-file --csv stulpeliai: language,filename,blank,comment,code
function parseClocCsv(csv) {
    const counts = new Map();

    for (const line of csv.split("\n")) {
        const columns = line.split(",");
        if (columns.length < 5) continue;

        const [language, ...rest] = columns;
        const code = Number(rest.at(-1));
        const filename = rest.slice(0, -3).join(",");
        if (language === "language" || language === "SUM" || !filename || !Number.isFinite(code)) continue;

        counts.set(filename, code);
    }

    return counts;
}

function buildTree(counts) {
    const root = { dirs: new Map(), files: [], total: 0 };

    for (const [filename, code] of counts) {
        const parts = filename.split("/");
        let node = root;

        for (const dir of parts.slice(0, -1)) {
            if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [], total: 0 });
            node = node.dirs.get(dir);
        }

        node.files.push({ name: parts.at(-1), code });
    }

    sumTotals(root);
    return root;
}

function sumTotals(node) {
    let total = 0;
    for (const file of node.files) total += file.code;
    for (const dir of node.dirs.values()) total += sumTotals(dir);

    node.total = total;
    return total;
}

function formatRow(label, indent, code) {
    return `${" ".repeat(indent)}${label}`.padEnd(LABEL_WIDTH) + code.toLocaleString("en-US").padStart(8);
}

function renderTree(node, indent, lines) {
    const dirs = [...node.dirs].sort(([, a], [, b]) => b.total - a.total);
    for (const [name, dir] of dirs) {
        lines.push(formatRow(`${name}/`, indent, dir.total));
        renderTree(dir, indent + 2, lines);
    }

    for (const file of [...node.files].sort((a, b) => b.code - a.code)) {
        lines.push(formatRow(file.name, indent, file.code));
    }

    return lines;
}

// Su --min katalogai nerodomi – plokščias failų sąrašas su pilnais keliais.
function renderFiles(counts, minLines) {
    return [...counts]
        .filter(([, code]) => code > minLines)
        .sort(([, a], [, b]) => b - a)
        .map(([filename, code]) => formatRow(filename, 0, code));
}

const sourceFiles = git(["ls-files", "--", ...SOURCE_PATHSPECS]).filter(
    (file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)),
);
const astroFiles = git(["ls-files", "--", "*.astro"]);

const counts = new Map([
    ...cloc(sourceFiles, [`--exclude-lang=${EXCLUDED_LANGUAGES.join(",")}`]),
    // cloc nepažįsta .astro – frontmatter TypeScript ir šablonas skaičiuojami kaip HTML.
    ...cloc(astroFiles, ["--force-lang=HTML,astro"]),
]);

const minLines = parseMinLines(process.argv.slice(2));
const writeToFile = process.argv.includes("--out");

const root = buildTree(counts);
const lines = [
    "Viešpirkiai — kodo eilutės (be tuščių eilučių ir komentarų)",
    "Neįskaičiuota: node_modules, dist, public/dist/pdfjs (vendorintas PDF.js),",
    `JSON duomenys, ${EXCLUDED_LANGUAGES.slice(1).join(", ")}.`,
    ...(minLines > 0 ? [`Rodomi tik didesni nei ${minLines} eil. failai.`] : []),
    "",
    ...(minLines > 0 ? renderFiles(counts, minLines) : [formatRow(".", 0, root.total), ...renderTree(root, 2, [])]),
    "",
    formatRow(`${counts.size} failai`, 0, root.total),
];

const output = `${lines.join("\n")}\n`;
if (writeToFile) {
    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`${path.relative(ROOT, OUTPUT_FILE)}: ${root.total.toLocaleString("en-US")} eilučių, ${counts.size} failai`);
} else {
    process.stdout.write(output);
}

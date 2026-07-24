import fs from "node:fs/promises";
import path from "node:path";
import { searchIndexPattern } from "./qwHttp.js";

// Dažniausi PDF `creator`/`producer` metaduomenys → tmp/*.txt lentelės.
//   npm run quickwit:top-pdf-metadata

const LIMIT = 1_000;
const OUTPUT_DIR = path.resolve("tmp");

const result = await searchIndexPattern("dokumentai_*", {
    query: "extension:pdf",
    max_hits: 0,
    aggs: {
        creators: {
            terms: {
                field: "metadata.creator",
                size: LIMIT + 100,
                shard_size: 20_000,
            },
        },
        producers: {
            terms: {
                field: "metadata.producer",
                size: LIMIT + 100,
                shard_size: 20_000,
            },
        },
    },
});

const totalPdfs = Number(result.num_hits ?? 0);
const elapsedMs = Number(result.elapsed_time_micros ?? 0) / 1_000;

function normalizeBuckets(buckets) {
    return (buckets ?? [])
        .map((bucket) => ({
            value: String(bucket.key ?? "").replace(/\s+/g, " ").trim(),
            count: Number(bucket.doc_count ?? 0),
        }))
        .filter((bucket) => bucket.value)
        .slice(0, LIMIT);
}

function renderTable(title, field, aggregation) {
    const buckets = normalizeBuckets(aggregation?.buckets);
    const countWidth = Math.max("COUNT".length, ...buckets.map(({ count }) => count.toLocaleString("en-US").length));

    const lines = [
        title,
        `Query: extension:pdf`,
        `Field: ${field}`,
        `Total PDFs: ${totalPdfs.toLocaleString("en-US")}`,
        `Rows: ${buckets.length.toLocaleString("en-US")}`,
        `Document count error upper bound: ${Number(aggregation?.doc_count_error_upper_bound ?? 0).toLocaleString("en-US")}`,
        "",
        `${"RANK".padStart(4)}  ${"COUNT".padStart(countWidth)}  ${"PERCENT".padStart(8)}  VALUE`,
        `${"-".repeat(4)}  ${"-".repeat(countWidth)}  ${"-".repeat(8)}  ${"-".repeat(40)}`,
    ];

    buckets.forEach(({ value, count }, index) => {
        const percent = totalPdfs ? `${((count / totalPdfs) * 100).toFixed(4)}%` : "0.0000%";
        lines.push(
            `${String(index + 1).padStart(4)}  ${count.toLocaleString("en-US").padStart(countWidth)}  ${percent.padStart(8)}  ${value}`,
        );
    });

    return `${lines.join("\n")}\n`;
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const outputs = [
    {
        path: path.join(OUTPUT_DIR, "quickwit-top-pdf-creators.txt"),
        content: renderTable(
            "Top PDF creators",
            "metadata.creator",
            result.aggregations?.creators,
        ),
    },
    {
        path: path.join(OUTPUT_DIR, "quickwit-top-pdf-producers.txt"),
        content: renderTable(
            "Top PDF producers",
            "metadata.producer",
            result.aggregations?.producers,
        ),
    },
];

await Promise.all(outputs.map((output) => fs.writeFile(output.path, output.content)));

console.log(`PDFs: ${totalPdfs.toLocaleString("en-US")}`);
console.log(`Quickwit time: ${elapsedMs.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms`);
for (const output of outputs) console.log(output.path);

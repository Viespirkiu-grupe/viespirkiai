import { searchIndexPattern } from "./qwHttp.js";

// Kiek dokumentų sukurta konkrečiu PDF generatoriumi.
//   npm run quickwit:count-producer -- [--prefix] [gamintojo pavadinimas]

const args = process.argv.slice(2);
const prefix = args.includes("--prefix");
const producer = args.filter((arg) => arg !== "--prefix").join(" ") || "FREE PDFill PDF and Image Writer";
const queryValue = producer.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const query = `metadata.producer:"${queryValue}"${prefix ? "*" : ""}`;

const result = await searchIndexPattern("documents_*", { query, max_hits: 0 });
const elapsedMs = Number(result.elapsed_time_micros ?? 0) / 1_000;

console.log(`Producer: ${producer}`);
console.log(`Match: ${prefix ? "prefix" : "exact"}`);
console.log(`Query: ${query}`);
console.log(`Count: ${Number(result.num_hits ?? 0).toLocaleString("en-US")}`);
console.log(`Quickwit time: ${elapsedMs.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms`);

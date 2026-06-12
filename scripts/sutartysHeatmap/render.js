/**
 * Renderina heatmap.json į PNG. Spalvos — logaritminis intensyvumas
 * (log(1+n) / log(1+maxCell)), juodas fonas, šviesi ląstelė.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHeatmapPixels, rawImage } from "./image.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH  = resolve(__dirname, "heatmap.json");
const OUT_PATH = resolve(__dirname, "heatmap.png");

const data = JSON.parse(readFileSync(IN_PATH, "utf8"));
const { width, height, xs, ys, ns, maxCell } = data;

console.log(`Renderinu ${width}×${height} px, ${xs.length} ne-nuliniai pikseliai.`);

const pixels = createHeatmapPixels({ width, height, xs, ys, ns, maxCell });
const png = await rawImage(pixels, width, height).png().toBuffer();
writeFileSync(OUT_PATH, png);
console.log(`→ ${OUT_PATH}`);

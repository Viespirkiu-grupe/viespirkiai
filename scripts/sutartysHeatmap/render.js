/**
 * Renderina heatmap.json į PNG. Spalvos — logaritminis intensyvumas
 * (log(1+n) / log(1+maxCell)), juodas fonas, šviesi ląstelė.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createCanvas } from "canvas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH  = resolve(__dirname, "heatmap.json");
const OUT_PATH = resolve(__dirname, "heatmap.png");

const data = JSON.parse(readFileSync(IN_PATH, "utf8"));
const { width, height, xs, ys, ns, maxCell } = data;

console.log(`Renderinu ${width}×${height} px, ${xs.length} ne-nuliniai pikseliai.`);

const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, width, height);

const img = ctx.getImageData(0, 0, width, height);
const buf = img.data;
const denom = Math.log1p(maxCell);

for (let i = 0; i < xs.length; i++) {
    const t = Math.log1p(ns[i]) / denom; // 0..1
    const off = (ys[i] * width + xs[i]) * 4;
    // šaltai→šiltai gradientas
    buf[off    ] = Math.round(255 * Math.min(1, t * 1.4));
    buf[off + 1] = Math.round(255 * Math.min(1, t * 0.9));
    buf[off + 2] = Math.round(255 * Math.min(1, 0.3 + t * 0.4));
    buf[off + 3] = 255;
}
ctx.putImageData(img, 0, 0);

writeFileSync(OUT_PATH, canvas.toBuffer("image/png"));
console.log(`→ ${OUT_PATH}`);

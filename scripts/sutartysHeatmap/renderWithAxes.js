/**
 * Kaip render.js, bet su ašimis: Y — log10 sumos etiketės kiekvienai dekadai,
 * X — metų ribos (sausio 1 d.) + metų skaičiai.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createCanvas } from "canvas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH  = resolve(__dirname, "heatmap.json");
const OUT_PATH = resolve(__dirname, "heatmapWithAxes.png");

const PAD_L = 110;   // vietos Y etiketėms
const PAD_B = 40;    // vietos X etiketėms
const PAD_T = 20;
const PAD_R = 20;

const data = JSON.parse(readFileSync(IN_PATH, "utf8"));
const { width, height, xs, ys, ns, maxCell, pxPerDecade, uMin, uMax, dateStart, dateEnd } = data;

const totalW = width  + PAD_L + PAD_R;
const totalH = height + PAD_T + PAD_B;

console.log(`Renderinu ${totalW}×${totalH} px (heatmap ${width}×${height}).`);

const canvas = createCanvas(totalW, totalH);
const ctx = canvas.getContext("2d");

// fonas
ctx.fillStyle = "#0a0a0a";
ctx.fillRect(0, 0, totalW, totalH);
ctx.fillStyle = "#000";
ctx.fillRect(PAD_L, PAD_T, width, height);

// heatmap pikseliai į ImageData
const img = ctx.getImageData(PAD_L, PAD_T, width, height);
const buf = img.data;
const denom = Math.log1p(maxCell);
for (let i = 0; i < xs.length; i++) {
    const t = Math.log1p(ns[i]) / denom;
    const off = (ys[i] * width + xs[i]) * 4;
    buf[off    ] = Math.round(255 * Math.min(1, t * 1.4));
    buf[off + 1] = Math.round(255 * Math.min(1, t * 0.9));
    buf[off + 2] = Math.round(255 * Math.min(1, 0.3 + t * 0.4));
    buf[off + 3] = 255;
}
ctx.putImageData(img, PAD_L, PAD_T);

// ─── Y ašis: po vieną tick'ą kiekvienai dekadai ───
ctx.strokeStyle = "rgba(255,255,255,0.25)";
ctx.fillStyle = "#ddd";
ctx.font = "12px sans-serif";
ctx.textAlign = "right";
ctx.textBaseline = "middle";

function fmtEur(u) {
    if (u === 0) return "0 €";
    const sign = u < 0 ? "−" : "";
    const a = Math.abs(u);
    if (a >= 6) return `${sign}${10 ** (a - 6)} M€`;
    if (a >= 3) return `${sign}${10 ** (a - 3)} k€`;
    return `${sign}${10 ** a} €`;
}

for (let u = uMin; u <= uMax; u++) {
    const yPx = PAD_T + (height - 1 - (u - uMin) * pxPerDecade);
    ctx.beginPath();
    ctx.moveTo(PAD_L - 5, yPx);
    ctx.lineTo(PAD_L + width, yPx);
    ctx.globalAlpha = u === 0 ? 0.5 : 0.15;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(fmtEur(u), PAD_L - 8, yPx);
}

// ─── X ašis: metų ribos ───
ctx.textAlign = "center";
ctx.textBaseline = "top";
const startYear = +dateStart.slice(0, 4);
const endYear   = +dateEnd.slice(0, 4);
let dayCursor = 0;
for (let y = startYear; y <= endYear; y++) {
    const xPx = PAD_L + dayCursor;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(xPx, PAD_T);
    ctx.lineTo(xPx, PAD_T + height + 5);
    ctx.stroke();
    if (y < endYear) {
        const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
        const midX = xPx + (isLeap ? 183 : 182);
        ctx.fillText(String(y), midX, PAD_T + height + 8);
        dayCursor += isLeap ? 366 : 365;
    }
}

// antraštė
ctx.textAlign = "left";
ctx.textBaseline = "top";
ctx.fillStyle = "#aaa";
ctx.font = "11px sans-serif";
ctx.fillText(
    `Sutartys ${dateStart}…${dateEnd}, log10 sumos × diena, maks. ląstelėje ${maxCell}`,
    PAD_L, 4,
);

writeFileSync(OUT_PATH, canvas.toBuffer("image/png"));
console.log(`→ ${OUT_PATH}`);

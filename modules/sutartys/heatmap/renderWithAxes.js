/**
 * Kaip render.js, bet su ašimis: Y — log10 sumos etiketės kiekvienai dekadai,
 * X — metų ribos (sausio 1 d.) + metų skaičiai.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHeatmapPixels, escapeXml, rawImage } from "./image.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH  = resolve(__dirname, "heatmap.json");
const OUT_PATH = resolve(__dirname, "heatmapWithAxes.png");

const PAD_L = 110;   // vietos Y etiketėms
const PAD_B = 40;    // vietos X etiketėms
const PAD_T = 20;
const PAD_R = 20;

const data = JSON.parse(readFileSync(IN_PATH, "utf8"));
const { width, height, maxCell, pxPerDecade, uMin, uMax, dateStart, dateEnd } = data;

const totalW = width  + PAD_L + PAD_R;
const totalH = height + PAD_T + PAD_B;

console.log(`Renderinu ${totalW}×${totalH} px (heatmap ${width}×${height}).`);

function fmtEur(u) {
    if (u === 0) return "0 €";
    const sign = u < 0 ? "−" : "";
    const a = Math.abs(u);
    if (a >= 6) return `${sign}${10 ** (a - 6)} M€`;
    if (a >= 3) return `${sign}${10 ** (a - 3)} k€`;
    return `${sign}${10 ** a} €`;
}

const yAxis = [];
for (let u = uMin; u <= uMax; u++) {
    const yPx = PAD_T + (height - 1 - (u - uMin) * pxPerDecade);
    yAxis.push(
        `<line x1="${PAD_L - 5}" y1="${yPx}" x2="${PAD_L + width}" y2="${yPx}" stroke="white" stroke-opacity="${u === 0 ? 0.5 : 0.15}"/>`,
        `<text x="${PAD_L - 8}" y="${yPx}" text-anchor="end" dominant-baseline="middle">${escapeXml(fmtEur(u))}</text>`,
    );
}

const startYear = +dateStart.slice(0, 4);
const endYear   = +dateEnd.slice(0, 4);
let dayCursor = 0;
const xAxis = [];
for (let y = startYear; y <= endYear; y++) {
    const xPx = PAD_L + dayCursor;
    xAxis.push(`<line x1="${xPx}" y1="${PAD_T}" x2="${xPx}" y2="${PAD_T + height + 5}" stroke="white" stroke-opacity="0.2"/>`);
    if (y < endYear) {
        const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
        const midX = xPx + (isLeap ? 183 : 182);
        xAxis.push(`<text x="${midX}" y="${PAD_T + height + 8}" text-anchor="middle" dominant-baseline="hanging">${y}</text>`);
        dayCursor += isLeap ? 366 : 365;
    }
}

const title = `Sutartys ${dateStart}…${dateEnd}, log10 sumos × diena, maks. ląstelėje ${maxCell}`;
const overlay = Buffer.from(`
    <svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
        <g fill="#ddd" font-family="sans-serif" font-size="12">
            ${yAxis.join("\n")}
            ${xAxis.join("\n")}
        </g>
        <text x="${PAD_L}" y="4" fill="#aaa" font-family="sans-serif" font-size="11" dominant-baseline="hanging">${escapeXml(title)}</text>
    </svg>
`);
const pixels = createHeatmapPixels(data, {
    outputWidth: totalW,
    outputHeight: totalH,
    offsetX: PAD_L,
    offsetY: PAD_T,
    background: [10, 10, 10],
    heatmapBackground: [0, 0, 0],
});
const png = await rawImage(pixels, totalW, totalH)
    .composite([{ input: overlay }])
    .png()
    .toBuffer();
writeFileSync(OUT_PATH, png);
console.log(`→ ${OUT_PATH}`);

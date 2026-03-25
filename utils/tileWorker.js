/**
 * Worker thread script for rendering map tile PNGs using node-canvas.
 * Receives tile data via workerData, returns a PNG Buffer via parentPort.
 */
import { workerData, parentPort } from "worker_threads";
import { createCanvas } from "canvas";

const { rows, TILE_SIZE, scale, minTileX, minTileY } = workerData;

const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
const ctx = canvas.getContext("2d");
ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

if (rows.length > 0) {
    const maxCount = Math.max(...rows.map((r) => r.pointCount), 1);

    for (const row of rows) {
        const fx = (row.tileX - minTileX) / scale;
        const fy = (row.tileY - minTileY) / scale;
        const px = fx * TILE_SIZE;
        const py = fy * TILE_SIZE;
        const pw = TILE_SIZE / scale;
        const ph = TILE_SIZE / scale;
        const intensity =
            Math.log10(row.pointCount + 1) / Math.log10(maxCount + 1);
        ctx.fillStyle = `rgba(255,${Math.round(255 * (1 - intensity))},0,${Math.min(Math.max(intensity, 0), 1)})`;
        ctx.fillRect(px, py, pw, ph);
    }
}

const buffer = canvas.toBuffer("image/png");
parentPort.postMessage(buffer, [buffer.buffer]);

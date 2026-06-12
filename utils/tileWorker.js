/**
 * Worker thread script for rendering map tile PNGs.
 * Receives tile data via workerData, returns a PNG Buffer via parentPort.
 */
import { workerData, parentPort } from "worker_threads";
import { encodeRgbaPng } from "./png.js";

const { rows, TILE_SIZE, scale, minTileX, minTileY } = workerData;

const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);

if (rows.length > 0) {
    const maxCount = Math.max(...rows.map((r) => r.pointCount), 1);

    for (const row of rows) {
        const px = ((row.tileX - minTileX) * TILE_SIZE) / scale;
        const py = ((row.tileY - minTileY) * TILE_SIZE) / scale;
        const size = TILE_SIZE / scale;
        if (![px, py, size].every(Number.isInteger)) {
            throw new RangeError("Tile cells must align to whole pixels");
        }
        const intensity =
            Math.log10(row.pointCount + 1) / Math.log10(maxCount + 1);
        const green = Math.round(255 * (1 - intensity));
        const alpha = Math.floor(255 * Math.min(Math.max(intensity, 0), 1));

        for (let y = py; y < py + size; y++) {
            for (let x = px; x < px + size; x++) {
                const offset = (y * TILE_SIZE + x) * 4;
                pixels[offset] = 255;
                pixels[offset + 1] = green;
                pixels[offset + 3] = alpha;
            }
        }
    }
}

const buffer = encodeRgbaPng(TILE_SIZE, TILE_SIZE, pixels);
const transferable = Uint8Array.from(buffer);
parentPort.postMessage(transferable, [transferable.buffer]);

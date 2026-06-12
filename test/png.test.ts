import { Worker } from "node:worker_threads";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeRgbaPng } from "../utils/png.js";

function readPixels(png: Buffer) {
    const idatChunks: Buffer[] = [];
    let offset = 8;

    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        if (type === "IDAT") {
            idatChunks.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += length + 12;
    }

    return inflateSync(Buffer.concat(idatChunks));
}

function getPixel(scanlines: Buffer, width: number, x: number, y: number) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    return [...scanlines.subarray(offset, offset + 4)];
}

describe("encodeRgbaPng", () => {
    it("encodes RGBA pixels as unfiltered PNG scanlines", () => {
        const pixels = Buffer.from([
            0, 0, 0, 0,
            255, 127, 0, 128,
        ]);

        const png = encodeRgbaPng(2, 1, pixels);

        expect(png.subarray(0, 8)).toEqual(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
        expect(readPixels(png)).toEqual(Buffer.from([0, ...pixels]));
    });

    it("rejects a pixel buffer with mismatched dimensions", () => {
        expect(() => encodeRgbaPng(2, 2, Buffer.alloc(4))).toThrow(RangeError);
    });
});

describe("tileWorker", () => {
    it("renders and transfers a map tile without canvas", async () => {
        const worker = new Worker(new URL("../utils/tileWorker.js", import.meta.url), {
            execArgv: [],
            workerData: {
                rows: [
                    { tileX: 10, tileY: 20, pointCount: 1 },
                    { tileX: 11, tileY: 20, pointCount: 3 },
                ],
                TILE_SIZE: 4,
                scale: 2,
                minTileX: 10,
                minTileY: 20,
            },
        });
        const png = Buffer.from(
            await new Promise((resolve, reject) => {
                worker.once("message", resolve);
                worker.once("error", reject);
            }),
        );
        const scanlines = readPixels(png);

        expect(getPixel(scanlines, 4, 0, 0)).toEqual([255, 128, 0, 127]);
        expect(getPixel(scanlines, 4, 2, 0)).toEqual([255, 0, 0, 255]);
        expect(getPixel(scanlines, 4, 0, 2)).toEqual([0, 0, 0, 0]);
    });
});

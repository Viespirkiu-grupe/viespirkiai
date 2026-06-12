import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    CRC_TABLE[index] = crc >>> 0;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const chunk = Buffer.allocUnsafe(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    typeBuffer.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)), data.length + 8);
    return chunk;
}

export function encodeRgbaPng(width, height, pixels) {
    if (pixels.length !== width * height * 4) {
        throw new RangeError("RGBA pixel buffer size does not match PNG dimensions");
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;

    const stride = width * 4;
    const scanlines = Buffer.allocUnsafe((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const scanlineOffset = y * (stride + 1);
        scanlines[scanlineOffset] = 0;
        pixels.copy(scanlines, scanlineOffset + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        createChunk("IHDR", header),
        createChunk("IDAT", deflateSync(scanlines)),
        createChunk("IEND", Buffer.alloc(0)),
    ]);
}

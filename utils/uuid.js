import { randomBytes } from "node:crypto";

// UUIDv7: 48-bit ms timestamp + 74 random bits + version/variant. Time-ordered
// → INSERTs hit the right edge of any uuid btree (hot pages, low I/O), vs
// random v4 which dirties pages across the whole index.
export function uuidv7() {
    const b = randomBytes(16);
    const ts = Date.now();
    b[0] = (ts / 2 ** 40) & 0xff;
    b[1] = (ts / 2 ** 32) & 0xff;
    b[2] = (ts >>> 24) & 0xff;
    b[3] = (ts >>> 16) & 0xff;
    b[4] = (ts >>> 8) & 0xff;
    b[5] = ts & 0xff;
    b[6] = (b[6] & 0x0f) | 0x70; // version 7
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

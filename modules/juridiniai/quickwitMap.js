import { searchIndexPattern } from "../../quickwit/qwHttp.js";
import { buildJuridiniaiQuickwitQuery } from "./searchQuickwit.js";

const MAX_ZOOM = 19;

export function mortonKey(x, y, zoom) {
    let key = 0n;
    for (let bit = 0n; bit < BigInt(zoom); bit++) {
        key |= ((BigInt(x) >> bit) & 1n) << (2n * bit);
        key |= ((BigInt(y) >> bit) & 1n) << (2n * bit + 1n);
    }
    return Number(key);
}

export function decodeMorton(key, zoom) {
    let x = 0n;
    let y = 0n;
    const value = BigInt(key);
    for (let bit = 0n; bit < BigInt(zoom); bit++) {
        x |= ((value >> (2n * bit)) & 1n) << bit;
        y |= ((value >> (2n * bit + 1n)) & 1n) << bit;
    }
    return { x: Number(x), y: Number(y) };
}

export function tileCenter(x, y, zoom) {
    const n = 2 ** zoom;
    const lon = (x + 0.5) / n * 360 - 180;
    const mercator = Math.PI * (1 - 2 * (y + 0.5) / n);
    const lat = Math.atan(Math.sinh(mercator)) * 180 / Math.PI;
    return { lat, lon };
}

async function mortonBuckets(field, query, size) {
    const data = await searchIndexPattern("juridiniai_*", {
        query,
        max_hits: 0,
        aggs: { cells: { terms: { field, size } } },
        format: "json",
    });
    return data?.aggregations?.cells?.buckets ?? [];
}

export async function juridiniaiTileCells(query, zoom, tileX, tileY) {
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 15) return [];
    const targetZoom = zoom + 4;
    const parentKey = mortonKey(tileX, tileY, zoom);
    const base = buildJuridiniaiQuickwitQuery(query);
    const scope = `geo.z${zoom}:${parentKey}`;
    const scopedQuery = base === "*" ? scope : `(${base}) AND ${scope}`;
    const buckets = await mortonBuckets(`geo.z${targetZoom}`, scopedQuery, 256);
    return buckets.map((bucket) => {
        const { x, y } = decodeMorton(bucket.key, targetZoom);
        return [x - tileX * 16, y - tileY * 16, Number(bucket.doc_count)];
    }).filter(([x, y]) => x >= 0 && x < 16 && y >= 0 && y < 16);
}

export async function juridiniaiViewportPoints(query, bounds, size = 5000) {
    const base = buildJuridiniaiQuickwitQuery(query);
    const area = `geo.lat:[${bounds.minLat} TO ${bounds.maxLat}] AND geo.lon:[${bounds.minLon} TO ${bounds.maxLon}]`;
    const scopedQuery = base === "*" ? area : `(${base}) AND ${area}`;
    const buckets = await mortonBuckets(`geo.z${MAX_ZOOM}`, scopedQuery, size);
    return buckets.map((bucket) => {
        const key = Number(bucket.key);
        const { x, y } = decodeMorton(key, MAX_ZOOM);
        const { lat, lon } = tileCenter(x, y, MAX_ZOOM);
        return [lat, lon, key, Number(bucket.doc_count)];
    });
}

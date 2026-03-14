/**
 * Compare two 2D coordinates with a tolerance.
 *
 * @param {[number, number]} a - First coordinate [x, y].
 * @param {[number, number]} b - Second coordinate [x, y].
 * @param {number} [eps=1e-9] - Tolerance for floating-point comparison.
 * @returns {boolean} True if both coordinates are equal within the given tolerance.
 */
export function coordsEqual(a, b, eps = 1e-9) {
    return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

/**
 * Build lookup maps for OSM nodes and ways.
 *
 * Creates:
 * - a node map from node ID to coordinate pair [lon, lat]
 * - a way map from way ID to an ordered array of coordinates resolved from node IDs
 *
 * Nodes without coordinates and ways with fewer than two valid points are ignored.
 *
 * @param {Array<Object>} elements - OSM elements array (nodes and ways).
 * @returns {{ nodeMap: Map<number, [number, number]>, wayMap: Map<number, Array<[number, number]>> }}
 * An object containing:
 * - nodeMap: Map of node ID → [lon, lat]
 * - wayMap: Map of way ID → array of [lon, lat] coordinates
 */
export function buildNodeWayMaps(elements) {
    const nodeMap = new Map();
    const wayMap = new Map();

    for (const el of elements) {
        if (el.type === "node") nodeMap.set(el.id, [el.lon, el.lat]);
    }

    for (const el of elements) {
        if (el.type === "way" && el.nodes) {
            const coords = el.nodes
                .map((id) => nodeMap.get(id))
                .filter(Boolean);
            if (coords.length > 1) wayMap.set(el.id, coords);
        }
    }

    return { nodeMap, wayMap };
}

/**
 * Extract outer and inner ways from relation members using a way lookup map.
 *
 * Resolves way references to their coordinate arrays and groups them by role.
 * Members that are not ways or missing from the way map are ignored.
 *
 * @param {Array<Object>} members - Relation members (typically from OSM data).
 * @param {Map<number, Array<[number, number]>>} wayMap - Map of way ID → coordinates.
 * @returns {{ outerWays: Array<Array<[number, number]>>, innerWays: Array<Array<[number, number]>> }}
 * An object containing arrays of outer and inner way coordinate sequences.
 */
export function extractWays(members, wayMap) {
    const outerWays = [];
    const innerWays = [];

    for (const m of members) {
        if (m.type !== "way" || !wayMap.has(m.ref)) continue;
        const coords = wayMap.get(m.ref);
        if (m.role === "outer") outerWays.push(coords);
        else if (m.role === "inner") innerWays.push(coords);
    }

    return { outerWays, innerWays };
}

/**
 * Connects an array of ways into closed rings by matching endpoints.
 *
 * Each way is represented as an array of coordinates. Ways sharing start or end nodes
 * are concatenated, reversing as needed, to form continuous rings. The function ensures
 * each resulting ring is closed by repeating the first coordinate at the end if necessary.
 *
 * @param {Array<Array<[number, number]>>} ways - Array of ways, each as an array of [lon, lat] coordinates.
 * @returns {Array<Array<[number, number]>>} An array of closed rings, each as an array of coordinates.
 */
export function walkWays(ways) {
    const nodeToWays = new Map();
    ways.forEach((w, idx) => {
        const startKey = w[0].join(",");
        const endKey = w[w.length - 1].join(",");
        if (!nodeToWays.has(startKey)) nodeToWays.set(startKey, []);
        if (!nodeToWays.has(endKey)) nodeToWays.set(endKey, []);
        nodeToWays.get(startKey).push({ idx, reversed: false });
        nodeToWays.get(endKey).push({ idx, reversed: true });
    });

    const used = new Set();
    const rings = [];

    for (let i = 0; i < ways.length; i++) {
        if (used.has(i)) continue;
        let ring = [...ways[i]];
        used.add(i);

        let front = ring[ring.length - 1];
        let back = ring[0];

        while (true) {
            const frontKey = front.join(",");
            const candidates = nodeToWays.get(frontKey) || [];
            let found = false;
            for (const c of candidates) {
                if (used.has(c.idx)) continue;
                let w = ways[c.idx];
                if (c.reversed) w = [...w].reverse();
                ring = ring.concat(w.slice(1));
                front = ring[ring.length - 1];
                used.add(c.idx);
                found = true;
                break;
            }
            if (!found) break;
        }

        while (true) {
            const backKey = back.join(",");
            const candidates = nodeToWays.get(backKey) || [];
            let found = false;
            for (const c of candidates) {
                if (used.has(c.idx)) continue;
                let w = ways[c.idx];
                if (!c.reversed) w = [...w].reverse();
                ring = w.slice(0, -1).concat(ring);
                back = ring[0];
                used.add(c.idx);
                found = true;
                break;
            }
            if (!found) break;
        }

        if (!coordsEqual(ring[0], ring[ring.length - 1])) {
            ring.push(ring[0]);
        }

        rings.push(ring);
    }

    return rings;
}

/**
 * Parses a PostGIS EWKB hex string into a lat/lng coordinate pair.
 * Supports both standard WKB and EWKB (with embedded SRID).
 * Handles little-endian and big-endian byte orders.
 * Also accepts a plain "lat,lon" string as a fallback.
 *
 * @param {string} hex - PostGIS WKB/EWKB hex string or a "lat,lon" string.
 * @returns {{ lat: number, lon: number } | null} Parsed coordinate pair, or null if invalid.
 *
 * @example
 * parseWKBPoint("0101000020E6100000A9722910B24B374050D287DFEBF64B40");
 * // { lat: 55.846302..., lon: 23.319561... }
 *
 * @example
 * parseWKBPoint("55.84630277777778,23.31956111111111");
 * // { lat: 55.846302..., lon: 23.319561... }
 */
export function parseWKBPoint(hex) {
    if (!hex) return null;
    const str = hex.trim();

    if (str.includes(",")) {
        const [latStr, lngStr] = str.split(",");
        const lat = parseFloat(latStr);
        const lon = parseFloat(lngStr);
        return isNaN(lat) || isNaN(lon) ? null : { lat, lon };
    }

    const buf = Buffer.from(str, "hex");
    if (buf.length < 25) return null;

    const isLE = buf[0] === 1;
    const lon = isLE ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
    const lat = isLE ? buf.readDoubleLE(17) : buf.readDoubleBE(17);

    return { lat, lon };
}

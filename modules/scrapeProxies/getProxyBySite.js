import { postgres } from "../../postgres/postgres.js";

// Proxy sąrašas keičiasi retai, o jo reikia kiekvienai užklausai —
// cache'uojame eilučių sąrašą, atsitiktinį proxy parenkame per kvietimą.
// Proxy įjungimas/išjungimas DB propaguojasi iki TTL.
const TTL_MS = 10_000;

const cache = new Map(); // `${site}:${type}` -> { rows, time }

export async function getProxyBySite(site, { type = "httpReverse" } = {}) {
    const key = `${site}:${type}`;
    const cached = cache.get(key);
    let rows;
    if (cached && Date.now() - cached.time < TTL_MS) {
        rows = cached.rows;
    } else {
        const res = await postgres.query(
            `SELECT * FROM "scrapeProxies" WHERE enabled = true AND site = $1 AND type = $2`,
            [site, type],
        );
        rows = res.rows;
        cache.set(key, { rows, time: Date.now() });
    }
    if (rows.length === 0) return null;
    return rows[Math.floor(Math.random() * rows.length)];
}

import { postgres } from "../../postgres/postgres.js";
import { registerScrapeOrigin } from "../../utils/scrapeTarget.js";

// Proxy `site` → viešas šaltinio adresas, kurį reikia matyti scrapeLog'e.
// Šie reverse proxy kelią atkartoja vienas su vienu, tad užtenka pakeisti
// origin'ą. `cvpp` čia nėra sąmoningai: jo proxy turi savo kelių schemą, tad
// loginis adresas paduodamas rankomis kvietimo vietoje.
const SITE_PUBLIC_URLS = {
    eviesiejipirkimai: "https://eviesiejipirkimai.lt",
    mwEviesiejipirkimai: "https://mw.eviesiejipirkimai.lt",
    viesiejipirkimai: "https://viesiejipirkimai.lt",
};

// Proxy sąrašas keičiasi retai, o jo reikia kiekvienai užklausai —
// cache'uojame eilučių sąrašą, atsitiktinį proxy parenkame per kvietimą.
// Proxy įjungimas/išjungimas DB propaguojasi iki TTL.
const TTL_MS = 10_000;

const cache = new Map(); // `${site}:${types}` -> { rows, time }

/**
 * Atsitiktinis įjungtas proxy svetainei. `type` gali būti ir sąrašas — tada
 * renkamasi iš visų nurodytų tipų (pvz. httpReverse ir socks5 kartu), kad
 * transportą lemtų DB eilutės, o ne kvietimo vieta.
 * @param {string} site
 * @param {{ type?: string|string[] }} [options]
 */
export async function getProxyBySite(site, { type = "httpReverse" } = {}) {
    const types = (Array.isArray(type) ? type : [type]).slice().sort();
    const key = `${site}:${types.join(",")}`;
    const cached = cache.get(key);
    let rows;
    if (cached && Date.now() - cached.time < TTL_MS) {
        rows = cached.rows;
    } else {
        const res = await postgres.query(
            `SELECT * FROM infra."scrapeProxies" WHERE enabled = true AND site = $1 AND type = ANY($2)`,
            [site, types],
        );
        rows = res.rows;
        cache.set(key, { rows, time: Date.now() });
    }
    if (rows.length === 0) return null;
    const proxy = rows[Math.floor(Math.random() * rows.length)];
    // socks5 užklausa eina tikruoju adresu, tad perrašyti nieko nereikia.
    if (proxy.type !== "socks5" && SITE_PUBLIC_URLS[site]) {
        registerScrapeOrigin(proxy.url, SITE_PUBLIC_URLS[site]);
    }
    return proxy;
}

/** Tik testams — eilučių cache gyvena modulio lygyje. */
export function resetProxyCache() {
    cache.clear();
}

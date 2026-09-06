/*
Užklausos paruošimas pagal `scrapeProxies` eilutę.

Lentelės `type` nurodo transportą, o ne šaltinį:

  httpReverse — reverse proxy, atkartojantis šaltinio kelius. Šaltinio kelias
                prikabinamas prie proxy adreso, tad veikia ir šaknis
                (`http://10.1.10.2:9203`), ir kelio prefiksas
                (`http://10.1.10.2:6969/vpmis`).
  socks5      — SOCKS5 tunelis, `socks5://user:pass@ip:port`. URL nesikeičia,
                užklausa tuneliuojama per agentą. Agentui reikia node-fetch:
                globalus fetch `agent` opcijos nepriima (tas pats sprendimas
                kaip `modules/domenai/scrapeDomreg.js`). Prisijungimo duomenys
                ir portas neobligatoriški (be porto — 1080); veikia ir
                `socks5h://`, kai DNS turi būti sprendžiamas proxy pusėje.

Kad ir kuris transportas pasitaikytų, scrapeLog'e lieka viešas šaltinio adresas:
httpReverse origin'ą atgal perrašo `utils/scrapeTarget.js` registras, o socks5
atveju užklausa ir taip eina tikruoju adresu.
*/

import nodeFetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { getProxyBySite } from "./getProxyBySite.js";

/** Transportai, kuriuos moka šis modulis. */
export const PROXY_TYPES = ["httpReverse", "socks5"];

// Agentas laiko TCP jungčių poolą, tad kuriamas po vieną kiekvienam proxy.
const agents = new Map();

function socksAgent(proxyUrl) {
    let agent = agents.get(proxyUrl);
    if (!agent) {
        agent = new SocksProxyAgent(proxyUrl);
        agents.set(proxyUrl, agent);
    }
    return agent;
}

/**
 * Paruošia užklausą svetainei per parinktą proxy.
 * @param {string} site `scrapeProxies.site` reikšmė
 * @param {string} url Tikrasis šaltinio URL
 * @param {{ type?: string|string[], useProxy?: boolean }} [options]
 * @returns {Promise<{ url: string, init: object, meta: object, proxy: object|null }>}
 *   `init` ir `meta` išskleidžiami į `scrapeFetch(url, { ...init }, { ...meta })`.
 */
export async function proxyRequest(site, url, { type = PROXY_TYPES, useProxy = true } = {}) {
    const proxy = useProxy === false ? null : await getProxyBySite(site, { type });
    if (!proxy) return { url, init: {}, meta: {}, proxy: null };

    if (proxy.type === "socks5") {
        return {
            url,
            init: { agent: socksAgent(proxy.url) },
            meta: { fetchImpl: nodeFetch },
            proxy,
        };
    }

    // Proxy adresas gali turėti kelio prefiksą (`http://10.1.10.2:6969/vpmis`) —
    // jis prirašomas prieš šaltinio kelią, kitaip užklausa nueitų į proxy šaknį.
    const source = new URL(url);
    const proxyUrl = new URL(proxy.url);
    const prefix = proxyUrl.pathname.replace(/\/+$/, "");
    const target = new URL(prefix + source.pathname + source.search, proxyUrl.origin);
    return { url: target.toString(), init: {}, meta: {}, proxy };
}

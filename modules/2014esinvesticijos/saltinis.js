/*
Bendra darbo su 2014.esinvesticijos.lt dalis: sesija, adresai, HTML parsiuntimas.

Sąrašo puslapio dydį lemia sesijoje įrašytas `wrap` – be jo puslapyje 25 eilutės
(1632 puslapiai), su 1000 užtenka 41 užklausos. Todėl prieš sąrašo nuskaitymą
visada pasiimama sesija ir jai nustatomas wrap=1000.
*/

import { createScraperFetch } from "../../utils/scrapeFetch.js";
import { log } from "../../utils/log.js";

const scrapeFetch = createScraperFetch("2014esinvesticijos", {
    operation: "scrape",
});

const BAZE = "https://2014.esinvesticijos.lt";
const SARASO_KELIAS = "/lt//finansavimas/paraiskos_ir_projektai";
const PRIEMONIU_KELIAS = "/lt//finansavimas/patvirtintos_priemones";
const SESIJOS_TTL = 15 * 60 * 1000;
const BANDYMAI = 3;

const NAUDOTOJO_AGENTAS =
    "Pilietine iniciatyva Viespirkiai <viespirkiai@viespirkiai.org>";

let sesija = null;
let sesijaNuo = 0;

/**
 * PHPSESSID su nustatytu 1000 eilučių sąrašo puslapiu.
 * @param {number} eiluciuPuslapyje
 * @returns {Promise<string>} Cookie antraštės reikšmė
 */
export async function gautiSesija(eiluciuPuslapyje = 1000) {
    if (sesija && Date.now() - sesijaNuo < SESIJOS_TTL) return sesija;

    const atsakymas = await scrapeFetch(`${BAZE}/lt`);
    const phpSessId = atsakymas.headers
        .get("set-cookie")
        ?.match(/PHPSESSID=([^;]+)/)?.[1];
    if (!phpSessId) throw new Error("Nepavyko gauti PHPSESSID");

    const cookie = `PHPSESSID=${phpSessId}`;
    await scrapeFetch(`${BAZE}/lt/general/setwrap`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookie,
        },
        body: new URLSearchParams({
            module: "applications",
            action: "listing_item",
            wrap: String(eiluciuPuslapyje),
        }),
    });

    sesija = cookie;
    sesijaNuo = Date.now();
    return sesija;
}

/**
 * Parsiunčia HTML su pakartojimais 5xx/429 atvejais.
 * @param {string} url
 * @param {{cookie?: string, bandymas?: number}} [nustatymai]
 * @returns {Promise<string>}
 */
export async function parsisiustiHtml(url, nustatymai = {}) {
    const { cookie, bandymas = 0 } = nustatymai;
    const atsakymas = await scrapeFetch(url, {
        headers: {
            "User-Agent": NAUDOTOJO_AGENTAS,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "lt,en;q=0.8",
            ...(cookie ? { Cookie: cookie } : {}),
        },
    });

    if (!atsakymas.ok) {
        const kartotina = atsakymas.status >= 500 || atsakymas.status === 429;
        if (kartotina && bandymas < BANDYMAI) {
            const laukti = 500 * 2 ** bandymas + Math.random() * 500;
            log(`HTTP ${atsakymas.status} ${url} – kartojama po ${Math.round(laukti)}ms`);
            await new Promise((r) => setTimeout(r, laukti));
            return parsisiustiHtml(url, { cookie, bandymas: bandymas + 1 });
        }
        throw new Error(`HTTP ${atsakymas.status} ${url}`);
    }

    return atsakymas.text();
}

/**
 * @param {number} puslapis Puslapio numeris nuo 1
 * @returns {string}
 */
export function sarasoUrl(puslapis) {
    return `${BAZE}${SARASO_KELIAS}?page=${puslapis}`;
}

/**
 * @param {string} slug
 * @returns {string}
 */
export function projektoUrl(slug) {
    return `${BAZE}${SARASO_KELIAS}/${slug}`;
}

/**
 * @param {string} slug
 * @returns {string}
 */
export function priemonesUrl(slug) {
    return `${BAZE}${PRIEMONIU_KELIAS}/${slug}`;
}

/**
 * Priemonių sąrašas – visos priemonės viename puslapyje.
 * @returns {string}
 */
export function priemoniuSarasoUrl() {
    return `${BAZE}${PRIEMONIU_KELIAS}`;
}

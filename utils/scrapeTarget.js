/*
Loginis scrapinimo adresas — tas, kur užklausa eina PAGAL IDĖJĄ.

Dalis šaltinių imami ne tiesiogiai: vieni per reverse proxy iš `scrapeProxies`
lentelės (kai šaltinis riboja užklausas pagal IP), kiti per vidinį mirror,
nurodytą `*_URL` env kintamuoju. Dėl to faktinis užklausos `host` yra vidinis
IP, ir scrapeLog'e šaltinio nebeįmanoma atpažinti: `domain` facete kaupiasi
`10.1.10.1`, o filtras `domain: eviesiejipirkimai.lt` neranda nieko.

Transportas (kuris proxy ar mirror pasitaikė) yra konfigūracijos detalė ir loge
nereikalingas — čia origin'as perrašomas atgal į viešąjį šaltinio adresą, o
kelias ir query lieka nepakitę. Registrą pildo du keliai: statiškai — mirror'ai
iš konfigūracijos, dinamiškai — `getProxyBySite`, parinkęs proxy eilutę.
*/

import config from "./config.js";

/** Vidiniai mirror'ai iš konfigūracijos: config raktas → viešas šaltinis. */
const MIRROR_SOURCES = [
    ["viesiejiPirkimaiUrl", "https://viesiejipirkimai.lt"],
    ["kotisUrl", "https://kotis.kt.gov.lt"],
    ["dataGovUrl", "https://get.data.gov.lt"],
];

/**
 * Faktinis originas → sąrašas atvaizdavimų, surikiuotas nuo ilgiausio kelio
 * prefikso. Prefikso reikia, nes reverse proxy gali sėdėti po keliu
 * (`http://10.1.10.2:6969/vpmis`), o tas kelias šaltiniui nepriklauso.
 */
const origins = new Map();

/** URL suskaidymas į originą ir kelio prefiksą (be pabaigos brūkšnio). */
function basePartsOf(value) {
    try {
        const url = new URL(String(value));
        return { origin: url.origin, prefix: url.pathname.replace(/\/+$/, "") };
    } catch {
        return null;
    }
}

/**
 * Užregistruoja, kad užklausos į `actualUrl` iš tikrųjų eina į `publicUrl`.
 * Kviesti galima kelis kartus — tas pats atvaizdavimas tik perrašomas.
 */
export function registerScrapeOrigin(actualUrl, publicUrl) {
    const from = basePartsOf(actualUrl);
    const to = basePartsOf(publicUrl);
    if (!from || !to) return;
    if (from.origin === to.origin && from.prefix === to.prefix) return;

    const entries = (origins.get(from.origin) ?? [])
        .filter((entry) => entry.prefix !== from.prefix);
    entries.push({ prefix: from.prefix, target: to.origin + to.prefix });
    entries.sort((a, b) => b.prefix.length - a.prefix.length);
    origins.set(from.origin, entries);
}

for (const [key, publicUrl] of MIRROR_SOURCES) {
    registerScrapeOrigin(config[key], publicUrl);
}

/**
 * URL, kurį reikia rašyti į scrapeLog: vidinis originas (su prefiksu, jei toks
 * yra) pakeistas viešuoju. Nežinomas adresas grąžinamas nepakitęs, kad
 * wrapperis niekada nesugriūtų.
 * @param {string|URL|{url?: string}} input
 */
export function scrapeTargetUrl(input) {
    const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return input;
    }
    const entries = origins.get(url.origin);
    if (!entries) return input;
    const matched = entries.find((entry) => entry.prefix === ""
        || url.pathname === entry.prefix
        || url.pathname.startsWith(`${entry.prefix}/`));
    if (!matched) return input;
    const rest = url.pathname.slice(matched.prefix.length) || "/";
    return matched.target + rest + url.search;
}

/** Tik testams — registras yra modulio lygio ir tarp testų neatsistato. */
export function resetScrapeOrigins() {
    origins.clear();
    for (const [key, publicUrl] of MIRROR_SOURCES) {
        registerScrapeOrigin(config[key], publicUrl);
    }
}

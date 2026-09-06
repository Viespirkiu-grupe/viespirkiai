/*
Antraščių paruošimas persiuntimui.

Šaltinis nebūtinai laikosi RFC: `content-disposition` su lietuviško failo vardu
gali atkeliauti su simboliu, kurio Node į atsakymą įrašyti neleidžia
(`ERR_INVALID_CHAR`), ir tokia viena antraštė nuversdavo visą proxy procesą.
Todėl reikšmės valomos, o ne tikimasi, kad bus tvarkingos.

Leistina antraštės reikšmė Node'e: tab, `\\x20`-`\\x7e` ir `\\x80`-`\\xff`.
Viskas kita (CR, LF, NUL ir kiti valdymo simboliai) išmetama — CR/LF dar ir
todėl, kad per juos įmanoma įsprausti papildomą antraštę.
*/

// Hop-by-hop antraštės pagal RFC 7230 §6.1 — jos aprašo vieną jungtį, tad
// persiųsti jas į kitą jungtį negalima.
export const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

const INVALID_HEADER_CHAR = /[^\t\x20-\x7e\x80-\xff]/g;

/** Reikšmė be neleistinų simbolių; `null`, jei nieko tinkamo nebeliko. */
export function sanitizeHeaderValue(value) {
    const cleaned = String(value).replace(INVALID_HEADER_CHAR, "").trim();
    return cleaned === "" ? null : cleaned;
}

/**
 * Antraštės iš šaltinio atsakymo į klientui rašomas antraštes.
 * @param {Record<string, string|string[]|undefined>} incoming
 * @param {{ rewrite?: (name: string, value: string) => string, onWarn?: (message: string) => void }} [options]
 *   `rewrite` kviečiamas jau išvalytai reikšmei (naudojama `location`).
 */
export function forwardHeaders(incoming, { rewrite, onWarn } = {}) {
    const headers = {};
    for (const [name, raw] of Object.entries(incoming)) {
        if (raw === undefined) continue;
        const lower = name.toLowerCase();
        if (HOP_BY_HOP.has(lower)) continue;

        const values = (Array.isArray(raw) ? raw : [raw]).map(String);
        const kept = [];
        for (const value of values) {
            const cleaned = sanitizeHeaderValue(value);
            if (cleaned === null) {
                onWarn?.(`išmesta antraštė ${lower}: ${JSON.stringify(value)}`);
                continue;
            }
            if (cleaned !== value) {
                onWarn?.(`išvalyta antraštė ${lower}: ${JSON.stringify(value)}`);
            }
            kept.push(rewrite ? rewrite(lower, cleaned) : cleaned);
        }
        if (kept.length === 0) continue;
        headers[name] = Array.isArray(raw) ? kept : kept[0];
    }
    return headers;
}

/** Antraštės į šaltinį: be hop-by-hop ir su šaltinio `Host`. */
export function outgoingHeaders(incoming, target) {
    const headers = forwardHeaders(incoming);
    delete headers.host;
    delete headers.Host;
    headers.host = target.host;
    return headers;
}

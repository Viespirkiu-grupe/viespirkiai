/*
Teksto pavertimas duomenimis 2014.esinvesticijos.lt puslapiuose.
Šaltinis rašo lietuviškai: „1 192 175,00 Eur“, o tuščią reikšmę žymi brūkšniu.
*/

const TUSCIA = new Set(["", "–", "-", "—", "&ndash;"]);

/**
 * Sutvarko tarpus į vieną: `\s` JS'e apima ir nedalomus tarpus (U+00A0, U+202F),
 * kurių šaltinis pilnas sumose.
 * @param {string|null|undefined} tekstas
 * @returns {string}
 */
export function valyti(tekstas) {
    return String(tekstas ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Pinigų suma iš teksto: „1 192 175,00 Eur“ -> 1192175.00
 * @param {string|null|undefined} tekstas
 * @returns {number|null} null, jei reikšmės nėra ar ji neskaitinė
 */
export function suma(tekstas) {
    const t = valyti(tekstas).replace(/Eur/gi, "").trim();
    if (TUSCIA.has(t)) return null;
    const skaicius = Number(t.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(skaicius) ? skaicius : null;
}

/**
 * Pirma YYYY-MM-DD data tekste (šaltinis kitokio formato nenaudoja).
 * @param {string|null|undefined} tekstas
 * @returns {string|null}
 */
export function data(tekstas) {
    return valyti(tekstas).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

/**
 * Paskutinė URL dalis: „//2014.esinvesticijos.lt/lt//…/uab-liskandas“ -> „uab-liskandas“.
 * @param {string|null|undefined} nuoroda
 * @returns {string|null}
 */
export function slugas(nuoroda) {
    const dalys = String(nuoroda ?? "")
        .split("?")[0]
        .split("/")
        .filter(Boolean);
    return dalys.at(-1) ?? null;
}

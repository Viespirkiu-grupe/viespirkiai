// Smulkūs reikšmių normalizavimo helperiai, kurių anksčiau kiekvienas Quickwit
// dokumentų statytojas turėjo savo kopiją.

/**
 * Išmeta „tuščias" reikšmes (null, undefined, ""), bet palieka 0 ir false —
 * jos yra prasmingi duomenys, ne trūkstama reikšmė.
 * @template T
 * @param {(T|null|undefined)[]} values
 * @returns {T[]}
 */
export function compact(values) {
    return values.filter((value) => value != null && value !== "");
}

/**
 * Į skaičių arba null. Tuščia eilutė, null ir nekonvertuojamos reikšmės (NaN,
 * Infinity) virsta null — Quickwit skaitiniai laukai nepriima „NaN".
 * @param {unknown} value
 * @returns {number|null}
 */
export function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

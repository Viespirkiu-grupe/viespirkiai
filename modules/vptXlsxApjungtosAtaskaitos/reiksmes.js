// XLSX celių reikšmių konvertavimas į PostgreSQL tipus. Anksčiau tą darė
// schemos funkcijos (to_answer, to_date ir kt.) – dabar viskas JS pusėje.

/** Excel datų pradžia (1900 metų klaida įskaityta). */
const EXCEL_EPOCHA = Date.UTC(1899, 11, 30);

/**
 * Tekstas be pradinių/galinių tarpų; tuščia reikšmė → null.
 *
 * @param {unknown} reiksme
 * @returns {string|null}
 */
export function tekstas(reiksme) {
    if (reiksme === null || reiksme === undefined) return null;
    const value = String(reiksme).trim();
    return value === "" ? null : value;
}

/**
 * `Taip` / `Ne` / `Nežinoma` → `answer` enum reikšmė.
 *
 * @param {unknown} reiksme
 * @returns {'yes'|'no'|'unknown'|null}
 */
export function atsakymas(reiksme) {
    const value = tekstas(reiksme)?.toLowerCase();
    if (value === "taip") return "yes";
    if (value === "ne") return "no";
    if (value === "nežinoma") return "unknown";
    return null;
}

/**
 * Sveikasis skaičius; priimami ir XLSX skaičiai, ir tekstas („12“, „12.0“).
 *
 * @param {unknown} reiksme
 * @returns {number|null}
 */
export function sveikas(reiksme) {
    if (typeof reiksme === "number") {
        return Number.isFinite(reiksme) ? Math.trunc(reiksme) : null;
    }
    const value = tekstas(reiksme);
    if (value === null || !/^[0-9]+([.]0+)?$/.test(value)) return null;
    return Math.trunc(Number(value));
}

/**
 * Dešimtainis skaičius; tarpai išmetami, kablelis laikomas dešimtainiu tašku.
 *
 * @param {unknown} reiksme
 * @returns {number|null}
 */
export function skaicius(reiksme) {
    if (typeof reiksme === "number") return Number.isFinite(reiksme) ? reiksme : null;
    const value = tekstas(reiksme)?.replace(/\s/g, "").replace(",", ".");
    if (!value || !/^[-+]?[0-9]+([.][0-9]+)?$/.test(value)) return null;
    return Number(value);
}

/**
 * Data: Excel serijinis numeris arba ISO tekstas → `YYYY-MM-DD`.
 *
 * @param {unknown} reiksme
 * @returns {string|null}
 */
export function data(reiksme) {
    if (typeof reiksme === "number" && Number.isFinite(reiksme)) {
        const laikas = EXCEL_EPOCHA + Math.trunc(reiksme) * 86_400_000;
        const parsed = new Date(laikas);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }
    const value = tekstas(reiksme);
    if (value === null) return null;
    if (/^[0-9]+([.]0+)?$/.test(value)) return data(Number(value));
    return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * BVPŽ (CPV) kodas: `12345678` arba `12345678-9`.
 *
 * @param {unknown} reiksme
 * @returns {string|null}
 */
export function bvpz(reiksme) {
    const value = tekstas(reiksme)?.replace(/\s/g, "");
    return value && /^[0-9]{8}(-[0-9])?$/.test(value) ? value : null;
}

/**
 * Kableliais ar kabliataškiais atskirtų reikšmių išskaidymas.
 *
 * @param {unknown} reiksme
 * @returns {string[]}
 */
export function dalys(reiksme) {
    const value = tekstas(reiksme);
    return value === null ? [] : value.split(/[,;]/);
}

/**
 * Pirma neišvis tuščia reikšmė iš kelių galimų antraščių.
 *
 * @param {Record<string, unknown>} eilute
 * @param {...string} antrastes
 * @returns {unknown}
 */
export function pirma(eilute, ...antrastes) {
    for (const antraste of antrastes) {
        const reiksme = eilute[antraste];
        if (reiksme !== null && reiksme !== undefined && reiksme !== "") return reiksme;
    }
    return null;
}

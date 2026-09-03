// CPVA XLSX langelių reikšmių normalizavimas. Šaltinis yra Excel eksportas,
// todėl datos ateina serijiniais numeriais, sumos — su kableliu ir nedalomais
// tarpais, o tušti langeliai kartais užpildyti tekstu "NULL".

const EXCEL_EPOCH_OFFSET = 25_569; // dienų nuo 1900-01-00 iki 1970-01-01
const MS_PER_DAY = 86_400_000;

/** Sutraukia tarpus ir tekstinį "NULL" paverčia tikru null. */
export function cleanValue(value) {
    if (typeof value !== "string") return value;
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (cleaned === "") return null;
    return cleaned.toUpperCase() === "NULL" ? null : cleaned;
}

/** Excel serijinis numeris, Date arba ISO eilutė -> "YYYY-MM-DD". */
export function excelDate(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "number" && value >= 0 && value < 100_000) {
        return new Date(Math.round((value - EXCEL_EPOCH_OFFSET) * MS_PER_DAY))
            .toISOString()
            .slice(0, 10);
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    return null;
}

/** "1 234,56" / "1234.56" / 1234.56 -> 1234.56 */
export function numberOrNull(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value)
        .replace(/[\s ]/g, "")
        .replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

/** Šaltinio "Taip"/"Ne" ir "Taikoma"/"Netaikoma" -> boolean. */
export function boolOrNull(value) {
    const cleaned = cleanValue(value);
    if (cleaned == null) return null;
    const normalized = String(cleaned).toLowerCase();
    if (normalized === "taip" || normalized === "taikoma") return true;
    if (normalized === "ne" || normalized === "netaikoma") return false;
    return null;
}

/** Tekstiniams DB stulpeliams: skaičiai (kodai, numeriai) virsta eilutėmis. */
export function textOrNull(value) {
    const cleaned = cleanValue(value);
    if (cleaned == null) return null;
    return typeof cleaned === "string" ? cleaned : String(cleaned);
}

/** Pirma neuždėta reikšmė iš kelių galimų antraščių variantų. */
export function first(row, ...keys) {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
}

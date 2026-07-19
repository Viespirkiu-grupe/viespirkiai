import {
    localDateTime,
    prepareCanonicalSutartis,
} from "./canonicalSutartis.js";

export function parseDateOnly(value, field = "date", contractId = "unknown") {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(
            `Invalid ${field} for contract ${contractId}: ${JSON.stringify(value)}`,
        );
    }
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error(
            `Invalid ${field} for contract ${contractId}: ${JSON.stringify(value)}`,
        );
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseNullableNumber(value, field, contractId) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
        if (Number.isFinite(value)) return value;
    } else if (typeof value === "string") {
        const normalized = value
            .trim()
            .replace(/[\s\u00a0\u202f]+eur$/iu, "")
            .replace(/[\s\u00a0\u202f]+/gu, "")
            .replace(/,/g, ".");
        const parsed = normalized === "" ? NaN : Number(normalized);
        if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(
        `Invalid ${field} for contract ${contractId ?? "unknown"}: ${JSON.stringify(value)}`,
    );
}

/** Sutvarko vieną parserio rezultatą taip pat, kaip DB importas. */
export function normalizeScrapedSutartis(source, { onInvalid = console.warn } = {}) {
    const item = { ...source };
    const rawId = item.sutartiesUnikalusID;

    for (const field of ["verte", "faktineIvykdimoVerte"]) {
        try {
            item[field] = parseNullableNumber(item[field], field, rawId);
        } catch (error) {
            onInvalid(error, rawId);
            item[field] = null;
        }
    }

    for (const field of ["sudarymoData", "galiojimoData", "faktineIvykdimoData"]) {
        try {
            item[field] = parseDateOnly(item[field], field, rawId);
        } catch (error) {
            onInvalid(error, rawId);
            item[field] = null;
        }
    }

    for (const field of [
        "paskelbimoData",
        "paskutinioAtnaujinimoData",
        "paskutinioRedagavimoData",
    ]) {
        if (item[field]) item[field] = localDateTime(item[field]);
    }

    item.sutartiesUnikalusID = item.sutartiesUnikalusID
        ? parseInt(item.sutartiesUnikalusID, 10)
        : null;

    return item;
}

/** Sugeneruoja lygiai tą canonical JSON ir MD5, kurie perduodami VPM upsertui. */
export function prepareNormalizedScrapedCanonical(item) {
    const pirkimoNumeris =
        item.pirkimoNumeris?.replace(/\x00/g, "").trim() || null;

    return prepareCanonicalSutartis({
        ...item,
        pirkimoNumeris,
        faktineIvykdimoVerte: item.faktineIvykdimoVerte ?? null,
    });
}

export function prepareScrapedCanonical(source, options) {
    const item = normalizeScrapedSutartis(source, options);
    if (!item.sutartiesUnikalusID) return null;
    return prepareNormalizedScrapedCanonical(item);
}

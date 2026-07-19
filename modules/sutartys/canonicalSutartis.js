import { createHash } from "node:crypto";

function nullable(value) {
    return value === undefined ? null : value;
}

/**
 * Normalizuoja šaltinio wall-clock laiką nekeisdamas jo laiko juostos.
 * VPM timestamp stulpeliai yra WITHOUT TIME ZONE, todėl `Z` čia nepridedamas.
 */
export function localDateTime(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? null
            : value.toISOString().slice(0, -1);
    }

    const match = String(value).trim().match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
    );
    if (!match) return null;

    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    const millisecond = (match[7] ?? "").padEnd(3, "0");
    const date = new Date(Date.UTC(
        Number(year), Number(month) - 1, Number(day),
        Number(hour), Number(minute), Number(second), Number(millisecond),
    ));
    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day) ||
        date.getUTCHours() !== Number(hour) ||
        date.getUTCMinutes() !== Number(minute) ||
        date.getUTCSeconds() !== Number(second)
    ) return null;

    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond || "000"}`;
}

function bvpzNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).trim().match(/^\d+/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isSafeInteger(number) ? number : null;
}

function additionalSuppliers(item) {
    const names = Array.isArray(item.papildomiTiekejai)
        ? item.papildomiTiekejai
        : [];
    const codes = Array.isArray(item.papildomiTiekejaiKodai)
        ? item.papildomiTiekejaiKodai
        : [];
    return Array.from(
        { length: Math.max(names.length, codes.length) },
        (_, i) => ({
            kodas: nullable(codes[i]),
            pavadinimas: nullable(names[i]),
        }),
    );
}

function documents(item) {
    if (!Array.isArray(item.dokumentai)) return [];
    return item.dokumentai.map((document) => {
        const match = String(document?.url ?? "").match(/file_id=(\d+)/);
        return {
            pavadinimas: nullable(document?.pavadinimas),
            fileId: match ? Number(match[1]) : null,
        };
    });
}

/** Build the complete object described by schemas/sutartis.schema.json. */
export function buildCanonicalSutartis(item) {
    return {
        unikalusId: item.sutartiesUnikalusID,
        pavadinimas: nullable(item.pavadinimas),
        sudarymoData: nullable(item.sudarymoData),
        galiojimoData: nullable(item.galiojimoData),
        faktineIvykdimoData: nullable(item.faktineIvykdimoData),
        paskelbimoData: localDateTime(item.paskelbimoData),
        redagavimoData: localDateTime(item.paskutinioRedagavimoData),
        perkanciosiosOrganizacijosKodas: nullable(
            item.perkanciosiosOrganizacijosKodas,
        ),
        perkanciosiosOrganizacijosPavadinimas: nullable(
            item.perkanciojiOrganizacija,
        ),
        sutartiesNumeris: nullable(item.sutartiesNumeris),
        pirkimoNumeris: nullable(item.pirkimoNumeris),
        numatomaVerte: nullable(item.verte),
        faktineVerte: nullable(item.faktineIvykdimoVerte),
        pirmoTiekejoKodas: nullable(item.tiekejoKodas),
        pirmoTiekejoPavadinimas: nullable(item.tiekejas),
        papildomiTiekejai: additionalSuppliers(item),
        tipas: nullable(item.tipas),
        kategorija: nullable(item.kategorija),
        bvpzKodas: bvpzNumber(item.bvpzKodas),
        papildomiBvpzKodai: (item.papildomiBvpzKodai ?? [])
            .map(bvpzNumber)
            .filter((value) => value !== null),
        dokumentai: documents(item),
        istrinta: false,
        pakeitimas:
            String(item.tipas ?? "").trim().toLowerCase() === "sp",
    };
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, sortKeys(value[key])]),
        );
    }
    return value;
}

/** Canonical JSON + MD5 iš jau paruošto canonical objekto. */
export function canonicalJsonMd5(sutartis) {
    const json = JSON.stringify(sortKeys(sutartis));
    const md5 = createHash("md5").update(json).digest("hex");
    return { sutartis, json, md5 };
}

/** Return the exact minified bytes used for the contract's MD5. */
export function prepareCanonicalSutartis(item) {
    return canonicalJsonMd5(buildCanonicalSutartis(item));
}

import { createHash } from "node:crypto";

function nullable(value) {
    return value === undefined ? null : value;
}

function dateTime(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
        paskelbimoData: dateTime(item.paskelbimoData),
        redagavimoData: dateTime(item.paskutinioRedagavimoData),
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

/** Return the exact minified bytes used for the contract's MD5. */
export function prepareCanonicalSutartis(item) {
    const sutartis = buildCanonicalSutartis(item);
    const json = JSON.stringify(sortKeys(sutartis));
    const md5 = createHash("md5").update(json).digest("hex");
    return { sutartis, json, md5 };
}

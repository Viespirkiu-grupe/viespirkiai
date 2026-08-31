import { createScraperFetch } from "../../../utils/scrapeFetch.js";
import { countDocs as quickwitCountDocs } from "../../../quickwit/quickwit.js";
import { QW_URL } from "../../../quickwit/qwHttp.js";
import { postgres } from "../../../postgres/postgres.js";
import { specialJarCodes } from "../../juridiniai/specialJarCodes.js";
import { searchJar } from "../../juridiniai/search.js";
import { STATUSAS, PIRKIMO_BUDAS } from "../viesiejiPirkimaiEnums.js";
import { splitCsv } from "./filter.js";
import { buildViesiejiPirkimaiQuickwitQuery, QUICKWIT_LENTELE } from "./quickwitQuery.js";
import {
    viesiejiPirkimaiLaikotarpisHistogram,
    viesiejiPirkimaiVerteHistogram,
} from "./histograms.js";

const scrapeFetch = createScraperFetch("viesiejiPirkimai", { operation: "searchViesiejiPirkimai" });

// ── Facetai (Quickwit agregacijos) ───────────────────────────────────────────
// Kaip /sutartys: kiekvienas facetas — term agregacija, apskaičiuota pagal
// užklausą, iš kurios pašalintas TO PATIES faceto filtras, kad matytųsi visos
// reikšmės po kitų filtrų. Kodinis facetas (vykdytojas) papildomas JAR
// pavadinimais; enum facetai (pirkimo būdas/statusas) — žmogui skirtais.

/** Viena Quickwit term agregacija. Grąžina [{ value, count }]. */
async function qwFacet(field, query, size) {
    try {
        const res = await scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                max_hits: 0,
                aggs: { values: { terms: { field, size } } },
                format: "json",
            }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.aggregations?.values?.buckets ?? []).map((b) => ({
            value: String(b.key),
            count: Number(b.doc_count),
        }));
    } catch {
        return [];
    }
}

/** Papildo kodinį vykdytojo facetą JAR pavadinimais. Nerasti kodai lieka be label. */
async function attachJarNames(options) {
    const codes = [...new Set(options.map((o) => o.value).filter(Boolean))];
    if (!codes.length) return options;
    const { rows } = await postgres.query(
        `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" = ANY($1)`,
        [codes],
    );
    const names = new Map(
        rows.filter((r) => r.pavadinimas).map((r) => [String(r.jarKodas), String(r.pavadinimas)]),
    );
    return options.map((o) => ({
        ...o,
        label: names.get(o.value) ?? specialJarCodes[o.value]?.pavadinimas,
    }));
}

/** Papildo BVPŽ facetus pavadinimais; kodus sutraukia iki 8 skaitmenų. */
async function attachBvpzNames(options) {
    const byCode = new Map();
    for (const o of options) {
        const code = o.value.split("-")[0];
        byCode.set(code, (byCode.get(code) ?? 0) + (o.count ?? 0));
    }
    const codes = [...byCode.keys()];
    if (!codes.length) return [];
    const { rows } = await postgres.query(
        `SELECT code, pavadinimas FROM bvpz."kodai" WHERE code = ANY($1)`,
        [codes],
    );
    const names = new Map(rows.map((r) => [String(r.code), String(r.pavadinimas)]));
    return codes.map((code) => ({ value: code, label: names.get(code), count: byCode.get(code) }));
}

/** Pažymėtus BVPŽ prefiksus išrenka iš užklausos. */
function selectedBvpzPrefixes(query) {
    return [...new Set(
        String(query.bvpzPrefiksai ?? "")
            .split(/[\s,;]+/)
            .map((p) => p.trim())
            .filter(Boolean),
    )];
}

/** Pažymėtiems BVPŽ prefiksams priskiria prefiksinės atitikties pirkimų skaičių
 *  pagal kitus filtrus (facet-exclude), kad nepilni kodai rodytųsi su „*" ženklu
 *  ir skaičiumi. Pavadinimo nerodom — vien kodas su „*". */
async function attachSelectedBvpz(prefixes, query) {
    const uniq = [...new Set(prefixes)].filter(Boolean);
    if (!uniq.length) return [];
    const base = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["bvpz"] });
    const counts = await Promise.all(
        uniq.map((p) =>
            quickwitCountDocs(QUICKWIT_LENTELE, {
                query: base === "*" ? `bvpzKodai:${p}*` : `(${base}) AND bvpzKodai:${p}*`,
            }).catch(() => null),
        ),
    );
    return uniq.map((value, i) => ({
        value,
        count: counts[i],
        isPrefix: value.replace(/\D/g, "").length < 8,
    }));
}

// Enum facetui (pirkimoBudas/statusas): agregacija grąžina saugomą pavadinimą;
// atvaizduojam kaip { value: raktas, label: pavadinimas }, kad URL'e keliautų
// raktas (suderinama su tiksliniu filtru ir MCP). Nežinomus pavadinimus praleidžiam.
function mapEnumFacet(buckets, enumMap) {
    const labelToKey = new Map(Object.entries(enumMap).map(([k, v]) => [v, k]));
    return buckets
        .map((b) => {
            const key = labelToKey.get(b.value);
            return key ? { value: key, label: b.value, count: b.count } : null;
        })
        .filter(Boolean);
}

/**
 * Suskaičiuoja visus VP šoninės juostos facetus vienai užklausai (facet-exclude
 * kiekvienam). Grąžina map'ą facetų pavadinimas → [{ value, label?, count }].
 * @param {object} query
 * @returns {Promise<object>}
 */
export async function viesiejiPirkimaiFacets(query) {
    const q = (excl) => buildViesiejiPirkimaiQuickwitQuery(query, { exclude: excl });
    const selVykdytojai = splitCsv(query.pvJarKodas);

    const [vykdytojaiRaw, pirkimoBudasRaw, statusasRaw, bvpz, verte, laikotarpis] =
        await Promise.all([
            // Vykdytojas — agreguojam pagal registro kodą (jarKodas), kad turėtume
            // pavadinimus (pirkimoVykdytojasId yra vidinis CVP IS ID, ne kodas).
            qwFacet("jarKodas", q(["pvJarKodas"]), 8),
            qwFacet("pirkimoBudas", q(["pirkimoBudas"]), 15),
            qwFacet("statusas", q(["statusas"]), 12),
            qwFacet("bvpzKodai", q(["bvpz"]), 10),
            viesiejiPirkimaiVerteHistogram(query),
            viesiejiPirkimaiLaikotarpisHistogram(query),
        ]);

    const [vykdytojaiNamed, bvpzNamed, bvpzSelected] = await Promise.all([
        attachJarNames(vykdytojaiRaw.filter((b) => b.value)),
        attachBvpzNames(bvpz.filter((b) => b.value)),
        attachSelectedBvpz(selectedBvpzPrefixes(query), query),
    ]);

    // Pasirinktus BVPŽ prefiksus (nepilnus kodus), kurių nėra tarp dažniausių,
    // pridedam priekyje su pavadinimu + prefiksinės atitikties skaičiumi.
    const bvpzPresent = new Set(bvpzNamed.map((o) => o.value));
    const bvpzFinal = [...bvpzSelected.filter((o) => !bvpzPresent.has(o.value)), ...bvpzNamed];

    // Pasirinktus (įsk. „custom" įvestus) kodus, kurių nėra tarp dažniausių,
    // pridedam priekyje su JAR pavadinimu.
    const present = new Set(vykdytojaiNamed.map((o) => o.value));
    const missing = selVykdytojai.filter((v) => !present.has(v));
    const vykdytojaiFinal = missing.length
        ? [...(await attachJarNames(missing.map((v) => ({ value: v, count: null })))), ...vykdytojaiNamed]
        : vykdytojaiNamed;

    return {
        vykdytojai: vykdytojaiFinal,
        pirkimoBudas: mapEnumFacet(pirkimoBudasRaw.filter((b) => b.value), PIRKIMO_BUDAS),
        statusas: mapEnumFacet(statusasRaw.filter((b) => b.value), STATUSAS),
        bvpz: bvpzFinal,
        verte,
        laikotarpis,
    };
}

// Facetų laukas → „iš užklausos pašalinamo" filtro raktas (facet-exclude), kad
// „Daugiau" dialogo sąrašas rodytų visas reikšmes pagal kitus filtrus.
const FACET_FIELD_EXCLUDE = {
    jarKodas: "pvJarKodas",
    bvpzKodai: "bvpz",
};

/**
 * Pilnas vieno facetų lauko reikšmių sąrašas pagal esamą užklausą/filtrus —
 * maitina „Daugiau" dialogą. `optionSearch` leidžia ieškoti registre (kodu ar
 * pavadinimu) reikšmių, kurių gali nebūti tarp dažniausių.
 * @param {'jarKodas'|'bvpzKodai'} field
 * @param {object} query
 * @param {number} [size=1000]
 * @param {string} [optionSearch='']
 * @returns {Promise<{ value: string, label?: string, count: number|null }[]>}
 */
export async function viesiejiPirkimaiFacetOptions(field, query, size = 1000, optionSearch = "") {
    const excludeKey = FACET_FIELD_EXCLUDE[field];
    if (!excludeKey) return [];

    const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: [excludeKey] });
    const buckets = (await qwFacet(field, qwQuery, size)).filter((b) => b.value);

    if (field === "bvpzKodai") {
        const options = await attachBvpzNames(buckets);
        if (!optionSearch) {
            const present = new Set(options.map((o) => o.value));
            const selected = await attachSelectedBvpz(
                selectedBvpzPrefixes(query).filter((v) => !present.has(v)),
                query,
            );
            return [...selected, ...options];
        }
        const needle = optionSearch.toLowerCase();
        const inline = options.filter(
            (o) => o.value.includes(optionSearch) || (o.label?.toLowerCase().includes(needle) ?? false),
        );
        if (inline.length) return inline;
        const counts = new Map(options.map((o) => [o.value, o.count]));
        const rows = /^\d+$/.test(optionSearch)
            ? (
                  await postgres.query(
                      `SELECT code, pavadinimas FROM bvpz."kodai" WHERE code LIKE $1 ORDER BY code LIMIT 50`,
                      [`${optionSearch}%`],
                  )
              ).rows
            : (
                  await postgres.query(
                      `SELECT code, pavadinimas FROM bvpz."kodai" WHERE pavadinimas ILIKE $1 ORDER BY code LIMIT 50`,
                      [`%${optionSearch}%`],
                  )
              ).rows;
        return rows.map((r) => ({
            value: String(r.code),
            label: r.pavadinimas ? String(r.pavadinimas) : undefined,
            count: counts.get(String(r.code)) ?? null,
        }));
    }

    const options = await attachJarNames(buckets);
    if (!optionSearch) return options;

    // Pirmiausia — facetuoti pasirinkimai (su skaičiais pagal esamą užklausą),
    // atitinkantys paiešką. Tik jei tokių nėra, krentam į registro paiešką.
    const needle = optionSearch.toLowerCase();
    const inline = options.filter(
        (o) => o.value.includes(optionSearch) || (o.label?.toLowerCase().includes(needle) ?? false),
    );
    if (inline.length) return inline;

    const counts = new Map(options.map((o) => [o.value, o.count]));
    const registryRows = /^\d+$/.test(optionSearch)
        ? (
              await postgres.query(
                  `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" LIKE $1 ORDER BY "jarKodas" LIMIT 50`,
                  [`${optionSearch}%`],
              )
          ).rows
        : (await searchJar({ search: optionSearch }, { page: 1, limit: 50 })).results;

    return registryRows
        .filter((r) => r.jarKodas)
        .map((r) => ({
            value: String(r.jarKodas),
            label: r.pavadinimas
                ? String(r.pavadinimas)
                : specialJarCodes[String(r.jarKodas)]?.pavadinimas,
            count: counts.get(String(r.jarKodas)) ?? null,
        }));
}


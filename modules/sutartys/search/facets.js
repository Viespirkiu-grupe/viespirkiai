import { createScraperFetch } from "../../../utils/scrapeFetch.js";
import { getDeadRatio, countDocs as quickwitCountDocs } from "../../../quickwit/quickwit.js";
import { QW_URL } from "../../../quickwit/qwHttp.js";
import { postgres } from "../../../postgres/postgres.js";
import { specialJarCodes } from "../../juridiniai/specialJarCodes.js";
import { searchJar } from "../../juridiniai/search.js";
import { splitCsv } from "./filter.js";
import { sutartysDataHistogram, sutartysSumaHistogram } from "./histograms.js";
import {
    buildSutartysQuickwitQuery,
    QUICKWIT_LENTELE,
} from "./quickwitQuery.js";

const scrapeFetch = createScraperFetch("sutartys", { operation: "searchSutartys" });

// ── Facetai (Quickwit agregacijos) ───────────────────────────────────────────
// Kaip /dokumentai: kiekvienas facetas — term agregacija, apskaičiuota pagal
// užklausą, iš kurios pašalintas TO PATIES faceto filtras, kad matytųsi visos
// reikšmės po kitų filtrų. Kodiniai facetai (pirkėjai/tiekėjai/BVPŽ) papildomi
// žmogui skirtais pavadinimais.

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

export async function sutartysQuickwitAggregates(query) {
    try {
        const [deadRatio, res] = await Promise.all([
            getDeadRatio(QUICKWIT_LENTELE),
            scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: buildSutartysQuickwitQuery(query),
                    max_hits: 0,
                    aggs: { suma: { sum: { field: "suma" } } },
                    format: "json",
                }),
            }),
        ]);
        if (!res.ok) return { sutarciuKiekis: null, bendraVerte: null };
        const data = await res.json();
        const liveRatio = Math.max(0, 1 - deadRatio);
        return {
            sutarciuKiekis: Math.round(Number(data?.num_hits ?? 0) * liveRatio),
            bendraVerte: Number(data?.aggregations?.suma?.value ?? 0) * liveRatio,
        };
    } catch {
        return { sutarciuKiekis: null, bendraVerte: null };
    }
}

/** Papildo kodinius facetus (pirkėjai/tiekėjai) įstaigų/įmonių pavadinimais iš
 *  jar lentelės. Nerasti kodai lieka be label. */
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
    // Specialūs CVP IS bendriniai kodai (801–809) neturi įrašo jar lentelėje —
    // jų pavadinimus imam iš specialJarCodes žinyno.
    return options.map((o) => ({
        ...o,
        label: names.get(o.value) ?? specialJarCodes[o.value]?.pavadinimas,
    }));
}

/** Papildo BVPŽ facetus pavadinimais. Bucket'o raktas — pilnas kodas su
 *  kontroline skiltimi (pvz. „15800000-6"); facete rodom 8 skaitmenų kodą
 *  (filtravimo reikšmę), pavadinimą imam iš „bvpzKodai" žodyno pagal `code`. */
async function attachBvpzNames(options) {
    // Sutraukiam iki 8 skaitmenų kodo ir sumuojam (vienam kodui — viena eilutė).
    const byCode = new Map();
    for (const o of options) {
        const code = o.value.split("-")[0];
        byCode.set(code, (byCode.get(code) ?? 0) + (o.count ?? 0));
    }
    const codes = [...byCode.keys()];
    if (!codes.length) return [];
    const { rows } = await postgres.query(
        `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE code = ANY($1)`,
        [codes],
    );
    const names = new Map(rows.map((r) => [String(r.code), String(r.pavadinimas)]));
    return codes.map((code) => ({ value: code, label: names.get(code), count: byCode.get(code) }));
}

/** Pažymėtus BVPŽ prefiksus išrenka iš užklausos (matomas + paslėptas laukas). */
function selectedBvpzPrefixes(query) {
    return [...new Set(
        [query.bvpzPrefiksas, query.bvpzPrefiksasKitas]
            .filter(Boolean)
            .flatMap((raw) => String(raw).split(" "))
            .map((p) => p.trim())
            .filter(Boolean),
    )];
}

/** Pažymėtiems BVPŽ prefiksams priskiria prefiksinės atitikties sutarčių skaičių
 *  pagal kitus filtrus (facet-exclude), kad šoninėje juostoje ir dialoge nepilni
 *  kodai rodytųsi su „*" ženklu ir sutarčių skaičiumi. Pavadinimo nerodom — vien
 *  kodas su „*", kad aiškiai skirtųsi nuo konkretaus (pilno) kodo. */
async function attachSelectedBvpz(prefixes, query) {
    const uniq = [...new Set(prefixes)].filter(Boolean);
    if (!uniq.length) return [];
    const base = buildSutartysQuickwitQuery(query, { exclude: ["bvpz"] });
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

/**
 * Suskaičiuoja visus sutarčių šoninės juostos facetus vienai užklausai.
 * Kiekvienas facetas naudoja facet-exclude, kad rodytų reikšmes pagal kitus
 * filtrus. Grąžina map'ą facetų pavadinimas → [{ value, label?, count }].
 * @param {object} query
 * @returns {Promise<{ tipas: object[], kategorija: object[], buyers: object[], suppliers: object[], bvpz: object[] }>}
 */
export async function sutartysFacets(query) {
    const q = (excl) => buildSutartysQuickwitQuery(query, { exclude: excl });
    const selBuyers = splitCsv(query.perkanciosiosOrganizacijosKodas);
    const selSuppliers = splitCsv(query.tiekejoKodas);

    const [tipas, kategorija, buyers, suppliers, bvpz, suma, laikotarpis] = await Promise.all([
        qwFacet("tipas", q(["tipas"]), 15),
        qwFacet("kategorija", q(["kategorija"]), 6),
        qwFacet("perkanciosiosOrganizacijosKodas", q(["perkanciosiosOrganizacijosKodas"]), 8),
        qwFacet("tiekejaiKodai", q(["tiekejoKodas"]), 8),
        qwFacet("bvpzKodai", q(["bvpz"]), 10),
        sutartysSumaHistogram(query),
        sutartysDataHistogram(query),
    ]);

    const [buyersNamed, suppliersNamed, bvpzNamed, bvpzSelected] = await Promise.all([
        attachJarNames(buyers),
        attachJarNames(suppliers),
        attachBvpzNames(bvpz),
        attachSelectedBvpz(selectedBvpzPrefixes(query), query),
    ]);

    // Pasirinktus BVPŽ prefiksus (nepilnus kodus), kurių nėra tarp dažniausių,
    // pridedam priekyje su pavadinimu + prefiksinės atitikties skaičiumi.
    const bvpzPresent = new Set(bvpzNamed.map((o) => o.value));
    const bvpzFinal = [...bvpzSelected.filter((o) => !bvpzPresent.has(o.value)), ...bvpzNamed];

    // Pasirinktus (įsk. „custom" įvestus) kodus, kurių nėra tarp dažniausių,
    // pridedam priekyje su JAR pavadinimu — kad šoninėje juostoje matytųsi ne
    // vien kodas, o ir pavadinimas (ir kad jie tilptų į matomus, ne perpildą).
    const withSelected = async (named, selected) => {
        const present = new Set(named.map((o) => o.value));
        const missing = selected.filter((v) => !present.has(v));
        if (!missing.length) return named;
        const resolved = await attachJarNames(missing.map((v) => ({ value: v, count: null })));
        return [...resolved, ...named];
    };

    const [buyersFinal, suppliersFinal] = await Promise.all([
        withSelected(buyersNamed, selBuyers),
        withSelected(suppliersNamed, selSuppliers),
    ]);

    return {
        tipas: tipas.filter((o) => o.value),
        kategorija: kategorija.filter((o) => o.value),
        buyers: buyersFinal,
        suppliers: suppliersFinal,
        bvpz: bvpzFinal,
        suma,
        laikotarpis,
    };
}

// Facetų laukas → „iš užklausos pašalinamo" filtro raktas (facet-exclude), kad
// „Daugiau" dialogo sąrašas rodytų visas reikšmes pagal kitus filtrus.
const FACET_FIELD_EXCLUDE = {
    perkanciosiosOrganizacijosKodas: "perkanciosiosOrganizacijosKodas",
    tiekejaiKodai: "tiekejoKodas",
    bvpzKodai: "bvpz",
};

/**
 * Pilnas vieno facetų lauko reikšmių sąrašas pagal esamą užklausą/filtrus —
 * maitina „Daugiau" dialogą (kaip /dokumentai). `optionSearch` leidžia ieškoti
 * JAR registre (kodu ar pavadinimu) reikšmių, kurių gali nebūti tarp dažniausių.
 * @param {'perkanciosiosOrganizacijosKodas'|'tiekejaiKodai'|'bvpzKodai'} field
 * @param {object} query
 * @param {number} [size=1000]
 * @param {string} [optionSearch='']
 * @returns {Promise<{ value: string, label?: string, count: number|null }[]>}
 */
export async function sutartysFacetOptions(field, query, size = 1000, optionSearch = "") {
    const excludeKey = FACET_FIELD_EXCLUDE[field];
    if (!excludeKey) return [];

    const qwQuery = buildSutartysQuickwitQuery(query, { exclude: [excludeKey] });
    const buckets = (await qwFacet(field, qwQuery, size)).filter((b) => b.value);

    // BVPŽ: kodus sutraukiam iki 8 skaitmenų + pavadinimai iš „bvpzKodai" žinyno;
    // paieška — pagal kodo prefiksą ar pavadinimą (registro/žinyno papildymas).
    if (field === "bvpzKodai") {
        const options = await attachBvpzNames(buckets);
        if (!optionSearch) {
            // Pažymėtus prefiksus (nepilnus kodus) rodom priekyje su „*" ženklu
            // ir prefiksinės atitikties skaičiumi — kaip šoninėje juostoje.
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
                      `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE code LIKE $1 ORDER BY code LIMIT 50`,
                      [`${optionSearch}%`],
                  )
              ).rows
            : (
                  await postgres.query(
                      `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE pavadinimas ILIKE $1 ORDER BY code LIMIT 50`,
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

    // Registro paieška: skaičius → kodo prefiksas jar lentelėje; kitaip — vardo
    // paieška. Skaičius iš agregacijos prisegam prie rasto kodo (kiek sutarčių).
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

import { createScraperFetch } from "../../../utils/scrapeFetch.js";
import { QW_URL } from "../../../quickwit/qwHttp.js";
import {
    buildSutartysQuickwitQuery,
    QUICKWIT_LENTELE,
    qwDate,
} from "./quickwitQuery.js";
import { sumaBaze } from "./sumaBaze.js";

const scrapeFetch = createScraperFetch("sutartys", { operation: "searchSutartys" });

// Sumos pasiskirstymo (histogramos) log-skalės kraštinės (€): ~5 žingsniai
// dekadai (1,2,3,5,7) nuo 10 iki 100 mln. Paskutinis kaušas — „nuo 100 mln."
// (viskas virš). Slankiklio domenas: [pirmoji kraštinė, paskutinė kraštinė].
// Pirmoji kraštinė neigiama: sutarčių suma būna ir minusinė (pvz. koreguojantys
// pakeitimai), tad joms reikia savo kaušo — kitaip jos nematomos histogramoje ir
// nepasiekiamos slankikliu.
const SUMA_MIN_EDGE = -100_000_000;
const SUMA_EDGES = (() => {
    const edges = [SUMA_MIN_EDGE, 0];
    for (let d = 1; d <= 8; d++) {
        for (const m of [1, 2, 3, 5, 7]) {
            const v = m * 10 ** d;
            if (v <= 100_000_000) edges.push(v);
        }
    }
    return edges;
})();

/**
 * Sumos (faktinės vertės) pasiskirstymas log kaušais pagal esamą užklausą, iš
 * kurios pašalintas pats sumos filtras (facet-exclude) — kad matytųsi visa
 * histograma, o slankiklis tik paryškintų pasirinktą rėžį.
 * Domenas dinamiškas: nukerpami tušti (0 sutarčių) kaušai galuose, tad
 * `domainMin`/`domainMax` atspindi realų duomenų rėžį pagal esamą užklausą.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function sutartysSumaHistogram(query) {
    const edgeMax = SUMA_EDGES[SUMA_EDGES.length - 1];
    const fallback = { buckets: [], domainMin: 0, domainMax: edgeMax };
    const ranges = SUMA_EDGES.slice(0, -1).map((from, i) => ({ from, to: SUMA_EDGES[i + 1] }));
    ranges.push({ from: edgeMax });

    const qwQuery = buildSutartysQuickwitQuery(query, { exclude: ["suma"] });
    try {
        const res = await scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                // Histograma — pagal tą pačią sumos bazę kaip filtras („Suma laikyti").
                aggs: { suma: { range: { field: sumaBaze(query).qw, ranges } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        const all = (data?.aggregations?.suma?.buckets ?? [])
            .map((b) => ({
                from: Number(b.from ?? 0),
                to: b.to != null ? Number(b.to) : null,
                count: Number(b.doc_count),
            }))
            // Quickwit prideda numatytą „žemiau pirmos ribos" kaušą (iki 0) —
            // praleidžiam degeneruotus (to <= from) kaušus.
            .filter((b) => b.to === null || b.to > b.from);
        if (!all.length) return fallback;

        // Dinamiškas domenas skaičiuojamas TIKSLIAI iš kaušų skaičių (ne iš
        // apytikslių Quickwit procentilių, kurie su kitais facetais / mažais
        // rinkiniais klysta): nukerpam po ~1% masės iš abiejų galų, tad
        // slankiklis „priartinamas" prie ten, kur duomenys. Kraštinės rankenėlės
        // reiškia „be ribos", tad išskirtys vis tiek pasiekiamos.
        const total = all.reduce((s, b) => s + b.count, 0);
        if (!total) return fallback;
        const lowCut = total * 0.01;
        const highCut = total * 0.99;
        let start = 0;
        let end = all.length - 1;
        let cum = 0;
        for (let i = 0; i < all.length; i++) {
            cum += all[i].count;
            if (cum > lowCut) { start = i; break; }
        }
        cum = 0;
        for (let i = 0; i < all.length; i++) {
            cum += all[i].count;
            if (cum >= highCut) { end = i; break; }
        }
        if (end < start) end = start;

        // Praplečiam iki bent 10 stulpelių — kitaip histograma per skurdi.
        const MIN_BARS = 10;
        while (end - start + 1 < MIN_BARS && (start > 0 || end < all.length - 1)) {
            if (start > 0) start--;
            if (end - start + 1 < MIN_BARS && end < all.length - 1) end++;
        }

        const buckets = all.slice(start, end + 1);
        return {
            buckets,
            domainMin: buckets[0].from,
            domainMax: buckets[buckets.length - 1].to ?? edgeMax,
        };
    } catch {
        return fallback;
    }
}

// Laikotarpio histogramos bazinis (smulkiausias) intervalas. Quickwit
// `date_histogram` priima tik fiksuotus intervalus (d/h/…), ne kalendorinius
// mėnesius — imam ~mėnesį (30 d.); tankumas vėliau adaptuojamas grupuojant.
const DATA_INTERVAL = "30d";
const DATA_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
// Sveiko proto laikotarpio rėžiai (grafikui ir slankikliui): nuo 2013-01-01 iki
// kitų metų sausio 1 d. Duomenyse pasitaiko klaidingų datų (pvz. 1905 ar 2055 m.);
// už šių ribų esančios sutartys į histogramą neįtraukiamos.
const DATA_BOUND_MIN = "2013-01-01";
const dataBoundMax = () => `${new Date().getUTCFullYear() + 1}-01-01`;

/**
 * Sutarčių sudarymo datų (`sudarymoData`) pasiskirstymas pagal esamą užklausą, iš
 * kurios pašalintas pats datos filtras (facet-exclude). Naudoja Quickwit
 * `date_histogram` (~mėnesio kaušai), nukerpa tuščius galus ir adaptyviai sujungia
 * gretimus kaušus, kad liktų ~24–40 stulpelių bet kokiam rėžiui. `from`/`to` —
 * epoch millis (slankiklio domenas).
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function sutartysDataHistogram(query) {
    const boundMin = qwDate(DATA_BOUND_MIN);
    const boundMax = qwDate(dataBoundMax());
    const fallback = { buckets: [], domainMin: Date.parse(DATA_BOUND_MIN), domainMax: Date.parse(dataBoundMax()) };
    // Prie užklausos prikabinam sveiko proto rėžius, kad klaidingos išskirtys
    // (už [2013 .. kiti metai] ribų) neišpūstų histogramos domeno.
    const qwQuery = [
        buildSutartysQuickwitQuery(query, { exclude: ["sudarymoData"] }),
        `sudarymoData:[${boundMin} TO ${boundMax}]`,
    ].join(" AND ");
    try {
        const res = await scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { data: { date_histogram: { field: "sudarymoData", fixed_interval: DATA_INTERVAL } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        // `key` — kaušo pradžia epoch millis; kaušai gretimi (min_doc_count=0).
        let all = (data?.aggregations?.data?.buckets ?? []).map((b) => ({
            from: Number(b.key),
            to: Number(b.key) + DATA_INTERVAL_MS,
            count: Number(b.doc_count),
        }));
        if (!all.length) return fallback;

        // Išskirtys jau atkirstos užklausos rėžiais, tad tiesiog nukerpam tuščius
        // (0 sutarčių) galus — parodom visą užpildytą rėžį sveiko proto ribose.
        let start = 0;
        while (start < all.length && all[start].count === 0) start++;
        let end = all.length - 1;
        while (end > start && all[end].count === 0) end--;
        if (start > end) return fallback;
        all = all.slice(start, end + 1);

        // Adaptyvus tankumas: sujungiam gretimus kaušus (×3 ketvirtis, ×12 metai …),
        // kad stulpelių liktų ~iki 36 — juosta visada gražiai užpildyta.
        const TARGET = 36;
        let group = 1;
        for (const g of [1, 3, 6, 12, 24, 60]) {
            group = g;
            if (Math.ceil(all.length / g) <= TARGET) break;
        }
        const buckets = [];
        for (let i = 0; i < all.length; i += group) {
            const chunk = all.slice(i, i + group);
            buckets.push({
                from: chunk[0].from,
                to: chunk[chunk.length - 1].to,
                count: chunk.reduce((s, b) => s + b.count, 0),
            });
        }
        return {
            buckets,
            domainMin: buckets[0].from,
            domainMax: buckets[buckets.length - 1].to,
        };
    } catch {
        return fallback;
    }
}

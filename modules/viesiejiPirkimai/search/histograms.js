import { createScraperFetch } from "../../../utils/scrapeFetch.js";
import { QW_URL } from "../../../quickwit/qwHttp.js";
import {
    buildViesiejiPirkimaiQuickwitQuery,
    QUICKWIT_LENTELE,
    qwDate,
} from "./quickwitQuery.js";

const scrapeFetch = createScraperFetch("viesiejiPirkimai", { operation: "searchViesiejiPirkimai" });

// Vertės pasiskirstymo (histogramos) log-skalės kraštinės (€): ~5 žingsniai
// dekadai (1,2,3,5,7) nuo 10 iki 100 mln. Paskutinis kaušas — „nuo 100 mln."
const VERTE_EDGES = (() => {
    const edges = [0];
    for (let d = 1; d <= 8; d++) {
        for (const m of [1, 2, 3, 5, 7]) {
            const v = m * 10 ** d;
            if (v <= 100_000_000) edges.push(v);
        }
    }
    return edges;
})();

/**
 * Numatomos vertės pasiskirstymas log kaušais pagal esamą užklausą, iš kurios
 * pašalintas pats vertės filtras (facet-exclude). Domenas dinamiškas: nukerpami
 * tušti kaušai galuose. Kaip `sutartysSumaHistogram`.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function viesiejiPirkimaiVerteHistogram(query) {
    const edgeMax = VERTE_EDGES[VERTE_EDGES.length - 1];
    const fallback = { buckets: [], domainMin: 0, domainMax: edgeMax };
    const ranges = VERTE_EDGES.slice(0, -1).map((from, i) => ({ from, to: VERTE_EDGES[i + 1] }));
    ranges.push({ from: edgeMax });

    const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["verte"] });
    try {
        const res = await scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { verte: { range: { field: "numatomaBendraPirkimoVerte", ranges } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        const all = (data?.aggregations?.verte?.buckets ?? [])
            .map((b) => ({
                from: Number(b.from ?? 0),
                to: b.to != null ? Number(b.to) : null,
                count: Number(b.doc_count),
            }))
            .filter((b) => b.to === null || b.to > b.from);
        if (!all.length) return fallback;

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

// Laikotarpio histogramos bazinis intervalas (~mėnuo) ir sveiko proto rėžiai.
const DATA_INTERVAL = "30d";
const DATA_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DATA_BOUND_MIN = "2013-01-01";
const dataBoundMax = () => `${new Date().getUTCFullYear() + 1}-01-01`;

/**
 * Paskelbimo datų pasiskirstymas pagal esamą užklausą (facet-exclude „paskelbimoData").
 * Quickwit `date_histogram`, nukerpa tuščius galus, adaptyviai sujungia kaušus.
 * Kaip `sutartysDataHistogram`.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function viesiejiPirkimaiLaikotarpisHistogram(query) {
    const boundMin = qwDate(DATA_BOUND_MIN);
    const boundMax = qwDate(dataBoundMax());
    const fallback = { buckets: [], domainMin: Date.parse(DATA_BOUND_MIN), domainMax: Date.parse(dataBoundMax()) };
    const qwQuery = [
        buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["paskelbimoData"] }),
        `paskelbimoData:[${boundMin} TO ${boundMax}]`,
    ].join(" AND ");
    try {
        const res = await scrapeFetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { data: { date_histogram: { field: "paskelbimoData", fixed_interval: DATA_INTERVAL } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        let all = (data?.aggregations?.data?.buckets ?? []).map((b) => ({
            from: Number(b.key),
            to: Number(b.key) + DATA_INTERVAL_MS,
            count: Number(b.doc_count),
        }));
        if (!all.length) return fallback;

        let start = 0;
        while (start < all.length && all[start].count === 0) start++;
        let end = all.length - 1;
        while (end > start && all[end].count === 0) end--;
        if (start > end) return fallback;
        all = all.slice(start, end + 1);

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


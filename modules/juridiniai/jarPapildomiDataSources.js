import { parseHTML } from "linkedom";
import { createScraperFetch } from "../../utils/scrapeFetch.js";

const scrapeFetch = createScraperFetch("juridiniai", {
    operation: "jarPapildomiDataSources",
});

const BASE = "https://www.registrucentras.lt";
const SLUG = "jar-pirminiai-duomenys-raw-data";

async function getCmsConfig() {
    const res = await scrapeFetch(`${BASE}/config.js`);
    if (!res.ok) throw new Error(`config.js: HTTP ${res.status}`);
    const text = await res.text();
    const url = text.match(/ENV_FRONTEND_CMS_URL:\s*"([^"]+)"/)?.[1];
    const token = text.match(/ENV_FRONTEND_CMS_TOKEN:\s*"([^"]+)"/)?.[1];
    if (!url || !token) {
        throw new Error("config.js: nerastas CMS URL arba token");
    }
    return { url, token };
}

function fileNameFromHref(href) {
    if (!href) return null;
    const url = new URL(href, BASE);
    const file = url.searchParams.get("byla")?.trim();
    return file || null;
}

export function classifyJarAdditionalFiles(entries) {
    const classified = [];
    for (const entry of entries) {
        const file = entry.file;
        let match;
        if ((match = file.match(/^JAR_FA_RODIKLIAI_(BLNS|PLNA)_(\d{4})(_n)?\.csv$/i))) {
            classified.push({
                ...entry,
                kind: "finansai",
                ataskaitosTipas: match[1].toUpperCase() === "BLNS"
                    ? "BALANSAS"
                    : "PELNO_NUOSTOLIU",
                saltinioMetai: Number(match[2]),
                schema: match[3] ? "long" : "legacy",
            });
        } else if (/^JA_FA_ANULIUOTI\.csv$/i.test(file)) {
            classified.push({ ...entry, kind: "anuliavimai" });
        } else if (/^JAR_FA_VELUOJANTIS\.csv$/i.test(file)) {
            classified.push({ ...entry, kind: "velavimai" });
        } else if (/^JAR_NEPATEIKE_FA_UZ_PRAEJUSIUS\.csv$/i.test(file)) {
            classified.push({ ...entry, kind: "nepateikimai" });
        } else if (/^JAR_NVO_(NUO|IKI)\.csv$/i.test(file)) {
            classified.push({
                ...entry,
                kind: "zymos",
                zymosTipas: "NVO",
                intervalas: /_NUO\.csv$/i.test(file) ? "aktyvus" : "pasibaiges",
            });
        } else if (/^JAR_PARAMOS_GAV_(NUO|IKI)\.csv$/i.test(file)) {
            classified.push({
                ...entry,
                kind: "zymos",
                zymosTipas: "PARAMOS_GAVEJAS",
                intervalas: /_NUO\.csv$/i.test(file) ? "aktyvus" : "pasibaiges",
            });
        } else if (/^jar_sav_teikimas\.csv$/i.test(file)) {
            classified.push({ ...entry, kind: "savanoryste" });
        } else if (/^jangis_sar_teikimas\.csv$/i.test(file)) {
            classified.push({ ...entry, kind: "jangis" });
        } else if ((match = file.match(/^JAR_DOKUMENTAI_(NUO_2025|\d{4})\.csv$/i))) {
            classified.push({
                ...entry,
                kind: "dokumentai",
                saltinioMetai: match[1].toUpperCase() === "NUO_2025"
                    ? 2025
                    : Number(match[1]),
                nuoMetu: match[1].toUpperCase() === "NUO_2025",
            });
        }
    }

    // 2023 m. RC publikuoja ir seną platų failą, ir papildytą ilgo formato
    // failą. Tam pačiam ataskaitos tipui/metams pasirenkame tik naujesnį `_n`,
    // kad tie patys dokumentai nebūtų importuoti du kartus.
    const preferredFinancial = new Map();
    for (const source of classified.filter((item) => item.kind === "finansai")) {
        const key = `${source.ataskaitosTipas}:${source.saltinioMetai}`;
        const previous = preferredFinancial.get(key);
        if (!previous || (source.schema === "long" && previous.schema !== "long")) {
            preferredFinancial.set(key, source);
        }
    }

    return [
        ...preferredFinancial.values(),
        ...classified.filter((item) => item.kind !== "finansai"),
    ].sort((a, b) => a.file.localeCompare(b.file, "lt"));
}

export async function getJarAdditionalDataSources() {
    const cms = await getCmsConfig();
    const params = new URLSearchParams({
        "filters[slug][$eq]": SLUG,
        populate: "*",
    });
    const res = await scrapeFetch(`${cms.url}/api/open-data-pages?${params}`, {
        headers: { Authorization: `Bearer ${cms.token}` },
    });
    if (!res.ok) throw new Error(`CMS API: HTTP ${res.status}`);
    const page = (await res.json()).data?.[0];
    const html = page?.content?.content;
    if (!html) throw new Error(`CMS API: nerastas puslapio "${SLUG}" turinys`);

    const { document } = parseHTML(`<body>${html}</body>`);
    const entries = [...document.querySelectorAll("table tbody tr")].flatMap((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const csvCell = cells.find((cell) =>
            fileNameFromHref(cell.querySelector("a")?.getAttribute("href"))?.toLowerCase().endsWith(".csv"),
        );
        const href = csvCell?.querySelector("a")?.getAttribute("href");
        const file = fileNameFromHref(href);
        if (!file) return [];
        return [{
            file,
            name: cells[0]?.textContent.trim().replace(/\s+/g, " ") || file,
            url: `${BASE}/aduomenys/?byla=${encodeURIComponent(file)}`,
        }];
    });

    const sources = classifyJarAdditionalFiles(entries);
    if (!sources.length) {
        throw new Error("RC CMS puslapyje nerastas nė vienas papildomas JAR CSV");
    }
    return sources;
}


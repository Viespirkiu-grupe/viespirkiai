import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "adresuRegistrasDataSources" });
import { parseHTML } from "linkedom";

const BASE = "https://www.registrucentras.lt";
const SLUG = "adresu-registro-pirminiai-duomenys-raw-data";

const SECTION_KEYS = [
    "adminUnits",
    "buildingAddresses",
    "premiseAddresses",
    "addressPoints",
];

const COLUMN_MAP = {
    "Duomenų rinkinio struktūra *.XLSX formatu": "schema",
    "Duomenys *.CSV formatu": "csv",
    "Duomenys *.XLSX formatu": "xlsx",
    "Duomenys *.GEOJSONformatu": "geojson",
    Duomenys: "geojson",
};

/**
 * RC portalas yra SPA — turinys (su lentelėmis) ateina iš jų Strapi CMS.
 * Viešas CMS adresas ir token'as publikuojami pačių RC /config.js faile.
 */
async function getCmsConfig() {
    const res = await scrapeFetch(`${BASE}/config.js`);
    if (!res.ok) throw new Error(`config.js: HTTP ${res.status}`);
    const text = await res.text();
    const url = text.match(/ENV_FRONTEND_CMS_URL:\s*"([^"]+)"/)?.[1];
    const token = text.match(/ENV_FRONTEND_CMS_TOKEN:\s*"([^"]+)"/)?.[1];
    if (!url || !token)
        throw new Error("config.js: nerastas CMS URL arba token");
    return { url, token };
}

export async function getArDataSources() {
    const cms = await getCmsConfig();
    const res = await scrapeFetch(
        `${cms.url}/api/open-data-pages?` +
            new URLSearchParams({
                "filters[slug][$eq]": SLUG,
                populate: "*",
            }),
        { headers: { Authorization: `Bearer ${cms.token}` } },
    );
    if (!res.ok) throw new Error(`CMS API: HTTP ${res.status}`);
    const page = (await res.json()).data?.[0];
    const html = page?.content?.content;
    if (!html) throw new Error(`CMS API: nerastas puslapio "${SLUG}" turinys`);

    const { document } = parseHTML(`<body>${html}</body>`);

    const result = {};
    [...document.querySelectorAll("table")].forEach((table, i) => {
        const headers = [...table.querySelectorAll("thead th, thead td")].map(
            (th) => th.textContent.trim().replace(/\s+/g, " "),
        );
        const rows = [...table.querySelectorAll("tbody tr")].flatMap((tr) => {
            const cells = [...tr.querySelectorAll("td")];
            if (!cells.length) return [];
            const entry = {
                name: cells[0].textContent.trim().replace(/ /g, " "),
            };
            cells.slice(1).forEach((td, j) => {
                const href = td.querySelector("a")?.getAttribute("href");
                const field = COLUMN_MAP[headers[j + 1]] ?? `col${j + 1}`;
                entry[field] = href
                    ? href.startsWith("http")
                        ? href
                        : `${BASE}${href}`
                    : null;
            });
            return [entry];
        });
        result[SECTION_KEYS[i] ?? `section_${i}`] = rows;
    });

    return result;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    console.log(JSON.stringify(await getArDataSources(), null, 2));
}

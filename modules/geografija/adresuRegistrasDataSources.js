import puppeteer from "puppeteer";

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

export async function getArDataSources() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent({
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
        await page.goto(
            "https://www.registrucentras.lt/atviri-duomenys-ir-statistika/adresu-registro-pirminiai-duomenys-raw-data",
            { waitUntil: "networkidle2", timeout: 60000 },
        );
        await page.waitForSelector("table", { timeout: 15000 });

        const raw = await page.evaluate(() => {
            const BASE = "https://www.registrucentras.lt";
            return [...document.querySelectorAll("table")].map((table) => {
                const headers = [
                    ...table.querySelectorAll("thead th, thead td"),
                ].map((th) => th.textContent.trim().replace(/\s+/g, " "));
                const rows = [...table.querySelectorAll("tbody tr")].flatMap(
                    (tr) => {
                        const cells = [...tr.querySelectorAll("td")];
                        if (!cells.length) return [];
                        const row = {
                            name: cells[0].textContent
                                .trim()
                                .replace(/\u00A0/g, " "),
                        };
                        cells.slice(1).forEach((td, i) => {
                            const a = td.querySelector("a");
                            row[headers[i + 1] ?? `col${i + 1}`] = a
                                ? {
                                      url: a
                                          .getAttribute("href")
                                          ?.startsWith("http")
                                          ? a.getAttribute("href")
                                          : `${BASE}${a.getAttribute("href")}`,
                                  }
                                : null;
                        });
                        return [row];
                    },
                );
                return { headers, rows };
            });
        });

        const result = {};
        raw.forEach(({ headers, rows }, i) => {
            const sectionKey = SECTION_KEYS[i] ?? `section_${i}`;
            result[sectionKey] = rows.map((row) => {
                const entry = { name: row.name };
                headers.slice(1).forEach((h) => {
                    const field = COLUMN_MAP[h] ?? h;
                    entry[field] = row[h]?.url ?? null;
                });
                return entry;
            });
        });

        return result;
    } finally {
        await browser.close();
    }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    console.log(JSON.stringify(await getArDataSources(), null, 2));
}

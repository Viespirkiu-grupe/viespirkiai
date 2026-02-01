import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";

function formatPgDate(dateStr) {
    if (!dateStr) return null;

    const parts = dateStr.trim().split(" ");
    if (parts.length !== 2) return null; // invalid format

    const [datePart, timePart] = parts;
    const [d, m, y] = datePart.split("/");
    if (!d || !m || !y) return null; // invalid date

    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${timePart}`;
}

async function gautiCFTS() {
    const puslapyje = 100_000;
    let url = `https://viesiejipirkimai.lt/epps/viewCFTSAction.do?T01_ps=${puslapyje}`;

    let response = await fetch(url);
    let html = await response.text();

    const { document } = parseHTML(html);

    let cfts = [];
    let rows = document.querySelector("#T01 > tbody");

    for (const row of rows.children) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 13) continue;

        const cft = {};

        cft.pavadinimas =
            tds[1].querySelector("a")?.textContent?.trim() ?? null;

        cft.pirkimoId = tds[2].textContent?.trim() ?? null;

        cft.pirkimoVykdytojas = tds[3].textContent?.trim() ?? null;

        cft.informacija =
            tds[4].querySelector("img")?.getAttribute("title")?.trim() ?? null;

        cft.paskelbimoData = tds[5].textContent?.trim() ?? null;

        cft.pasiulymuPateikimoTerminas = tds[6].textContent?.trim() ?? null;

        cft.pirkimoBudas = tds[7].textContent?.trim() ?? null;

        cft.statusas = tds[8].textContent?.trim() ?? null;

        cft.numatomaBendraPirkimoVerte =
            tds[11].textContent?.replace(/,/g, "")?.trim() ?? null;

        cft.zingsnis = tds[12].textContent?.trim() ?? null;

        const href = tds[1].querySelector("a")?.getAttribute("href") ?? "";
        const typeMatch = href.match(
            /\/epps\/(?:cft\/prepareView|pmc\/view|dps\/prepareView)([A-Za-z]+)\.do/,
        );

        if (!typeMatch) {
            throw new Error(`Unexpected href format: ${href}`);
        }

        cft.type = typeMatch[1];

        cft.paskelbimoData = formatPgDate(tds[5].textContent?.trim());
        cft.pasiulymuPateikimoTerminas = formatPgDate(
            tds[6].textContent?.trim(),
        );

        cfts.push(cft);
    }

    console.log(cfts);

    const counts = cfts.reduce((acc, cft) => {
        const type = cft.type || "Unknown";
        const status = cft.statusas || "Unknown";

        if (!acc[type]) acc[type] = {};
        acc[type][status] = (acc[type][status] || 0) + 1;

        return acc;
    }, {});

    console.log(counts);

    return cfts;
}

async function ikeltiCFTS() {
    // Assuming gautiCFTS() returns an array of cft objects
    const chunkSize = 1000;
    const cfts = await gautiCFTS();

    for (let i = 0; i < cfts.length; i += chunkSize) {
        const chunk = cfts.slice(i, i + chunkSize);
        const values = [];
        const placeholders = [];

        chunk.forEach((cft, idx) => {
            const verte =
                Number(cft.numatomaBendraPirkimoVerte?.replace(/,/g, "")) ||
                null;

            values.push(
                cft.pavadinimas,
                cft.pirkimoId,
                cft.pirkimoVykdytojas,
                cft.informacija,
                cft.paskelbimoData,
                cft.pasiulymuPateikimoTerminas,
                cft.pirkimoBudas,
                cft.statusas,
                verte,
                cft.zingsnis,
                cft.type,
            );
            const offset = idx * 11; // 11 columns
            placeholders.push(
                `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`,
            );
        });

        const query = `
        INSERT INTO "viesiejiPirkimai"
        ("pavadinimas", "pirkimoId", "pirkimoVykdytojas", "informacija", "paskelbimoData", "pasiulymuPateikimoTerminas", "pirkimoBudas", "statusas", "numatomaBendraPirkimoVerte", "zingsnis", "type")
        VALUES ${placeholders.join(", ")}
        ON CONFLICT ("pirkimoId") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "pirkimoVykdytojas" = EXCLUDED."pirkimoVykdytojas",
            "informacija" = EXCLUDED."informacija",
            "paskelbimoData" = EXCLUDED."paskelbimoData",
            "pasiulymuPateikimoTerminas" = EXCLUDED."pasiulymuPateikimoTerminas",
            "pirkimoBudas" = EXCLUDED."pirkimoBudas",
            "statusas" = EXCLUDED."statusas",
            "numatomaBendraPirkimoVerte" = EXCLUDED."numatomaBendraPirkimoVerte",
            "zingsnis" = EXCLUDED."zingsnis",
            "type" = EXCLUDED."type";
    `;

        await postgres.query(query, values);

        console.log(`Inserted/Updated ${chunk.length} records.`);
    }

    return false;
}

await ikeltiCFTS();

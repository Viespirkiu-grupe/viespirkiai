// Planuojamų (metinių) pirkimų sąrašo skreiperis.
// https://cvpp.eviesiejipirkimai.lt/PlannedProcurement/List
// Paieška filtruojama pagal paskelbimo datą (GET), tad einama diena po dienos.
import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";

const BASE = "https://cvpp.eviesiejipirkimai.lt";
const PAGE_SIZE = 100;

// Stulpeliai, kuriuos valdo scraperis.
const PLANUOJAMI_COLUMNS = [
    "planuojamoPirkimoId",
    "tipoId",
    "pavadinimas",
    "link",
    "pirkimoVykdytojas",
    "pirkimoVykdytojoLink",
    "perkanciosiosOrganizacijosId",
    "sektorius",
    "paskelbimoData",
    "numatomosPirkimoPradziosData",
];

// Upsertina į public."cvppPlanuojamiPirkimai" pagal "planuojamoPirkimoId".
// Grąžina upsertintų eilučių skaičių.
export async function upsertPlanuojamiPirkimai(pirkimai) {
    const rows = pirkimai.filter((p) => p?.planuojamoPirkimoId != null);
    if (rows.length === 0) return 0;

    const placeholders = rows
        .map(
            (_, r) =>
                `(${PLANUOJAMI_COLUMNS.map(
                    (_, c) => `$${r * PLANUOJAMI_COLUMNS.length + c + 1}`,
                ).join(", ")})`,
        )
        .join(", ");

    const values = rows.flatMap((p) =>
        PLANUOJAMI_COLUMNS.map((col) => p[col] ?? null),
    );

    const updates = PLANUOJAMI_COLUMNS.filter(
        (col) => col !== "planuojamoPirkimoId",
    )
        .map((col) => `"${col}" = EXCLUDED."${col}"`)
        .join(", ");

    await postgres.query(
        `INSERT INTO public."cvppPlanuojamiPirkimai" (${PLANUOJAMI_COLUMNS.map(
            (col) => `"${col}"`,
        ).join(", ")})
         VALUES ${placeholders}
         ON CONFLICT ("planuojamoPirkimoId") DO UPDATE SET ${updates}`,
        values,
    );

    return rows.length;
}

export async function scrapePlanuojamiPirkimaiPuslapis(day, pageNumber) {
    const url =
        `${BASE}/PlannedProcurement/List?PublishedDateFrom=${day}&PublishedDateTo=${day}` +
        `&pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}&OrderingType=1&OrderingDirection=1`;
    const response = await fetch(url);
    const { document } = parseHTML(await response.text());

    return [...document.querySelectorAll(".notice-search-item")].map((el) => {
        const headerLink = el.querySelector(".notice-search-item-header a");
        const href = headerLink?.getAttribute("href") || "";
        const fullLink = href.startsWith("/") ? `${BASE}${href}` : href;

        // /PlannedProcurement/Details/303666?type=1
        const idMatch = href.match(/\/Details\/(\d+)/)?.[1];
        const planuojamoPirkimoId = idMatch ? Number(idMatch) : null;
        const tipoIdStr = new URL(fullLink, BASE).searchParams.get("type");
        const tipoId = tipoIdStr ? Number(tipoIdStr) : null;

        const vykdytojasEl = el.querySelector(".left-col a");
        const pirkimoVykdytojoLink =
            vykdytojasEl?.getAttribute("href")?.trim() || null;
        // .../ctm/Company/CompanyInformation/Index/4670
        const perkOrgId = pirkimoVykdytojoLink?.match(
            /\/CompanyInformation\/Index\/(\d+)/,
        )?.[1];
        const perkanciosiosOrganizacijosId = perkOrgId
            ? Number(perkOrgId)
            : null;

        const rightDivs = [...el.querySelectorAll(".right-col div")];
        const rightValue = (label) => {
            const div = rightDivs.find((d) => d.textContent.includes(label));
            if (!div) return null;
            return (
                div.textContent.replace(label, "").replace(/\s+/g, " ").trim() ||
                null
            );
        };

        return {
            planuojamoPirkimoId,
            tipoId,
            pavadinimas: headerLink?.textContent.trim() || null,
            link: fullLink || null,
            pirkimoVykdytojas: vykdytojasEl?.textContent.trim() || null,
            pirkimoVykdytojoLink,
            perkanciosiosOrganizacijosId,
            sektorius: rightValue("Sektorius:"),
            paskelbimoData: rightValue("Paskelbimo data:"),
            numatomosPirkimoPradziosData: rightValue(
                "Numatomos pirkimo pradžios data:",
            ),
        };
    });
}

// Nuskaito visus vienos dienos puslapius ir juos upsertina.
export async function scrapePlanuojamiPirkimaiDiena(day) {
    let total = 0;
    for (let page = 1; ; page++) {
        const pirkimai = await scrapePlanuojamiPirkimaiPuslapis(day, page);
        if (pirkimai.length === 0) break;
        total += await upsertPlanuojamiPirkimai(pirkimai);
        if (pirkimai.length < PAGE_SIZE) break;
    }
    return total;
}

// Eina diena po dienos nuo fromDate iki toDate (imtinai), mažėjančia tvarka.
export async function scrapeVisusPlanuojamusPirkimus(
    fromDate = "2024-12-03",
    toDate = "2018-02-15",
) {
    const end = new Date(toDate);
    let total = 0;
    for (
        let date = new Date(fromDate);
        date >= end;
        date.setDate(date.getDate() - 1)
    ) {
        const day = date.toISOString().split("T")[0];
        const count = await scrapePlanuojamiPirkimaiDiena(day);
        total += count;
        if (count > 0) {
            console.log(`${day}: upsertinta ${count} (viso ${total})`);
        }
    }
    return total;
}

// CLI: node scrapePlanuojamiPirkimai.js [fromDate] [toDate]
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const fromDate = process.argv[2] || undefined;
    const toDate = process.argv[3] || undefined;
    scrapeVisusPlanuojamusPirkimus(fromDate, toDate)
        .then(async (total) => {
            console.log(`Viso upsertinta planuojamų pirkimų: ${total}`);
            await postgres.end();
        })
        .catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
}

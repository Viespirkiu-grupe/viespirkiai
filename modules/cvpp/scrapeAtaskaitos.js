// https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol?pageNumber=1317&pageSize=100&OrderingType=1&OrderingDirection=1&ReportsOrProtocolIds=1%2C2%2C3%2C4%2C5%2C6&IncludeExpired=true
import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";

// Stulpeliai, kuriuos valdo scraperis. "turinioMd5" specialiai neįtrauktas —
// jį pildo kitas procesas, tad upsert jo neliečia.
const ATASKAITOS_COLUMNS = [
    "ataskaitosNumeris",
    "pavadinimas",
    "link",
    "formTypeId",
    "pirkimoVykdytojas",
    "pirkimoVykdytojoLink",
    "pirkimoVykdytojoKodas",
    "tipas",
    "pirkimoNumeris",
    "paskelbimoData",
    "redagavimoData",
];

// Upsertina ataskaitas į public."cvppAtaskaitos" pagal "ataskaitosNumeris".
// Grąžina upsertintų eilučių skaičių.
export async function upsertAtaskaitos(ataskaitos) {
    const rows = ataskaitos.filter((a) => a?.ataskaitosNumeris);
    if (rows.length === 0) return 0;

    const placeholders = rows
        .map(
            (_, r) =>
                `(${ATASKAITOS_COLUMNS.map(
                    (_, c) => `$${r * ATASKAITOS_COLUMNS.length + c + 1}`,
                ).join(", ")})`,
        )
        .join(", ");

    const values = rows.flatMap((a) =>
        ATASKAITOS_COLUMNS.map((col) => a[col] ?? null),
    );

    const updates = ATASKAITOS_COLUMNS.filter(
        (col) => col !== "ataskaitosNumeris",
    )
        .map((col) => `"${col}" = EXCLUDED."${col}"`)
        .join(", ");

    await postgres.query(
        `INSERT INTO public."cvppAtaskaitos" (${ATASKAITOS_COLUMNS.map(
            (col) => `"${col}"`,
        ).join(", ")})
         VALUES ${placeholders}
         ON CONFLICT ("ataskaitosNumeris") DO UPDATE SET ${updates}`,
        values,
    );

    return rows.length;
}

export async function scrapeAtaskaitosPuslapis(pageNumber) {
    const url = `https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol?pageNumber=${pageNumber}&pageSize=100&OrderingType=1&OrderingDirection=1&ReportsOrProtocolIds=1%2C2%2C3%2C4%2C5%2C6&IncludeExpired=true`;
    const response = await fetch(url);
    const text = await response.text();
    const { document } = parseHTML(text);

    return [...document.querySelectorAll(".notice-search-item")].map((el) => {
        const headerLink = el.querySelector(".notice-search-item-header a");
        const href = headerLink?.getAttribute("href") || "";
        const fullLink = href.startsWith("/")
            ? `https://cvpp.eviesiejipirkimai.lt${href}`
            : href;
        const formTypeId =
            new URL(fullLink, "https://cvpp.eviesiejipirkimai.lt").searchParams.get(
                "formTypeId",
            ) || null;

        const vykdytojasEl = el.querySelector(".left-col a");

        const kodaDiv = [...el.querySelectorAll(".left-col div")].find((d) =>
            d.textContent.includes("juridinio asmens kodas:"),
        );
        const pirkimoVykdytojoKodas = kodaDiv
            ? kodaDiv.textContent.replace(/.*juridinio asmens kodas:/, "").trim() ||
              null
            : null;

        const tipasEl = el.querySelector(".left-col strong");

        const numerisDiv = [...el.querySelectorAll(".left-col div")].find((d) =>
            d.textContent.includes("Pirkimo numeris:"),
        );
        const pirkimoNumeris = numerisDiv
            ? numerisDiv.textContent.replace("Pirkimo numeris:", "").trim() || null
            : null;

        const rightDivs = [...el.querySelectorAll(".right-col div")];

        const ataskaitosNumerisDiv = rightDivs.find((d) =>
            d.textContent.includes("Ataskaitos numeris:"),
        );
        const ataskaitosNumeris = ataskaitosNumerisDiv
            ? ataskaitosNumerisDiv.textContent
                  .replace("Ataskaitos numeris:", "")
                  .trim() || null
            : null;

        const paskelbimoDataDiv = rightDivs.find((d) =>
            d.textContent.includes("Paskelbimo data:"),
        );
        const paskelbimoData = paskelbimoDataDiv
            ? paskelbimoDataDiv.textContent
                  .replace("Paskelbimo data:", "")
                  .trim() || null
            : null;

        const redagavimoDataDiv = rightDivs.find((d) =>
            d.textContent.includes("Redagavimo data:"),
        );
        const redagavimoData = redagavimoDataDiv
            ? redagavimoDataDiv.textContent
                  .replace("Redagavimo data:", "")
                  .trim() || null
            : null;

        return {
            pavadinimas: headerLink?.textContent.trim() || null,
            link: fullLink || null,
            formTypeId,
            ataskaitosNumeris,
            pirkimoVykdytojas: vykdytojasEl?.textContent.trim() || null,
            pirkimoVykdytojoLink:
                vykdytojasEl?.getAttribute("href")?.trim() || null,
            pirkimoVykdytojoKodas,
            tipas: tipasEl?.textContent.trim() || null,
            pirkimoNumeris,
            paskelbimoData,
            redagavimoData,
        };
    });
}

// Praeina visus puslapius nuo startPage, kol randa tuščią puslapį, ir kiekvieną
// iškart upsertina. Grąžina bendrą upsertintų ataskaitų skaičių.
export async function scrapeVisusAtaskaitas(startPage = 1) {
    let total = 0;
    for (let page = startPage; ; page++) {
        const ataskaitos = await scrapeAtaskaitosPuslapis(page);
        if (ataskaitos.length === 0) break;
        const count = await upsertAtaskaitos(ataskaitos);
        total += count;
        console.log(`Puslapis ${page}: upsertinta ${count} (viso ${total})`);
    }
    return total;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const startPage = parseInt(process.argv[2] ?? "1", 10);
    scrapeVisusAtaskaitas(startPage)
        .then(async (total) => {
            console.log(`Viso upsertinta ataskaitų: ${total}`);
            await postgres.end();
        })
        .catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
}

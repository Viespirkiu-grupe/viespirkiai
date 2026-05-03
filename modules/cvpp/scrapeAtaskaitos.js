// https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol?pageNumber=1317&pageSize=100&OrderingType=1&OrderingDirection=1&ReportsOrProtocolIds=1%2C2%2C3%2C4%2C5%2C6&IncludeExpired=true
import { parseHTML } from "linkedom";

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

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const pageNumber = parseInt(process.argv[2] ?? "1", 10);
    scrapeAtaskaitosPuslapis(pageNumber).then((ataskaitos) => {
        console.log(JSON.stringify(ataskaitos, null, 2));
    });
}

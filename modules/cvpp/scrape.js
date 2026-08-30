import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "scrape" });
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";

export async function nuskaitytiCvppViesuosiusPirkimus(
    startDate = new Date("2017-07-04"),
) {
    // Loop from startDate to today
    let endDate = new Date();
    for (
        let date = new Date(startDate); // use the parameter
        date <= endDate;
        date.setDate(date.getDate() + 1)
    ) {
        let dateString = date.toISOString().split("T")[0];
        await nuskaitytiDienosCvppViesuosiusPirkimus(dateString);
    }
}

async function nuskaitytiDienosCvppViesuosiusPirkimus(data) {
    let url = `https://cvpp.eviesiejipirkimai.lt/?IncludeExpired=true&PublishedFromDate=${data}&PublishedToDate=${data}&PageSize=1000`;
    logger.log(`Nuskaitymas iš ${url}`);

    let response = await scrapeFetch(url);
    let text = await response.text();
    let { document } = parseHTML(text);

    let skelbimaiElementai = document.querySelectorAll(".notice-search-item");
    logger.log(`Rasta skelbimų: ${skelbimaiElementai.length}`);

    let skelbimai = [];
    skelbimaiElementai.forEach((el) => {
        const skelbimas = {
            pavadinimas:
                el
                    .querySelector(
                        ".notice-search-item-header > a:not(.doc-icon)",
                    )
                    ?.textContent.trim() || null,
            pirkimoVykdytojas:
                el.querySelector(".left-col a")?.textContent.trim() || null,
            pirkimoVykdytojoLink:
                el.querySelector(".left-col a")?.getAttribute("href")?.trim() ||
                null,
            skelbimoTipas:
                el.querySelector(".left-col strong")?.textContent.trim() ||
                null,
            pirkimoNumeris:
                el
                    .querySelector(".left-col div:nth-of-type(3) strong")
                    ?.textContent.trim() || null,
            skelbimoKodas:
                el
                    .querySelector(".right-col div:nth-of-type(1)")
                    ?.textContent.replace("Skelbimo kodas:", "")
                    .trim() || null,
            pasiulymuPateikimoTerminas: (() => {
                const labelEl = el.querySelector(
                    ".right-col .label.label-info",
                );
                return labelEl?.textContent.trim() || null;
            })(),

            paskelbimoData: (() => {
                const divs = el.querySelectorAll(".right-col > div");
                for (const div of divs) {
                    const elText = div.textContent?.trim();
                    if (elText && elText.includes("Paskelbimo data:")) {
                        return elText.replace("Paskelbimo data:", "").trim();
                    }
                }
                return null;
            })(),
            zenkliukas:
                el
                    .querySelector(".notice-search-item-header img")
                    ?.getAttribute("src")
                    ?.match(/flag_(\w+)\.(?:gif|png)/)?.[1]
                    .replace(/_./g, (m) => m[1].toUpperCase()) || null,
            link:
                el
                    .querySelector(
                        ".notice-search-item-header a:not(.pull-right)",
                    )
                    ?.getAttribute("href") || "",
            dokumentaiLink:
                el
                    .querySelector(".notice-search-item-header a.doc-icon")
                    ?.getAttribute("href") || "",
            ataskaitosLink:
                el
                    .querySelector(
                        '.right-col a[href*="/ReportsOrProtocol/"]',
                    )
                    ?.getAttribute("href")
                    ?.trim() || null,
        };

        if (skelbimas.link && skelbimas.link.startsWith("/")) {
            skelbimas.link = `https://cvpp.eviesiejipirkimai.lt${skelbimas.link}`;
        }

        // Ataskaitos kodas ir tipo id iš nuorodos
        // pvz. /ReportsOrProtocol/Details/2023-624284?formTypeId=1
        if (skelbimas.ataskaitosLink) {
            skelbimas.ataskaitosKodas =
                skelbimas.ataskaitosLink.match(
                    /\/Details\/([^/?#]+)/,
                )?.[1] || null;
            const tipoId = skelbimas.ataskaitosLink.match(
                /[?&]formTypeId=(\d+)/,
            )?.[1];
            skelbimas.ataskaitosTipoId = tipoId ? Number(tipoId) : null;
            if (skelbimas.ataskaitosLink.startsWith("/")) {
                skelbimas.ataskaitosLink = `https://cvpp.eviesiejipirkimai.lt${skelbimas.ataskaitosLink}`;
            }
        } else {
            skelbimas.ataskaitosKodas = null;
            skelbimas.ataskaitosTipoId = null;
        }

        // Perkančiosios organizacijos id iš pirkimo vykdytojo nuorodos
        // pvz. .../ctm/Company/CompanyInformation/Index/34617
        skelbimas.perkanciosiosOrganizacijosId = (() => {
            const id = skelbimas.pirkimoVykdytojoLink?.match(
                /\/CompanyInformation\/Index\/(\d+)/,
            )?.[1];
            return id ? Number(id) : null;
        })();

        skelbimai.push(skelbimas);
    });

    if (!skelbimai.length) return;

    const values = [];
    const placeholders = [];

    skelbimai.forEach((s, i) => {
        const idx = i * 15; // 15 columns
        placeholders.push(
            `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13}, $${idx + 14}, $${idx + 15})`,
        );
        values.push(
            s.skelbimoKodas,
            s.pavadinimas,
            s.pirkimoVykdytojas,
            s.pirkimoVykdytojoLink,
            s.skelbimoTipas,
            s.pirkimoNumeris,
            s.pasiulymuPateikimoTerminas,
            s.paskelbimoData,
            s.zenkliukas,
            s.link,
            s.dokumentaiLink,
            s.ataskaitosLink,
            s.ataskaitosKodas,
            s.ataskaitosTipoId,
            s.perkanciosiosOrganizacijosId,
        );
    });

    await postgres.query(
        `INSERT INTO cvpp."archyvoSkelbimai"
        ("skelbimoKodas", pavadinimas, "pirkimoVykdytojas", "pirkimoVykdytojoLink", "skelbimoTipas", "pirkimoNumeris", "pasiulymuPateikimoTerminas", "paskelbimoData", zenkliukas, link, "dokumentaiLink", "ataskaitosLink", "ataskaitosKodas", "ataskaitosTipoId", "perkanciosiosOrganizacijosId")
        VALUES ${placeholders.join(", ")}
        ON CONFLICT ("skelbimoKodas") DO UPDATE SET
          pavadinimas = EXCLUDED.pavadinimas,
          "pirkimoVykdytojas" = EXCLUDED."pirkimoVykdytojas",
          "pirkimoVykdytojoLink" = EXCLUDED."pirkimoVykdytojoLink",
          "skelbimoTipas" = EXCLUDED."skelbimoTipas",
          "pirkimoNumeris" = EXCLUDED."pirkimoNumeris",
          "pasiulymuPateikimoTerminas" = EXCLUDED."pasiulymuPateikimoTerminas",
          "paskelbimoData" = EXCLUDED."paskelbimoData",
          zenkliukas = EXCLUDED.zenkliukas,
          link = EXCLUDED.link,
          "dokumentaiLink" = EXCLUDED."dokumentaiLink",
          "ataskaitosLink" = EXCLUDED."ataskaitosLink",
          "ataskaitosKodas" = EXCLUDED."ataskaitosKodas",
          "ataskaitosTipoId" = EXCLUDED."ataskaitosTipoId",
          "perkanciosiosOrganizacijosId" = EXCLUDED."perkanciosiosOrganizacijosId"`,
        values,
    );

    logger.log(`Įrašyta/atnaujinta įrašų: ${skelbimai.length}`);
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    // take first argument as start date if provided
    const startDateArg = process.argv[2]
        ? new Date(process.argv[2])
        : undefined;

    nuskaitytiCvppViesuosiusPirkimus(startDateArg)
        .then(() => {
            logger.log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

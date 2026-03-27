import { log } from "../../utils/log.js";
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
    log(`Nuskaitymas iš ${url}`);

    let response = await fetch(url);
    let text = await response.text();
    let { document } = parseHTML(text);

    let skelbimaiElementai = document.querySelectorAll(".notice-search-item");
    log(`Rasta skelbimų: ${skelbimaiElementai.length}`);

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
                const elText = el
                    .querySelector(".right-col div:nth-of-type(3)")
                    ?.textContent?.trim();
                return elText && elText.includes("Paskelbimo data:")
                    ? elText.replace("Paskelbimo data:", "").trim()
                    : null;
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
        };

        console.log(skelbimas.link, skelbimas.dokumentaiLink);
        if (skelbimas.link && skelbimas.link.startsWith("/")) {
            skelbimas.link = `https://cvpp.eviesiejipirkimai.lt${skelbimas.link}`;
        }
        skelbimai.push(skelbimas);
    });

    if (!skelbimai.length) return;

    const values = [];
    const placeholders = [];

    skelbimai.forEach((s, i) => {
        const idx = i * 11; // 11 columns
        placeholders.push(
            `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11})`,
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
        );
    });

    await postgres.query(
        `INSERT INTO "cvppViesiejiPirkimai"
        ("skelbimoKodas", pavadinimas, "pirkimoVykdytojas", "pirkimoVykdytojoLink", "skelbimoTipas", "pirkimoNumeris", "pasiulymuPateikimoTerminas", "paskelbimoData", zenkliukas, link, "dokumentaiLink")
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
          "dokumentaiLink" = EXCLUDED."dokumentaiLink"`,
        values,
    );

    log(`Įrašyta/atnaujinta įrašų: ${skelbimai.length}`);
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
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

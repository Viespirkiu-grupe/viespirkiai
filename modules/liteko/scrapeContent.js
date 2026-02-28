/*
Parsiunčia bylų turinį iš Liteko sistemos ir įterpia jį į Postgres duomenų bazę.
*/

import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

/**
 * Nuskaito nutarties puslapį ir ištraukia šalis bei kategorijas.
 * @param {string} link - Nutarties nuoroda.
 * @returns {Promise<{salys: Array<{pavadinimas: string, kodas: string, bylojeKaip: string}>, kategorijos: string[]}>}
 */
async function nuskaitytiNutarti(link) {
    let url = "https://liteko.teismai.lt/viesasprendimupaieska/" + link;
    log(`Nuskaitoma byla ${url}`);

    let response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    let text = await response.text();

    let { document } = parseHTML(text);
    let saliuLentele;

    document.querySelectorAll("th").forEach((th) => {
        if (th.textContent.trim() === "Byloje kaip") {
            let table = th.closest("table");
            if (table) saliuLentele = table;
        }
    });

    let salys = [];
    if (saliuLentele) {
        salys = Array.from(saliuLentele.querySelectorAll("tbody tr")).map(
            (tr) => {
                let tds = tr.querySelectorAll("td");
                return {
                    pavadinimas: tds[0]?.textContent.trim() || "",
                    kodas: tds[1]?.textContent.trim() || "",
                    bylojeKaip: tds[2]?.textContent.trim() || "",
                };
            },
        );
    }

    let nutartiesTekstas = document.querySelector(
        "#ctl00_ContentPlaceHolder1_txthtml",
    ).innerText;

    // Regex find all the 9 digit numbers
    let jarKodai = nutartiesTekstas.match(/\b\d{9}\b/g) || [];
    jarKodai.forEach((kodas) => {
        salys.push({
            pavadinimas: "",
            kodas: kodas,
            bylojeKaip: "Minima tekste",
        });
    });

    // Panaikiname pasikartojimus
    salys = salys.filter(
        (item, index, arr) =>
            arr.findIndex((obj) => obj.kodas === item.kodas) === index,
    );

    const kategorijos = Array.from(
        document.querySelectorAll(
            'td span[id^="ctl00_ContentPlaceHolder1_kategorijuList_ctrl"]',
        ),
    ).map((span) => span.textContent.trim());

    return { salys, kategorijos };
}

let rollingAverage = [];

/**
 * Suranda bylas, kurių juridiniai asmenys dar nėra nuskaityti, ir jas apdoroja.
 * @param {number} batchSize - Kiek bylų apdoroti vienu metu.
 * @returns {Promise<boolean>} - Grąžina true, jei yra daugiau bylų apdoroti, kitaip false.
 */
export async function surastiBylosSalis(batchSize = 1) {
    const { rows: bylos } = await postgres.query(
        `SELECT * FROM bylos
         WHERE "juridiniuNuskaitymas" = 0 OR "juridiniuNuskaitymas" IS NULL
         LIMIT $1`,
        [batchSize],
    );

    if (!bylos.length) {
        log("Visos bylos nuskaitytos.");
        return false;
    }

    for (const byla of bylos) {
        try {
            var start = Date.now();
            var { salys } = await nuskaitytiNutarti(byla.fileHref);

            if (salys.length > 0) {
                const values = salys
                    .map((s) => [
                        byla.id,
                        s.pavadinimas || "",
                        s.kodas || "",
                        s.bylojeKaip || "",
                        byla.data,
                    ])
                    .flat();

                const placeholders = salys
                    .map(
                        (_, i) =>
                            `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
                    )
                    .join(", ");

                await postgres.query(
                    `INSERT INTO "bylosDalyviai" ("bylosId", "pavadinimas", "kodas", "bylojeKaip", "data") VALUES ${placeholders}`,
                    values,
                );
            }
            await postgres.query(
                `UPDATE "bylos" SET "juridiniuNuskaitymas" = 1 WHERE "id" = $1`,
                [byla.id],
            );
        } catch (e) {
            await postgres.query(
                `UPDATE "bylos" SET "juridiniuNuskaitymas" = -1 WHERE "id" = $1`,
                [byla.id],
            );
            console.error(e);
            log(`Klaida nuskaitant bylą ID ${byla.id}: ${e.message}`);
            throw e;
        }

        const duration = Date.now() - start;
        rollingAverage.push(duration);
        if (rollingAverage.length > 100)
            rollingAverage = rollingAverage.slice(-100);

        log(
            `Nuskaityta byla ID ${byla.id} — ${salys.length} dalyviai. ` +
                `Užtruko: ${(duration / 1000).toFixed(3)}s`,
        );
    }

    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    while (await surastiBylosSalis()) {
        // Do
    }
}

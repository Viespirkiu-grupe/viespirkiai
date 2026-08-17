import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("mvpTvarkosAprasai", { operation: "scrape" });
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import Timings from "../../utils/timings.js";

export async function nuskaitytiMvpTvarkosAprasuSubjektuPage(
    page = 2,
    options = {},
) {
    let timings = options.timings || new Timings();

    // Check if page is a number
    if (isNaN(page) || page < 1) {
        throw new Error("Puslapis turi būti teigiamas skaičius");
    }

    let url =
        "https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_paieska.asp?&Itemid=112";

    timings.start("subjektaiPageFetch");
    // Post LIST_CURRENT_PAGE=$PAGE&SBJ_SKODAS=&SBJ_PAV=
    let response = await scrapeFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `LIST_CURRENT_PAGE=${page}&SBJ_SKODAS=&SBJ_PAV=`,
    });
    timings.end("subjektaiPageFetch");

    let text = await response.text();
    let { document } = parseHTML(text);

    let table = document.querySelector("html body table.tblThinBorder");
    let rows = table.querySelectorAll("tr");

    let subjektai = [];
    rows.forEach((row) => {
        let link = row.querySelector("a");
        if (link) {
            let href = link.getAttribute("href");
            let match = href.match(/SBJ_ID=(\d+)/);
            if (match) {
                subjektai.push({
                    id: match[1],
                    pavadinimas: link.textContent.trim(),
                    jarKodas:
                        row.textContent.match(/\(įm\. k\. (\d+)\)/)?.[1] ||
                        null,
                });
            }
        }
    });

    if (subjektai.length === 0) {
        return {
            timings,
            rows: 0,
        };
    }

    const values = [];
    const placeholders = [];

    subjektai.forEach((s, i) => {
        const base = i * 3;

        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);

        values.push(s.id, s.pavadinimas, s.jarKodas);
    });

    await postgres.query(
        `
        INSERT INTO "mvpAprasaiSubjektai"
            ("id", "pavadinimas", "jarKodas")
        VALUES
            ${placeholders.join(",")}
        ON CONFLICT ("id") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "jarKodas" = EXCLUDED."jarKodas"
        `,
        values,
    );

    return {
        timings,
        rows: subjektai.length,
    };
}

export async function nuskaitytiMvpTvarkosAprasuSubjektus() {
    let page = 1;
    let count = 0;

    while (true) {
        let { rows } = await nuskaitytiMvpTvarkosAprasuSubjektuPage(page);

        if (rows === 0) {
            break;
        }
        count += rows;
        page++;
    }

    log(`Iš viso rasta MVP subjektų: ${count}`);
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    nuskaitytiMvpTvarkosAprasuSubjektus()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

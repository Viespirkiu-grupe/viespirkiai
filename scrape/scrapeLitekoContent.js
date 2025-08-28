import { parseHTML } from "linkedom";
import { log } from "../utils/log.js";
import { postgres } from "../postgres/postgres.js";

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

    let salys = Array.from(saliuLentele.querySelectorAll("tbody tr")).map(
        (tr) => {
            let tds = tr.querySelectorAll("td");
            return {
                pavadinimas: tds[0]?.textContent.trim() || "",
                kodas: tds[1]?.textContent.trim() || "",
                bylojeKaip: tds[2]?.textContent.trim() || "",
            };
        },
    );

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

export async function surastiBylosSalis(batchSize = 1000, concurrency = 4) {
    const { rows: bylos } = await postgres.query(
        `SELECT * FROM bylos
         WHERE "juridiniuNuskaitymas" < 1 OR "juridiniuNuskaitymas" IS NULL
         LIMIT $1`,
        [batchSize],
    );

    if (!bylos.length) {
        log("Visos bylos nuskaitytos.");
        return false;
    }

    let index = 0;
    let processedThisSecond = 0;

    // Log throughput every second
    const interval = setInterval(() => {
        log(`Processed ${processedThisSecond} bylos in the last second`);
        processedThisSecond = 0;
    }, 1000);

    const processByla = async (byla) => {
        const start = Date.now();
        let { salys } = await nuskaitytiNutarti(byla.fileHref);

        if (salys.length > 0) {
            const values = salys.map((s) => [
                byla.id,
                s.pavadinimas || "",
                s.kodas || "",
                s.bylojeKaip || "",
            ]);
            const flatValues = values.flat();
            const placeholders = values
                .map(
                    (_, i) =>
                        `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
                )
                .join(", ");

            await postgres.query(
                `INSERT INTO "bylosDalyviai" ("bylosId", "pavadinimas", "kodas", "bylojeKaip") VALUES ${placeholders}`,
                flatValues,
            );
        }

        await postgres.query(
            `UPDATE "bylos" SET "juridiniuNuskaitymas" = 1 WHERE "id" = $1`,
            [byla.id],
        );

        const duration = Date.now() - start;
        rollingAverage.push(duration);
        if (rollingAverage.length > 100)
            rollingAverage = rollingAverage.slice(-100);

        processedThisSecond++;

        log(
            `Nuskaityta byla ID ${byla.id} — ${salys.length} dalyviai. ` +
                `Užtruko: ${(duration / 1000).toFixed(3)}s`,
        );
    };

    const workers = Array(Math.min(concurrency, bylos.length))
        .fill(0)
        .map(async () => {
            while (index < bylos.length) {
                const current = bylos[index++];
                await processByla(current);
            }
        });

    await Promise.all(workers);
    clearInterval(interval);

    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    while (await surastiBylosSalis()) {
        // Do
    }
}

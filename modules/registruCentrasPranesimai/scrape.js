import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";

export async function nuskaitytiInformaciniusLeidinius() {
    let url =
        "https://www.registrucentras.lt/jar/infleid/publications.do?activePage=1&pageSize=100000&persist=yes";
    log(`Nuskaitymas iš ${url}`);

    let response = await fetch(url);
    let text = await response.text();
    let { document } = parseHTML(text);

    let table = document.querySelector(".list.w100p");
    let rows = table.querySelectorAll("tr");

    // Ignore header row
    rows = Array.from(rows).slice(1);

    let leidiniai = rows.map((row) => {
        let cells = row.querySelectorAll("td");
        let data = cells[0].textContent.trim();
        let numeris = cells[1].textContent.trim();
        let nuoroda = cells[2].querySelector("a").href;
        return {
            data,
            numeris,
            nuoroda: "https://www.registrucentras.lt/jar/infleid/" + nuoroda,
            oid: nuoroda.split("oid=")[1],
        };
    });

    log(`Rasta leidinių: ${leidiniai.length}`);

    if (leidiniai.length > 0) {
        let paramIndex = 1;
        const params = [];
        const values = leidiniai
            .map((l) => {
                const { data, atnaujintas } = parseData(l.data);
                params.push(l.oid, data, l.numeris, l.nuoroda, atnaujintas);
                const placeholders = Array.from(
                    { length: 5 },
                    () => `$${paramIndex++}`,
                ).join(",");
                return `(${placeholders})`;
            })
            .join(",");

        const query = `
        INSERT INTO "rcInformaciniaiLeidiniai"("oid","data","numeris","nuoroda","atnaujintas")
        VALUES ${values}
        ON CONFLICT("oid") DO UPDATE
        SET
          "data" = EXCLUDED."data",
          "numeris" = EXCLUDED."numeris",
          "nuoroda" = EXCLUDED."nuoroda",
          "atnaujintas" = EXCLUDED."atnaujintas";
        `;

        await postgres.query(query, params);
    }

    log("Duomenys įrašyti į duomenų bazę");
}

function parseData(str) {
    // "2025-03-13\n\t\t\t\t(atnaujintas 2025-03-19 08:16)"
    const match = str.match(
        /^(\d{4}-\d{2}-\d{2})\s*(?:\(atnaujintas\s+([\d-]+\s[\d:]+)\))?/,
    );
    if (!match) return { data: null, atnaujintas: null };
    return {
        data: match[1],
        atnaujintas: match[2] || null,
    };
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    nuskaitytiInformaciniusLeidinius()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

import { parseHTML } from "linkedom";
import { log } from "../utils/log.js";
import { mysql } from "../mysql/mysql.js";

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

export async function surastiBylosSalis() {
    let start = new Date();
    let [byla] = await mysql.query(
        "SELECT * FROM bylos WHERE juridiniuNuskaitymas < 1 OR juridiniuNuskaitymas IS NULL LIMIT 1",
    );

    if (!byla.length) {
        log("Visos bylos nuskaitytos.");
        return false;
    }

    let { salys } = await nuskaitytiNutarti(byla[0].fileHref);

    if (salys.length > 0) {
        var values = salys.map((s) => [
            byla[0].id,
            s.pavadinimas || "",
            s.kodas || "",
            s.bylojeKaip || "",
        ]);

        let placeholders = values.map(() => "(?, ?, ?, ?)").join(", ");
        let flatValues = values.flat();

        await mysql.query(
            `INSERT INTO bylosDalyviai (bylosId, pavadinimas, kodas, bylojeKaip) VALUES ${placeholders}`,
            flatValues,
        );
    }

    // Update juridiniuNuskaitymas to 1
    await mysql.query(
        `UPDATE bylos SET juridiniuNuskaitymas = 1 WHERE id = ?`,
        [byla[0].id],
    );

    let duration = new Date() - start;
    log(
        `Nuskaityta byla ID ${byla[0].id} — ${salys.length} dalyviai. Užtruko: ${(duration / 1000).toFixed(3)}s`,
    );
    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    while (await surastiBylosSalis()) {
        // Do
    }
}

import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import PQueue from "p-queue";
import RPSCounter from "../../utils/rpsCounter.js";

const rps = new RPSCounter();

async function upsertKotis(data) {
    const values = [];
    let paramIndex = 1;

    const rowsSql = data
        .map((d) => {
            const row = [
                d.id,
                d.gavejas,
                d.teikejas,
                d.suteikimoData,
                d.suma,
                d.teisinisPagrindas,
                d.pagalbosRusis,
                d.busena,
                d.norminisTeisesAktas,
                d.individualusTeisesAktas,
                d.registracijosKodas,
                d.europosKomisijaNr,
                d.gavejoKodas,
                d.pagalbosForma,
                d.pagalbosTipas,
                d.gavejoTipas,
                d.produktoSektorius,
                d.gavejoVeiklosKodas,
                d.pagrindinisTikslas,
                d.antrinisTikslas,
                d.tinkamosDengtiIslaidos,
                d.pastaba,
                d.duomenuPildytojas,
                d.taikomosTaisyklės,
            ];

            const placeholders = row.map(() => `$${paramIndex++}`);
            values.push(...row);

            return `(${placeholders.join(", ")})`;
        })
        .join(", ");

    const sql = `
    INSERT INTO "kotis" (
        "id",
        "gavejas",
        "teikejas",
        "suteikimoData",
        "suma",
        "teisinisPagrindas",
        "pagalbosRusis",
        "busena",
        "norminisTeisesAktas",
        "individualusTeisesAktas",
        "registracijosKodas",
        "europosKomisijaNr",
        "gavejoKodas",
        "pagalbosForma",
        "pagalbosTipas",
        "gavejoTipas",
        "produktoSektorius",
        "gavejoVeiklosKodas",
        "pagrindinisTikslas",
        "antrinisTikslas",
        "tinkamosDengtiIslaidos",
        "pastaba",
        "duomenuPildytojas",
        "taikomosTaisyklės"
    )
    VALUES
    ${rowsSql}
    ON CONFLICT ("id")
    DO UPDATE SET
        "gavejas" = EXCLUDED."gavejas",
        "teikejas" = EXCLUDED."teikejas",
        "suteikimoData" = EXCLUDED."suteikimoData",
        "suma" = EXCLUDED."suma",
        "teisinisPagrindas" = EXCLUDED."teisinisPagrindas",
        "pagalbosRusis" = EXCLUDED."pagalbosRusis",
        "busena" = EXCLUDED."busena",
        "norminisTeisesAktas" = EXCLUDED."norminisTeisesAktas",
        "individualusTeisesAktas" = EXCLUDED."individualusTeisesAktas",
        "registracijosKodas" = EXCLUDED."registracijosKodas",
        "europosKomisijaNr" = EXCLUDED."europosKomisijaNr",
        "gavejoKodas" = EXCLUDED."gavejoKodas",
        "pagalbosForma" = EXCLUDED."pagalbosForma",
        "pagalbosTipas" = EXCLUDED."pagalbosTipas",
        "gavejoTipas" = EXCLUDED."gavejoTipas",
        "produktoSektorius" = EXCLUDED."produktoSektorius",
        "gavejoVeiklosKodas" = EXCLUDED."gavejoVeiklosKodas",
        "pagrindinisTikslas" = EXCLUDED."pagrindinisTikslas",
        "antrinisTikslas" = EXCLUDED."antrinisTikslas",
        "tinkamosDengtiIslaidos" = EXCLUDED."tinkamosDengtiIslaidos",
        "pastaba" = EXCLUDED."pastaba",
        "duomenuPildytojas" = EXCLUDED."duomenuPildytojas",
        "taikomosTaisyklės" = EXCLUDED."taikomosTaisyklės";
    `;

    await postgres.query(sql, values);
}

async function nuskaitytiKotisPuslapi(day, page, minAmount) {
    let url = `https://kotis.kt.gov.lt/paraiskos?ordering=aid_amount.asc&aid_date[from]=${day}&aid_date[to]=${day}&ff=1&page=${page}`;
    if (minAmount) {
        url += `&aid_amount[from]=` + Number(minAmount);
    }

    const flsValue = [
        "aid_receiver",
        "aid_provider",
        "aid_date",
        "aid_amount",
        "legal_basis",
        "aid_kind",
        "state",
        "legal_basis_1",
        "legal_basis_2",
        "code",
        "id",
        "valst_schema_nr",
        "receiver_code",
        "aid_form",
        "aid_type",
        "receiver_type",
        "product_sector",
        "receiver_activity_kind",
        "objective",
        "secondary_objective",
        "aid_expenses",
        "comment",
        "aid_submitter",
    ];

    let response = await fetch(url, {
        method: "GET", // or POST if needed
        headers: {
            "Content-Type": "application/json",
            Cookie: `FLS_APPLICATIONS_ITEM=${encodeURIComponent(JSON.stringify(flsValue))}`,
        },
    });

    let text = await response.text();
    rps.record();
    let { document } = parseHTML(text);

    // Check if html body main div.inner_wrap div.container-fluid.mb-3 div.alert.alert-info.my-3 exists
    let irasuNera = document.querySelector(
        "html body main div.inner_wrap div.container-fluid.mb-3 div.alert.alert-info.my-3",
    );
    if (irasuNera) {
        return [];
    }

    let lentele = document.querySelector(".table > tbody:nth-child(2)");
    if (!lentele) {
        throw new Error(`Nepavyko rasti duomenų lentelės puslapyje ${url}`);
    }
    const rows = lentele.querySelectorAll("tr");

    const data = Array.from(rows).map((row) => {
        const cells = row.querySelectorAll("td");

        // Convert "8.043,38 EUR" → 8043.38
        const sumaText = cells[3]?.textContent.trim() || null;
        const sumaNumber = sumaText
            ? parseFloat(sumaText.replace(/[^\d,]/g, "").replace(",", "."))
            : null;

        return {
            gavejas: cells[0]?.textContent.trim() || null, // Pagalbos gavėjas
            teikejas: cells[1]?.textContent.trim() || null, // Pagalbos teikėjas
            suteikimoData:
                cells[2]?.querySelector("a")?.textContent.trim() || null, // Pagalbos suteikimo data
            suma: sumaNumber, // Pagalbos suma
            teisinisPagrindas: cells[4]?.textContent.trim() || null, // Teisinis pagrindas
            pagalbosRusis: cells[5]?.textContent.trim() || null, // Pagalbos rūšis
            busena: cells[6]?.textContent.trim() || null, // Būsena
            norminisTeisesAktas: cells[7]?.textContent.trim() || null, // Nurodykite norminį teisės aktą
            individualusTeisesAktas: cells[8]?.textContent.trim() || null, // Nurodykite individualų teisės aktą
            registracijosKodas: cells[9]?.textContent.trim() || null, // Registracijos kodas
            id:
                cells[10]
                    ?.querySelector("a")
                    ?.textContent.trim()
                    .replace(/^#/, "") || null, // ID without #
            europosKomisijaNr: cells[11]?.textContent.trim() || null, // Valstybės pagalbos numeris
            gavejoKodas: cells[12]?.textContent.trim() || null, // Pagalbos gavėjo kodas
            pagalbosForma: cells[13]?.textContent.trim() || null, // Pagalbos forma
            pagalbosTipas: cells[14]?.textContent.trim() || null, // Pagalbos tipas
            gavejoTipas: cells[15]?.textContent.trim() || null, // Gavėjo tipas
            produktoSektorius: cells[16]?.textContent.trim() || null, // Produkto sektorius
            gavejoVeiklosKodas: cells[17]?.textContent.trim() || null, // Pagalbos gavėjo veiklos rūšies kodas
            pagrindinisTikslas: cells[18]?.textContent.trim() || null, // Pagrindinis tikslas
            antrinisTikslas: cells[19]?.textContent.trim() || null, // Antrinis tikslas
            tinkamosDengtiIslaidos: cells[20]?.textContent.trim() || null, // Tinkamos dengti išlaidos
            pastaba: cells[21]?.textContent.trim() || null, // Pastaba
            duomenuPildytojas: cells[22]?.textContent.trim() || null, // Duomenų pildytojas
            taikomosTaisyklės: cells[23]?.textContent.trim() || null, // Taikomos taisyklės
        };
    });

    await upsertKotis(data);
    return data;
}

async function nuskaitytiKotisDienosDuomenis(day) {
    let minSuma = 0; // starting cutoff
    let totalData = [];

    while (true) {
        let page = 1;
        let batchData = [];

        let duomenys;
        while (page <= 90) {
            duomenys = await nuskaitytiKotisPuslapi(day, page, minSuma);

            if (duomenys.length === 0) break; // no more results in this 90-page batch

            batchData = batchData.concat(duomenys);
            page++;
        }

        if (duomenys.length === 0) break; // nothing fetched, we are done

        totalData = totalData.concat(batchData);

        // Set minSuma for next batch
        minSuma = batchData.reduce(
            (max, d) => (d.suma && d.suma > max ? d.suma : max),
            minSuma,
        );
    }

    log(
        `Nuskaityti visi duomenys už dieną ${day} (${totalData.length} įr., RPS: ${rps.getRPS().toFixed(2)})`,
    );
}

async function nuskaitytiKotisDienasNuo(
    start = "2016-01-04",
    concurrency = 16,
) {
    const startDate = new Date(start);
    const today = new Date();

    const queue = new PQueue({ concurrency });

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        const dayString = d.toISOString().split("T")[0];
        queue.add(async () => {
            try {
                await nuskaitytiKotisDienosDuomenis(dayString);
            } catch (err) {
                console.error(`Klaida nuskaitant dieną ${dayString}:`, err);
            }
        });
    }

    await queue.onIdle(); // Wait for all queued tasks to finish
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    nuskaitytiKotisDienasNuo(undefined, 32)
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

/*
Parsiunčia ir importuoja nepatikimų tiekėjų sąrašą iš VPT XLSX į PostgreSQL duomenų bazę.
*/

import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("vptSarasai", { operation: "nepatikimiScrape" });
import * as XLSX from "xlsx";
import path from "node:path";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const FILE_URL =
    "https://vptlt-my.sharepoint.com/:x:/g/personal/it_vpt_lt/EcX5fHG_a3hIiSKACcIXMjsBerJ0ThaXIR_i1zE61VM_SA?e=DjLbEy&download=1";

function formatUtcDate(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function validDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function normalizeSingleDate(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return formatUtcDate(
            new Date(Math.round((value - 25569) * 86400 * 1000)),
        );
    }

    const text = String(value).trim();
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let year;
    let month;
    let day;
    if (match) {
        [, year, month, day] = match.map(Number);
    } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
        // VPT workbook uses Excel's month/day/year representation here.
        month = Number(match[1]);
        day = Number(match[2]);
        year = Number(match[3]);
    } else if ((match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
        day = Number(match[1]);
        month = Number(match[2]);
        year = Number(match[3]);
    } else {
        throw new Error(`Unsupported VPT date: ${JSON.stringify(value)}`);
    }

    if (!validDateParts(year, month, day)) {
        throw new Error(`Invalid VPT date: ${JSON.stringify(value)}`);
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Normalize an Excel date or a '+' separated date history to one DB date. */
export function normalizeVptDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const values = typeof value === "string" ? value.split("+") : [value];
    // A singular DB column represents the latest explanation submission.
    return values.map(normalizeSingleDate).sort().at(-1);
}

export async function importuotiNepatikimusTiekejus() {
    // Atliekama užklausa
    const firstResponse = await scrapeFetch(FILE_URL, {
        method: "GET",
        redirect: "manual",
    });

    const cookie = firstResponse.headers.get("set-cookie");
    const location = firstResponse.headers.get("location");

    if (!location) throw new Error("No redirect location returned");

    const secondResponse = await scrapeFetch(
        `https://${new URL(FILE_URL).host}${location}`,
        {
            method: "GET",
            headers: { Cookie: cookie ?? "" },
        },
    );

    const arrayBuffer = await secondResponse.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const filename = path.basename(new URL(secondResponse.url).pathname);

    log(`Fetched ${filename}, size: ${fileBuffer.length} bytes`);

    // Nuskaitome duomenis iš XLSX failo
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });

    let nepatikimi = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        {
            defval: null,
        },
    );
    let nepatikimiPagrindimai = XLSX.utils.sheet_to_json(
        workbook.Sheets["nepatikimu_pagr"],
        { defval: null },
    );

    // Pervadiname stulpelius, sudarome Objektą
    nepatikimi.forEach((row) => {
        const keyNamesToReplace = {
            "Įtraukimo, į Nepatikimų tiekėjų sąrašą, atvejų skaičius":
                "atvejoNr",
            "Duomenų įvedimo data": "duomenuIvedimoData",
            "Pirkimo vykdytojo pavadinimas": "pirkimoVykdytojoPavadinimas",
            "Tiekėjo pavadinimas": "tiekejoPavadinimas",
            "Tiekėjo (juridinio asmens) kodas": "tiekejoJarKodas",
            "Pirkimo numeris ": "pirkimoNumeris",
            "Pirkimo sutarties nutraukimo data, arba PV priimto sprendimo dėl sutarties vykdymo su dideliais arba nuolatiniais trūkumais data":
                "sutartiesNutraukimoData",
            "Data, nuo kurios skaičiuojamas 3 metų tiekėjo buvimo Nepatikimų tiekėjų sąraše terminas":
                "dataNuoKuriosSkaiciuojama",
            "Data, iki kurios tiekėjas yra įtrauktas į Nepatikimų tiekėjų sąrašą":
                "itrauktaIki",
            "Tiekėjo kreipimosi į teismą data arba teismo sprendimo įsiteisėjimo data":
                "teismoData",
            "Nuoroda į įsiteisėjusį galutinį teismo sprendimą, kuriuo nustatyta, kad nėra pagrindo tenkinti tiekėjo reikalavimą":
                "teismoSprendimoLink",
            "Teismo sprendimo, kuriuo tenkinamas pirkimo vykdytojo reikalavimas atlyginti nuostolius, įsiteisėjimo data":
                "teismoSprendimoData",
            Metai: "metai",
        };

        for (const [oldKey, newKey] of Object.entries(keyNamesToReplace)) {
            if (row.hasOwnProperty(oldKey)) {
                row[newKey] = row[oldKey];
                delete row[oldKey];
            }
        }

        // Convert excel integer dates to yyyy-mm-dd
        const excelDateKeys = [
            "duomenuIvedimoData",
            "sutartiesNutraukimoData",
            "dataNuoKuriosSkaiciuojama",
            "itrauktaIki",
            "teismoData",
            "teismoSprendimoData",
        ];

        excelDateKeys.forEach((key) => {
            if (row[key] !== null && row[key] !== undefined) {
                row[key] = normalizeVptDate(row[key]);
            }
        });
    });

    nepatikimiPagrindimai.forEach((row) => {
        const keyNamesToReplace = {
            "Duomenų įvedimo data": "duomenuIvedimoData",
            "Pirkimo vykdytojo pavadinimas": "pirkimoVykdytojoPavadinimas",
            "Tiekėjo pavadinimas": "tiekejoPavadinimas",
            "Tiekėjo (juridinio asmens) kodas": "tiekejoJarKodas",
            "Pirkimo numeris ": "pirkimoNumeris",
            "Pirkimo sutarties nutraukimo data, arba PV priimto sprendimo dėl sutarties vykdymo su dideliais arba nuolatiniais trūkumais data":
                "sutartiesNutraukimoData",
            "Tiekėjo įtraukimo į sąrašą priežastis: pirkimo sutarties nutraukimas dėl esminio pirkimo sutarties pažeidimo arba pirkimo vykdytojo priimtas sprendimas, kad tiekėjas pirkimo sutartyje nustatytą esminę pirkimo sutarties sąlygą vykdė su dideliais arba nuolatiniais trūkumais ":
                "itraukimoPriezastis",
            "Tiekėjo paaiškinimo pateikimo data": "paaiskinimoPateikimoData",
            "Tiekėjo  paaiškinimas dėl esminio pirkimo sutarties pažeidimo, dėl kurio buvo nutraukta sutartis, arba dėl pirkimo sutartyje nustatytos esminės pirkimo sutarties sąlygos vykdymo su dideliais arba nuolatiniais trūkumais":
                "tiekejoPaaiskinimas",
            "Tiekėjo paaiškinimo dokumento nuoroda":
                "tiekejoPaaiskinimoDokumentoNuoroda",
        };

        for (const [oldKey, newKey] of Object.entries(keyNamesToReplace)) {
            if (row.hasOwnProperty(oldKey)) {
                row[newKey] = row[oldKey];
                delete row[oldKey];
            }
        }

        // Remove all keys that start with __
        Object.keys(row).forEach((key) => {
            if (key.startsWith("__")) {
                delete row[key];
            }
        });

        // Convert excel integer dates to yyyy-mm-dd
        // Don't use XLSX.SSF.parse_date_code
        const excelDateKeys = [
            "duomenuIvedimoData",
            "sutartiesNutraukimoData",
            "paaiskinimoPateikimoData",
        ];

        excelDateKeys.forEach((key) => {
            if (row[key] !== null && row[key] !== undefined) {
                row[key] = normalizeVptDate(row[key]);
            }
        });
    });

    // Įrašome duomenis į PostgreSQL
    for (let data of nepatikimi) {
        const today = new Date().toLocaleDateString("lt-LT", {
            timeZone: "Europe/Vilnius",
        });

        data.pirkimoNumeris =
            data.pirkimoNumeris != null ? String(data.pirkimoNumeris) : "";
        data.tiekejoJarKodas = String(data.tiekejoJarKodas);

        await postgres.query(
            `
      INSERT INTO "vptJuodiejiSarasai"."tiekejai" (
        "sarasoId",
        "atvejoNr",
        "duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas",
        "tiekejoJarKodas",
        "pirkimoNumeris",
        "sutartiesNutraukimoData",
        "terminoPradzia",
        "itrauktasIki",
        "teismoData",
        "teismoSprendimoLink",
        "teismoSprendimoData",
        "metai",
        "paskutiniKartaMatytaSarase"
      ) VALUES (
        (SELECT "id" FROM "vptJuodiejiSarasai"."sarasai" WHERE "kodas" = 'nepatikimi'),
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
      ON CONFLICT ("sarasoId", "tiekejoJarKodas", "pirkimoNumeris")
      DO UPDATE SET
        "atvejoNr" = EXCLUDED."atvejoNr",
        "duomenuIvedimoData" = EXCLUDED."duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas" = EXCLUDED."pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas" = EXCLUDED."tiekejoPavadinimas",
        "sutartiesNutraukimoData" = EXCLUDED."sutartiesNutraukimoData",
        "terminoPradzia" = EXCLUDED."terminoPradzia",
        "itrauktasIki" = EXCLUDED."itrauktasIki",
        "teismoData" = EXCLUDED."teismoData",
        "teismoSprendimoLink" = EXCLUDED."teismoSprendimoLink",
        "teismoSprendimoData" = EXCLUDED."teismoSprendimoData",
        "metai" = EXCLUDED."metai",
        "paskutiniKartaMatytaSarase" = $14
    `,
            [
                data.atvejoNr,
                data.duomenuIvedimoData,
                data.pirkimoVykdytojoPavadinimas,
                data.tiekejoPavadinimas,
                data.tiekejoJarKodas,
                data.pirkimoNumeris,
                data.sutartiesNutraukimoData,
                data.dataNuoKuriosSkaiciuojama,
                data.itrauktaIki,
                data.teismoData,
                data.teismoSprendimoLink,
                data.teismoSprendimoData,
                data.metai,
                today,
            ],
        );
    }

    for (let data of nepatikimiPagrindimai) {
        data.pirkimoNumeris = data.pirkimoNumeris
            ? String(data.pirkimoNumeris)
            : "0";
        data.tiekejoJarKodas = String(data.tiekejoJarKodas);

        await postgres.query(
            `
      INSERT INTO "vptJuodiejiSarasai"."pagrindimai" (
        "sarasoId",
        "duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas",
        "tiekejoJarKodas",
        "pirkimoNumeris",
        "sutartiesNutraukimoData",
        "itraukimoPriezastis",
        "paaiskinimoPateikimoData",
        "tiekejoPaaiskinimas",
        "tiekejoPaaiskinimoDokumentoNuoroda"
      ) VALUES (
        (SELECT "id" FROM "vptJuodiejiSarasai"."sarasai" WHERE "kodas" = 'nepatikimi'),
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT ("sarasoId", "tiekejoJarKodas", "pirkimoNumeris")
      DO UPDATE SET
        "duomenuIvedimoData" = EXCLUDED."duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas" = EXCLUDED."pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas" = EXCLUDED."tiekejoPavadinimas",
        "sutartiesNutraukimoData" = EXCLUDED."sutartiesNutraukimoData",
        "itraukimoPriezastis" = EXCLUDED."itraukimoPriezastis",
        "paaiskinimoPateikimoData" = EXCLUDED."paaiskinimoPateikimoData",
        "tiekejoPaaiskinimas" = EXCLUDED."tiekejoPaaiskinimas",
        "tiekejoPaaiskinimoDokumentoNuoroda" = EXCLUDED."tiekejoPaaiskinimoDokumentoNuoroda"
    `,
            [
                data.duomenuIvedimoData,
                data.pirkimoVykdytojoPavadinimas,
                data.tiekejoPavadinimas,
                data.tiekejoJarKodas,
                data.pirkimoNumeris,
                data.sutartiesNutraukimoData,
                data.itraukimoPriezastis,
                data.paaiskinimoPateikimoData,
                data.tiekejoPaaiskinimas,
                data.tiekejoPaaiskinimoDokumentoNuoroda,
            ],
        );
    }
    log("Importuoti nepatikimi tiekejai");
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    importuotiNepatikimusTiekejus()
        .then(() => {
            log("Importavimas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida importuojant:", err);
            postgres.end();
        });
}

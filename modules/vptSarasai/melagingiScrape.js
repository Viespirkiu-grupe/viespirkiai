/*
Parsiunčia ir importuoja nepatikimų melagingą informaciją pateikusių tiekėjų sąrašą iš VPT XLSX į PostgreSQL duomenų bazę.
*/

import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("vptSarasai", { operation: "melagingiScrape" });
import * as XLSX from "xlsx";
import path from "node:path";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const FILE_URL =
    "https://vptlt-my.sharepoint.com/:x:/g/personal/it_vpt_lt/EZq--smR_6tHof1To-3DORMBxag2A4HJXspXMUeNfJ36fw?e=fZ5xGy&download=1";

export async function importuotiMelagingusTiekejus() {
    // Atliekame užklausą
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

    // Nuskaitome duomenis iš XLSX
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });

    let melagiai = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        {
            defval: null,
        },
    );
    let melagiuPagrindimai = XLSX.utils.sheet_to_json(
        workbook.Sheets["Melagiu_pagr"],
        { defval: null },
    );

    // Konvertuojame stulpelius į Objektą
    melagiai.forEach((row) => {
        const keyNamesToReplace = {
            "Įtraukimų skaičius": "atvejoNr",
            "Pirkimo numeris": "pirkimoNumeris",
            "Tiekėjo pašalinimo iš pirkimo procedūros data":
                "tiekejoPasalinimoData",
            "Data, nuo kurios skaičiuojamas 1 metų tiekėjo buvimo Melagingą informaciją pateikusių tiekėjų sąraše terminas":
                "dataNuoKuriosSkaiciuojamasTerminas",
            "Data, iki kurios tiekėjas yra įtrauktas į Melagingą informaciją pateikusių tiekėjų sąrašą":
                "itrauktasIki",
            "Įrašymo į Melagingą informaciją pateikusių tiekėjų sąrašą pagrindas":
                "irasymoPagrindas",
            "Duomenų įvedimo data": "duomenuIvedimoData",
            "Pirkimo vykdytojo pavadinimas": "pirkimoVykdytojoPavadinimas",
            "Tiekėjo pavadinimas": "tiekejoPavadinimas",
            "Tiekėjo (juridinio asmens) kodas": "tiekejoJarKodas",
            "Tiekėjo kreipimosi į teismą data arba teismo sprendimo įsiteisėjimo data":
                "teismoData",
            "Nuoroda į įsiteisėjusį galutinį teismo sprendimą, kuriuo nustatyta, kad nėra pagrindo tenkinti tiekėjo reikalavimą":
                "teismoSprendimoLink",
            Metai: "metai",
        };

        for (const [oldKey, newKey] of Object.entries(keyNamesToReplace)) {
            if (row.hasOwnProperty(oldKey)) {
                row[newKey] = row[oldKey];
                delete row[oldKey];
            }
        }

        // Convert excel integer dates to yyyy-mm-dd
        // Don't use XLSX.SSF.parse_date_code
        const excelDateKeys = [
            "duomenuIvedimoData",
            "sutartiesNutraukimoData",
            "dataNuoKuriosSkaiciuojama",
            "itrauktaIki",
            "teismoData",
            "teismoSprendimoData",
            "tiekejoPasalinimoData",
            "dataNuoKuriosSkaiciuojamasTerminas",
            "itrauktasIki",
        ];

        excelDateKeys.forEach((key) => {
            if (row[key] && typeof row[key] === "number") {
                const date = new Date(
                    Math.round((row[key] - 25569) * 86400 * 1000),
                );
                const yyyy = date.getUTCFullYear();
                const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
                const dd = String(date.getUTCDate()).padStart(2, "0");
                row[key] = `${yyyy}-${mm}-${dd}`;
            }
        });
    });

    melagiuPagrindimai.forEach((row) => {
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
            "Tiekėjo pašalinimo iš pirkimo procedūros data ":
                "tiekejoPasalinimoData",
            "Įrašymo į Melagingą informaciją pateikusių tiekėjų sąrašą pagrindas":
                "irasymoPagrindas",
            "Tiekėjo  paaiškinimas dėl pirkimo vykdytojo sprendimo pašalinti tiekėją iš pirkimo procedūros pagal VPĮ 46 straipsnio 4 dalies 4 punktą ":
                "tiekejoPaaiskinimas",
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
        const excelDateKeys = [
            "duomenuIvedimoData",
            "sutartiesNutraukimoData",
            "paaiskinimoPateikimoData",
            "tiekejoPasalinimoData",
        ];

        excelDateKeys.forEach((key) => {
            if (row[key] && typeof row[key] === "number") {
                const date = new Date(
                    Math.round((row[key] - 25569) * 86400 * 1000),
                );
                const yyyy = date.getUTCFullYear();
                const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
                const dd = String(date.getUTCDate()).padStart(2, "0");
                row[key] = `${yyyy}-${mm}-${dd}`;
            }
        });
    });

    // Įrašome duomenis į PostgreSQL
    for (let data of melagiai) {
        // Convert conflict columns to strings to ensure ON CONFLICT works
        const pirkimoNumeris =
            data.pirkimoNumeris != null ? String(data.pirkimoNumeris) : "0";
        const tiekejoJarKodas = String(data.tiekejoJarKodas);

        const today = new Date().toLocaleDateString("lt-LT", {
            timeZone: "Europe/Vilnius",
        });

        await postgres.query(
            `
     INSERT INTO "melagingiTiekejai" (
       "atvejoNr",
       "pirkimoNumeris",
       "tiekejoPasalinimoData",
       "dataNuoKuriosSkaiciuojamasTerminas",
       "itrauktasIki",
       "irasymoPagrindas",
       "duomenuIvedimoData",
       "pirkimoVykdytojoPavadinimas",
       "tiekejoPavadinimas",
       "tiekejoJarKodas",
       "teismoData",
       "teismoSprendimoLink",
       "metai",
       "paskutiniKartaMatytaSarase"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT ("tiekejoJarKodas", "pirkimoNumeris")
     DO UPDATE SET
       "atvejoNr" = EXCLUDED."atvejoNr",
       "tiekejoPasalinimoData" = EXCLUDED."tiekejoPasalinimoData",
       "dataNuoKuriosSkaiciuojamasTerminas" = EXCLUDED."dataNuoKuriosSkaiciuojamasTerminas",
       "itrauktasIki" = EXCLUDED."itrauktasIki",
       "irasymoPagrindas" = EXCLUDED."irasymoPagrindas",
       "duomenuIvedimoData" = EXCLUDED."duomenuIvedimoData",
       "pirkimoVykdytojoPavadinimas" = EXCLUDED."pirkimoVykdytojoPavadinimas",
       "tiekejoPavadinimas" = EXCLUDED."tiekejoPavadinimas",
       "teismoData" = EXCLUDED."teismoData",
       "teismoSprendimoLink" = EXCLUDED."teismoSprendimoLink",
       "metai" = EXCLUDED."metai",
        "paskutiniKartaMatytaSarase" = EXCLUDED."paskutiniKartaMatytaSarase"
   `,
            [
                data.atvejoNr,
                pirkimoNumeris,
                data.tiekejoPasalinimoData,
                data.dataNuoKuriosSkaiciuojamasTerminas,
                data.itrauktasIki,
                data.irasymoPagrindas,
                data.duomenuIvedimoData,
                data.pirkimoVykdytojoPavadinimas,
                data.tiekejoPavadinimas,
                tiekejoJarKodas,
                data.teismoData,
                data.teismoSprendimoLink,
                data.metai,
                today,
            ],
        );
    }

    for (let data of melagiuPagrindimai) {
        // Convert conflict columns to strings
        const tiekejoJarKodas = String(data.tiekejoJarKodas);
        const pirkimoNumeris =
            data.pirkimoNumeris != null ? String(data.pirkimoNumeris) : "0";

        await postgres.query(
            `
      INSERT INTO "melagingiTiekejaiPagrindimai" (
        "duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas",
        "tiekejoJarKodas",
        "pirkimoNumeris",
        "paaiskinimoPateikimoData",
        "tiekejoPaaiskinimoDokumentoNuoroda",
        "tiekejoPasalinimoData",
        "irasymoPagrindas",
        "tiekejoPaaiskinimas"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT ("tiekejoJarKodas", "pirkimoNumeris")
      DO UPDATE SET
        "duomenuIvedimoData" = EXCLUDED."duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas" = EXCLUDED."pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas" = EXCLUDED."tiekejoPavadinimas",
        "paaiskinimoPateikimoData" = EXCLUDED."paaiskinimoPateikimoData",
        "tiekejoPaaiskinimoDokumentoNuoroda" = EXCLUDED."tiekejoPaaiskinimoDokumentoNuoroda",
        "tiekejoPasalinimoData" = EXCLUDED."tiekejoPasalinimoData",
        "irasymoPagrindas" = EXCLUDED."irasymoPagrindas",
        "tiekejoPaaiskinimas" = EXCLUDED."tiekejoPaaiskinimas"
    `,
            [
                data.duomenuIvedimoData,
                data.pirkimoVykdytojoPavadinimas,
                data.tiekejoPavadinimas,
                tiekejoJarKodas,
                pirkimoNumeris,
                data.paaiskinimoPateikimoData,
                data.tiekejoPaaiskinimoDokumentoNuoroda,
                data.tiekejoPasalinimoData,
                data.irasymoPagrindas,
                data.tiekejoPaaiskinimas,
            ],
        );
    }

    log("Importuoti melagingi tiekėjai");
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    importuotiMelagingusTiekejus()
        .then(() => {
            log("Importas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida importuojant melagingus tiekėjus:", err);
            postgres.end();
        });
}

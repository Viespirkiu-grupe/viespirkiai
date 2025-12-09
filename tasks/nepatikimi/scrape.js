/*
Parsiunčia ir importuoja nepatikimų tiekėjų sąrašą iš VPT XLSX į PostgreSQL duomenų bazę.
*/

import * as XLSX from "xlsx";
import path from "node:path";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const FILE_URL =
    "https://vptlt-my.sharepoint.com/:x:/g/personal/it_vpt_lt/EcX5fHG_a3hIiSKACcIXMjsBerJ0ThaXIR_i1zE61VM_SA?e=DjLbEy&download=1";

export async function importuotiNepatikimusTiekejus() {
    // Atliekama užklausa
    const firstResponse = await fetch(FILE_URL, {
        method: "GET",
        redirect: "manual",
    });

    const cookie = firstResponse.headers.get("set-cookie");
    const location = firstResponse.headers.get("location");

    if (!location) throw new Error("No redirect location returned");

    const secondResponse = await fetch(
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
    for (let data of nepatikimi) {
        const today = new Date().toLocaleDateString("lt-LT", {
            timeZone: "Europe/Vilnius",
        });

        data.pirkimoNumeris =
            data.pirkimoNumeris != null ? String(data.pirkimoNumeris) : "";
        data.tiekejoJarKodas = String(data.tiekejoJarKodas);

        await postgres.query(
            `
      INSERT INTO "nepatikimiTiekejai" (
        "atvejoNr",
        "duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas",
        "tiekejoJarKodas",
        "pirkimoNumeris",
        "sutartiesNutraukimoData",
        "dataNuoKuriosSkaiciuojama",
        "itrauktaIki",
        "teismoData",
        "teismoSprendimoLink",
        "teismoSprendimoData",
        "metai",
        "paskutiniKartaMatytaSarase"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
      ON CONFLICT ("tiekejoJarKodas", "pirkimoNumeris")
      DO UPDATE SET
        "atvejoNr" = EXCLUDED."atvejoNr",
        "duomenuIvedimoData" = EXCLUDED."duomenuIvedimoData",
        "pirkimoVykdytojoPavadinimas" = EXCLUDED."pirkimoVykdytojoPavadinimas",
        "tiekejoPavadinimas" = EXCLUDED."tiekejoPavadinimas",
        "sutartiesNutraukimoData" = EXCLUDED."sutartiesNutraukimoData",
        "dataNuoKuriosSkaiciuojama" = EXCLUDED."dataNuoKuriosSkaiciuojama",
        "itrauktaIki" = EXCLUDED."itrauktaIki",
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
      INSERT INTO "nepatikimiTiekejaiPagrindimai" (
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
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT ("tiekejoJarKodas", "pirkimoNumeris")
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

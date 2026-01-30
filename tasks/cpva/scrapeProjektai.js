/*
Parsiunčia ir importuoja CPVA adminstruojamų projektų ir tiekėjų sąrašą
*/

import * as XLSX from "xlsx";
import path from "node:path";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { parseHTML } from "linkedom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

function toAscii(str) {
    if (!str) return str;
    // first normalize to NFD (separates accents)
    let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // handle special Lithuanian letters manually
    const replacements = {
        ą: "a",
        č: "c",
        ę: "e",
        ė: "e",
        į: "i",
        š: "s",
        ų: "u",
        ū: "u",
        ž: "z",
        Ą: "A",
        Č: "C",
        Ę: "E",
        Ė: "E",
        Į: "I",
        Š: "S",
        Ų: "U",
        Ū: "U",
        Ž: "Z",
    };

    return s.replace(/[^\u0000-\u007f]/g, (c) => replacements[c] || c);
}

function cleanRows(rows) {
    return rows.map((row) => {
        const newRow = {};
        for (let [key, value] of Object.entries(row)) {
            if (/^__EMPTY/.test(key)) continue;

            const newKey = toCamelCase(toAscii(key));

            if (typeof value === "string") {
                value = toAscii(value.replace(/[\r\n]/g, ""));
            }

            newRow[newKey] = value;
        }
        return newRow;
    });
}

function toCamelCase(str) {
    if (!str) return "";

    // Remove everything except letters and numbers
    str = str.replace(/[^a-zA-Z0-9ąčęėįšųūžĄČĘĖĮŠŲŪŽ\s]/g, " ");

    // Collapse multiple spaces
    str = str.replace(/\s+/g, " ").trim();

    // Convert to camelCase
    return str
        .replace(/[_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
        .replace(/^(.)/, (_, c) => c.toLowerCase());
}

const execFileAsync = promisify(execFile);

export async function nuskaitytiCpvaProjektaiTiekejai() {
    const url =
        "https://2021.esinvesticijos.lt/dokumentai/cpva-adminstruojami-projektai-ir-tiekejai";
    log(`Nuskaitymas iš ${url}`);

    // 1. Load HTML via curl
    const { stdout: html } = await execFileAsync("curl", ["-k", "-fsSL", url]);

    const { document } = parseHTML(html);

    // 2. Find first .xlsx link
    const linkEl = document.querySelector('a[href$=".xlsx"]');
    if (!linkEl) {
        throw new Error("Nepavyko rasti .xlsx nuorodos puslapyje");
    }

    const fileUrl = linkEl.getAttribute("href");

    // handle relative URLs just in case
    const resolvedFileUrl = new URL(fileUrl, url).href;
    const filename = path.basename(new URL(resolvedFileUrl).pathname);

    const { stdout: fileBuffer } = await execFileAsync(
        "curl",
        ["-k", "-fsSL", resolvedFileUrl],
        {
            encoding: "buffer",
            maxBuffer: 1024 * 1024 * 50, // 50 MB
        },
    );

    log(`Fetched ${filename}, size: ${fileBuffer.length} bytes`);

    // Nuskaitome duomenis iš XLSX failo
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });

    let projektuSarasas = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        {
            defval: null,
            range: 1, // skip first row (0-based)
        },
    );

    let projektuPirkimuSutartys = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[1]],
        {
            defval: null,
            range: 1,
        },
    );

    projektuSarasas = cleanRows(projektuSarasas);
    projektuPirkimuSutartys = cleanRows(projektuPirkimuSutartys);

    const ignoreKeys = ["subtiekejoPavadinimasVardasIrPavardeGimimoData"];

    function isValidExcelDate(n) {
        return typeof n === "number" && n >= 0 && n < 60000;
    }

    function isDateString(str) {
        return /^\d{4}-\d{2}-\d{2}$/.test(str.trim());
    }

    function convertExcelDates(row) {
        if (row == 0 || row == "0") {
            return null;
        }
        for (const [key, value] of Object.entries(row)) {
            if (ignoreKeys.includes(key)) continue; // skip ignored keys

            if (/data/i.test(key)) {
                if (isValidExcelDate(value)) {
                    const date = new Date(
                        Math.round((value - 25569) * 86400 * 1000),
                    );
                    const yyyy = date.getUTCFullYear();
                    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
                    const dd = String(date.getUTCDate()).padStart(2, "0");
                    row[key] = `${yyyy}-${mm}-${dd}`;
                } else if (typeof value === "string" && isDateString(value)) {
                    row[key] = value.trim();
                }
            }
        }
        return row;
    }

    // Usage
    projektuSarasas = projektuSarasas.map(convertExcelDates);
    projektuPirkimuSutartys = projektuPirkimuSutartys.map(convertExcelDates);

    // console.log(projektuSarasas);
    // console.log(projektuPirkimuSutartys);
    await insertProjektuSarasas(projektuSarasas);
    await insertCpvaProjektuSutartys(projektuPirkimuSutartys);
}

async function insertProjektuSarasas(rows) {
    const sql = `
      INSERT INTO public."cpvaProjektuSarasas" (
          "projektoNr",
          "finansavimoSaltinis",
          "projektoVykdytojas",
          "projektoVykdytojoKodas",
          "projektoPavadinimas",
          "atsakingaMinisterija",
          "projektasSuPartneriais",
          "sutartiesData",
          "projektoVeikluPradziosData",
          "projektoVeikluPabaigosData",
          "egadpSubsidijos",
          "egadpPaskolos",
          "iperpfLesos",
          "ipesfLesos",
          "ipsaFLesos",
          "iptpfLesos",
          "bendrojoFinansavimo",
          "lrBiudzetoLesos",
          "lrvbEsFonduLesos",
          "nuosavoInasoLesos",
          "nuosavasInasasNetinkamam",
          "isViso"
      ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      ON CONFLICT ("projektoNr") DO UPDATE SET
          "finansavimoSaltinis" = EXCLUDED."finansavimoSaltinis",
          "projektoVykdytojas" = EXCLUDED."projektoVykdytojas",
          "projektoVykdytojoKodas" = EXCLUDED."projektoVykdytojoKodas",
          "projektoPavadinimas" = EXCLUDED."projektoPavadinimas",
          "atsakingaMinisterija" = EXCLUDED."atsakingaMinisterija",
          "projektasSuPartneriais" = EXCLUDED."projektasSuPartneriais",
          "sutartiesData" = EXCLUDED."sutartiesData",
          "projektoVeikluPradziosData" = EXCLUDED."projektoVeikluPradziosData",
          "projektoVeikluPabaigosData" = EXCLUDED."projektoVeikluPabaigosData",
          "egadpSubsidijos" = EXCLUDED."egadpSubsidijos",
          "egadpPaskolos" = EXCLUDED."egadpPaskolos",
          "iperpfLesos" = EXCLUDED."iperpfLesos",
          "ipesfLesos" = EXCLUDED."ipesfLesos",
          "ipsaFLesos" = EXCLUDED."ipsaFLesos",
          "iptpfLesos" = EXCLUDED."iptpfLesos",
          "bendrojoFinansavimo" = EXCLUDED."bendrojoFinansavimo",
          "lrBiudzetoLesos" = EXCLUDED."lrBiudzetoLesos",
          "lrvbEsFonduLesos" = EXCLUDED."lrvbEsFonduLesos",
          "nuosavoInasoLesos" = EXCLUDED."nuosavoInasoLesos",
          "nuosavasInasasNetinkamam" = EXCLUDED."nuosavasInasasNetinkamam",
          "isViso" = EXCLUDED."isViso"
  `;

    let count = 0;
    for (const row of rows) {
        // If projektoVeikluPabaigosData is not a date string, set to null
        if (
            row.projektoVeikluPabaigosData &&
            !/^\d{4}-\d{2}-\d{2}$/.test(row.projektoVeikluPabaigosData)
        ) {
            row.projektoVeikluPabaigosData = null;
        }

        const values = [
            row.projektoNr,
            row.finansavimoSaltinis,
            row.projektoVykdytojas,
            row.projektoVykdytojoJuridinioAsmensKodas, // map to projektoVykdytojoKodas
            row.projektoPavadinimas,
            row.atsakingaMinisterija,
            row.projektasSuPartneriais,
            row.sutartiesData,
            row.projektoVeikluPradziosData,
            row.projektoVeikluPabaigosData,
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPSubsidijosLesos,
            ),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPPaskolosLesos,
            ),
            Number(row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPERPFLesos),
            Number(row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPESFLesos),
            Number(row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPSaFLesos),
            Number(row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPTPFLesos),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaBendrojoFinansavimoLesos,
            ),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRValstybesBiudzetoLesos,
            ),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRVBLesosSkirtosESFonduLesomisNetinkamamFinasnsuotiPVMApmoketi,
            ),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavoInasoLesos,
            ),
            Number(
                row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavasInasasTenkantisLRVBNetinkamamPVMApmoketi,
            ),
            Number(row.didziausiaGalimaTinkamuFinansuotiIslaiduSumaIsViso),
        ];

        try {
            await postgres.query(sql, values);
        } catch (err) {
            log(
                `Klaida įterpiant projekto nr ${row.projektoNr}: ${err.message}`,
            );
        }
        count++;
        // Log every 100
        if (count % 100 === 0) {
            // log(`Inserted/Updated ${count} of ${rows.length}`);
        }
    }
}

async function insertCpvaProjektuSutartys(rows) {
    const sql = `
        INSERT INTO public."cpvaProjektuSutartys" (
            "projektoNr",
            "projektoPavadinimas",
            "arProjektasFinansuojamasEGADPLesoms",
            "pirkimoNrCvpis",
            "pirkimaVykdantisSubjektas",
            "pirkimoObjektas",
            "pirkimoSutartiesNr",
            "pirkimoSutartiesData",
            "pirkimoSutartiesSumaSusijusiSuProjektu",
            "tiekejoPavadinimasVardasIrPavardeGimimoData",
            "tiekejoKodas",
            "subtiekejoPavadinimasVardasIrPavardeGimimoData",
            "subtiekejoKodas"
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        ON CONFLICT ("projektoNr","pirkimoSutartiesNr") DO UPDATE SET
            "projektoPavadinimas" = EXCLUDED."projektoPavadinimas",
            "arProjektasFinansuojamasEGADPLesoms" = EXCLUDED."arProjektasFinansuojamasEGADPLesoms",
            "pirkimoNrCvpis" = EXCLUDED."pirkimoNrCvpis",
            "pirkimaVykdantisSubjektas" = EXCLUDED."pirkimaVykdantisSubjektas",
            "pirkimoObjektas" = EXCLUDED."pirkimoObjektas",
            "pirkimoSutartiesData" = EXCLUDED."pirkimoSutartiesData",
            "pirkimoSutartiesSumaSusijusiSuProjektu" = EXCLUDED."pirkimoSutartiesSumaSusijusiSuProjektu",
            "tiekejoPavadinimasVardasIrPavardeGimimoData" = EXCLUDED."tiekejoPavadinimasVardasIrPavardeGimimoData",
            "tiekejoKodas" = EXCLUDED."tiekejoKodas",
            "subtiekejoPavadinimasVardasIrPavardeGimimoData" = EXCLUDED."subtiekejoPavadinimasVardasIrPavardeGimimoData",
            "subtiekejoKodas" = EXCLUDED."subtiekejoKodas"
    `;

    let count = 0;
    for (const row of rows) {
        const values = [
            row.projektoNr,
            row.projektoPavadinimas,
            row.arProjektasFinansuojamasEGADPLesoms,
            row.pirkimoNrCVPIS,
            row.pirkimaVykdantisSubjektas,
            row.pirkimoObjektas,
            row.pirkimoSutartiesNr,
            row.pirkimoSutartiesData,
            Number(row.pirkimoSutartiesSumaSusijusiSuProjektu),
            row.tiekejoPavadinimasVardasIrPavardeGimimoData,
            row.tiekejoKodas,
            row.subtiekejoPavadinimasVardasIrPavardeGimimoData,
            row.subtiekejoKodas,
        ];

        try {
            await postgres.query(sql, values);
        } catch (err) {
            log(
                `Klaida įterpiant projektoNr ${row.projektoNr}, sutartiesNr ${row.pirkimoSutartiesNr}: ${err.message}`,
            );
        }
        count++;
        if (count % 100 === 0) {
            // log(`Inserted/Updated ${count} of ${rows.length}`);
        }
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        await nuskaitytiCpvaProjektaiTiekejai();
        log("Importavimas baigtas");
    } catch (err) {
        console.error("Klaida importuojant:", err);
    } finally {
        postgres.end();
    }
}

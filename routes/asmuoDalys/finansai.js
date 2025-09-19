import { postgres } from "../../postgres/postgres.js";

export async function gautiFinansuDuomenis(jarId) {
    let finansai = {};

    if (jarId) {
        const balansoRes = await postgres.query(
            `SELECT *
               FROM "balansoAtaskaitos"
               WHERE "jarId" = $1
               ORDER BY "laikotarpisNuo" DESC, "lineTypeId" ASC`,
            [jarId],
        );

        if (balansoRes.rows && balansoRes.rows.length > 0) {
            finansai.balansai = balansoRes.rows;
        }

        const pelnoNuostoliuRes = await postgres.query(
            `SELECT *
               FROM "pelnoNuostoliuAtaskaitos"
               WHERE "jarId" = $1
               ORDER BY "laikotarpisNuo" DESC, "lineTypeId" ASC`,
            [jarId],
        );

        if (pelnoNuostoliuRes.rows && pelnoNuostoliuRes.rows.length > 0) {
            finansai.pelnasNuostoliai = pelnoNuostoliuRes.rows;
        }

        const sentenceCase = (text) =>
            text
                .replace(/([^.!?]*[.!?]*)/g, (sentence) =>
                    sentence.trim()
                        ? sentence.trim().charAt(0).toUpperCase() +
                          sentence.trim().slice(1).toLowerCase() +
                          " "
                        : "",
                )
                .trim();

        const grouped = {};

        // iterate both types
        for (const type of ["balansai", "pelnasNuostoliai"]) {
            for (const entry of finansai?.[type] || []) {
                // key by period + submission date + template
                const key = `${entry.laikotarpisNuo}_${entry.laikotarpisIki}_${entry.duomenuData}_${entry.templateId}`;

                // create or overwrite period object
                grouped[key] = grouped[key] || {
                    laikotarpisNuo: entry.laikotarpisNuo,
                    laikotarpisIki: entry.laikotarpisIki,
                    duomenuData: entry.duomenuData,
                    templateId: entry.templateId,
                    templateName: sentenceCase(entry.templateName),
                    standards: {},
                };

                // ensure standard object exists
                const standards = grouped[key].standards;
                standards[entry.standardId] = standards[entry.standardId] || {
                    standardId: entry.standardId,
                    standardName: sentenceCase(entry.standardName),
                    lines: [],
                };

                // push only relevant fields
                standards[entry.standardId].lines.push({
                    lineTypeId: entry.lineTypeId,
                    lineName: sentenceCase(entry.lineName),
                    reiksme: entry.reiksme,
                });
            }
        }

        finansai.ataskaitos = Object.values(grouped).map((period) => ({
            ...period,
            standards: Object.values(period.standards),
        }));

        finansai.pagalEilute = {};

        finansai.ataskaitos.forEach((report) => {
            const reportMeta = {
                laikotarpisNuo: report.laikotarpisNuo,
                laikotarpisIki: report.laikotarpisIki,
                duomenuData: report.duomenuData,
                templateId: report.templateId,
                templateName: report.templateName,
            };

            if (report.standards) {
                report.standards.forEach((standard) => {
                    if (standard.lines) {
                        standard.lines.forEach((line) => {
                            if (!finansai.pagalEilute[line.lineName]) {
                                finansai.pagalEilute[line.lineName] = [];
                            }
                            // Merge line with report metadata
                            finansai.pagalEilute[line.lineName].push({
                                ...line,
                                ...reportMeta,
                            });
                        });
                    }
                });
            }
        });

        // Step 1: Collect all years
        const allYearsSet = new Set();
        finansai.ataskaitos.forEach((report) => {
            const year = new Date(report.laikotarpisNuo).getFullYear();
            allYearsSet.add(year);
        });
        const metai = Array.from(allYearsSet).sort((a, b) => a - b);

        // Step 2: Build duomenys
        let duomenys = {};
        finansai.ataskaitos.forEach((report) => {
            const year = new Date(report.laikotarpisNuo).getFullYear();

            if (report.standards) {
                report.standards.forEach((standard) => {
                    if (standard.lines) {
                        standard.lines.forEach((line) => {
                            if (!duomenys[line.lineName]) {
                                // initialize array with undefined for all years
                                duomenys[line.lineName] = Array(
                                    metai.length,
                                ).fill(undefined);
                            }

                            const yearIndex = metai.indexOf(year);
                            if (yearIndex !== -1) {
                                duomenys[line.lineName][yearIndex] =
                                    line.reiksme;
                            }
                        });
                    }
                });
            }
        });

        // Apskaičiuojame pelningumą
        const pelnoRaktas =
            duomenys["Grynasis pelnas (nuostoliai)"] != null
                ? "Grynasis pelnas (nuostoliai)"
                : duomenys["Ataskaitinių metų pelnas (nuostoliai)"] != null
                  ? "Ataskaitinių metų pelnas (nuostoliai)"
                  : null;

        // Determine the length of the result (match Pardavimo pajamos length)
        const length = duomenys["Pardavimo pajamos"]?.length || 0;

        // Build Pelningumas safely
        duomenys["Pelningumas"] = Array.from({ length }, (_, i) => {
            if (!pelnoRaktas) return null; // no profit column

            const pelnas = duomenys[pelnoRaktas]?.[i];
            const pardavimai = duomenys["Pardavimo pajamos"]?.[i];

            if (
                typeof pelnas !== "number" ||
                typeof pardavimai !== "number" ||
                pardavimai === 0
            ) {
                return null;
            }

            return Number(((pelnas / pardavimai) * 100).toFixed(2));
        });

        // Step 3: Assign to finansai.lentele
        finansai.lentele = {
            metai,
            duomenys,
        };
    }

    return finansai;
}

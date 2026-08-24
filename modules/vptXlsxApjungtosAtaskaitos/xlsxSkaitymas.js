import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Katalogas, į kurį rankomis sudedamos VPT iškrovos (į git nepatenka). */
export const dataDir = path.join(moduleDir, "data");

/** Šaltinio failai ir jų ataskaitų šeima. */
export const failai = {
    "ATN1_XLSX.xlsx": "atn1",
    "ATN1_XLSX_CONTRACTED_CAND_LIST.xlsx": "atn1",
    "ATN1_XLSX_CONTRACT_LIST.xlsx": "atn1",
    "ATN1_XLSX_END_OF_PROC.xlsx": "atn1",
    "ATN1_XLSX_PURCHASE.xlsx": "atn1",
    "ATN1_XLSX_REJECTED_CAND_LIST.xlsx": "atn1",
    "GPPA.xlsx": "gppa",
    "Koncesijos.xlsx": "concession",
    "Projekto konkursai.xlsx": "design_contest",
};

/** Pirmo stulpelio reikšmė – ataskaitos įrašo numeris VPT sistemoje. */
export const SALTINIO_ID = Symbol("saltinioId");

/** @param {unknown} value */
function reiksme(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
}

/**
 * Eilutę paverčia objektu su originaliomis XLSX antraštėmis.
 *
 * @param {unknown[]} antrastes
 * @param {unknown[]} reiksmes
 */
function eilutesObjektas(antrastes, reiksmes) {
    const eilute = {};
    for (let index = 0; index < antrastes.length; index += 1) {
        const antraste = String(antrastes[index] ?? "").trim();
        if (!antraste || reiksmes[index] === null || reiksmes[index] === undefined) continue;
        eilute[antraste] = reiksme(reiksmes[index]);
    }
    const pirmas = reiksmes[0];
    eilute[SALTINIO_ID] = Number.isSafeInteger(pirmas) && pirmas > 0 ? pirmas : null;
    return eilute;
}

/**
 * Perskaito workbook'ą iš `data/` katalogo.
 *
 * @param {string} failoVardas
 * @returns {Promise<Map<string, Record<string, unknown>[]>>} lapo vardas → eilutės
 */
export async function skaitytiWorkbooka(failoVardas) {
    const buffer = await readFile(path.join(dataDir, failoVardas));
    const workbook = XLSX.read(buffer, { cellDates: true, dense: true });
    const lapai = new Map();

    for (const lapoVardas of workbook.SheetNames) {
        const eilutes = XLSX.utils.sheet_to_json(workbook.Sheets[lapoVardas], {
            header: 1,
            raw: true,
            defval: null,
            blankrows: false,
        });
        const antrastes = eilutes[0] ?? [];
        lapai.set(
            lapoVardas.trim(),
            eilutes.slice(1)
                .map((reiksmes) => eilutesObjektas(antrastes, reiksmes))
                .filter((eilute) => Object.keys(eilute).length > 0),
        );
    }

    return lapai;
}

/**
 * Konkretaus lapo eilutės; nesant lapo grąžinamas tuščias sąrašas.
 *
 * @param {Map<string, Record<string, unknown>[]>} lapai
 * @param {string} lapoVardas
 */
export function lapas(lapai, lapoVardas) {
    return lapai.get(lapoVardas.trim()) ?? [];
}

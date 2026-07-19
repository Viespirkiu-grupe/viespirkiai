/*
Importuoja sutarčių duomenis į Postgres.
*/

import { postgres } from "../../postgres/postgres.js";
import Timings from "../../utils/timings.js";
import { prepareCanonicalSutartis } from "./canonicalSutartis.js";
import { upsertVpmSutartis } from "./upsertVpmSutartis.js";

export function parseDateOnly(value, field = "date", contractId = "unknown") {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(
            `Invalid ${field} for contract ${contractId}: ${JSON.stringify(value)}`,
        );
    }
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error(
            `Invalid ${field} for contract ${contractId}: ${JSON.stringify(value)}`,
        );
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseNullableNumber(value, field, contractId) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
        if (Number.isFinite(value)) return value;
    } else if (typeof value === "string") {
        const normalized = value
            .trim()
            .replace(/[\s\u00a0\u202f]+eur$/iu, "")
            .replace(/[\s\u00a0\u202f]+/gu, "")
            .replace(/,/g, ".");
        const parsed = normalized === "" ? NaN : Number(normalized);
        if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(
        `Invalid ${field} for contract ${contractId ?? "unknown"}: ${JSON.stringify(value)}`,
    );
}

/**
 * Importuoja sutarčių duomenis į Postgres.
 * @param {Array} data - Duomenų masyvas, kuriame yra sutarčių informacija.
 * @returns {Promise<void>}
 */
export async function cvpIsImportArray(data, options = {}) {
    let timings = options.timings || new Timings();
    timings.start("importDataCleanup");

    // Aptvarkome duomenų tipus
    let items = [];
    const brokuotiIds = new Set();
    for (let i = 0; i < data.length; i++) {
        let item = data[i];
        const rawId = item.sutartiesUnikalusID;

        // Brokuoti laukai (pvz., "0000-00-00", "0022-10-12", "3.13.00")
        // nustatomi į null, kad sutartis vis tiek būtų importuota; ID
        // fiksuojamas vpmSutartysBrokas auditui.
        const markBrokas = (error) => {
            const id = Number(rawId);
            if (Number.isSafeInteger(id) && id > 0) brokuotiIds.add(id);
            console.warn(error);
        };

        // Skaičiai
        for (const field of ["verte", "faktineIvykdimoVerte"]) {
            try {
                item[field] = parseNullableNumber(item[field], field, rawId);
            } catch (error) {
                markBrokas(error);
                item[field] = null;
            }
        }

        // Datos
        const dateOnlyFields = [
            "sudarymoData",
            "galiojimoData",
            "faktineIvykdimoData",
        ];
        for (const field of dateOnlyFields) {
            try {
                item[field] = parseDateOnly(item[field], field, rawId);
            } catch (error) {
                markBrokas(error);
                item[field] = null;
            }
        }

        const timestampFields = [
            "paskelbimoData",
            "paskutinioAtnaujinimoData",
            "paskutinioRedagavimoData",
        ];
        for (const field of timestampFields) {
            if (item[field]) {
                const d = new Date(item[field]);
                item[field] = isNaN(d) ? null : d;
            }
        }

        // ID
        item.sutartiesUnikalusID = item.sutartiesUnikalusID
            ? parseInt(item.sutartiesUnikalusID, 10)
            : null;

        // Praleidžiame be unikalaus ID (nors tokių neturėtų būti)
        if (!item.sutartiesUnikalusID) continue;

        items.push(item);
    }

    // If there are items with duplicate sutartiesUnikalusID, keep the last
    const uniqueItemsMap = new Map();
    for (const item of items) {
        uniqueItemsMap.set(item.sutartiesUnikalusID, item);
    }
    items = Array.from(uniqueItemsMap.values());
    timings.end("importDataCleanup");

    if (brokuotiIds.size > 0) {
        timings.start("importPostgresBrokasUpsert");
        const ids = Array.from(brokuotiIds);
        await postgres.query(
            `INSERT INTO public."vpmSutartysBrokas" ("unikalusId")
             VALUES ${ids.map((_, i) => `($${i + 1})`).join(",")}
             ON CONFLICT ("unikalusId") DO UPDATE SET
               "timestamp" = timezone('Europe/Vilnius', now());`,
            ids,
        );
        timings.end("importPostgresBrokasUpsert");
    }

    if (items.length > 0) {
        // Į lentelę failai
        const newFailai = [];
        const canonicalSutartys = [];

        // Paruošiame duomenis įterpimui
        items.forEach((item) => {
            const faktineIvykdimoVerte =
                typeof item.faktineIvykdimoVerte === "string" &&
                    item.faktineIvykdimoVerte !== ""
                    ? parseFloat(item.faktineIvykdimoVerte.replace(/,/g, "."))
                    : typeof item.faktineIvykdimoVerte === "number"
                        ? item.faktineIvykdimoVerte
                        : null;

            const pirkimoNumeris =
                item.pirkimoNumeris?.replace(/\x00/g, "").trim() || null;

            const canonical = prepareCanonicalSutartis({
                ...item,
                pirkimoNumeris,
                faktineIvykdimoVerte,
            });
            canonicalSutartys.push(canonical);

            if (!item.dokumentai || !Array.isArray(item.dokumentai)) return;

            item.dokumentai.forEach((d) => {
                const fileIdMatch = (d.url || "").match(/file_id=(\d+)/);
                if (!fileIdMatch) return;
                const fileId = parseInt(fileIdMatch[1], 10);
                const dokId = item.sutartiesUnikalusID;
                newFailai.push({
                    dokId,
                    fileId,
                    pavadinimas: d.pavadinimas || null,
                    extension: d.pavadinimas ? d.pavadinimas.split(".").pop() : null,
                    saltinis: "sutartys",
                });
            });
        });


        timings.start("importPostgresFailaiUpsert");
        if (newFailai.length > 0) {
            const existsResult = await postgres.query(
                `SELECT "dokId", "fileId" FROM failai
         WHERE ("dokId", "fileId") IN (${newFailai.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
           AND "dokId" IS NOT NULL AND "fileId" IS NOT NULL`,
                newFailai.flatMap(r => [r.dokId, r.fileId])
            );

            const existingSet = new Set(existsResult.rows.map(r => `${r.dokId}:${r.fileId}`));

            const toInsert = newFailai.filter(r => !existingSet.has(`${r.dokId}:${r.fileId}`));

            if (toInsert.length > 0) {
                const placeholders = toInsert.map((_, i) =>
                    `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
                );
                await postgres.query(
                    `INSERT INTO failai ("dokId", "fileId", "pavadinimas", "extension", "saltinis")
             VALUES ${placeholders.join(', ')}
             ON CONFLICT ("dokId", "fileId") WHERE ("dokId" IS NOT NULL AND "fileId" IS NOT NULL) DO NOTHING`,
                    toInsert.flatMap(r => [r.dokId, r.fileId, r.pavadinimas, r.extension, r.saltinis])
                );
            }
        }
        timings.end("importPostgresFailaiUpsert");

        // Užtikriname, kad visos matytos sudarymo datos būtų
        // vpmSutartysSudarymoDatos lentelėje (dienų scrapinimo sekimui).
        // Daroma PRIEŠ vpm upsert'us: procesui nulūžus tarp šių žingsnių
        // liktų nebent perteklinė data (nekenksminga), o ne sutartis be
        // užregistruotos dienos, kuri niekada nebūtų perscrapinta.
        timings.start("importSudarymoDatosUpsert");
        const sudarymoDatos = [
            ...new Set(
                canonicalSutartys
                    .map((c) => c.sutartis.sudarymoData)
                    .filter(Boolean),
            ),
        ];
        if (sudarymoDatos.length > 0) {
            await postgres.query(
                `INSERT INTO public."vpmSutartysSudarymoDatos" ("sudarymoData")
                 VALUES ${sudarymoDatos.map((_, i) => `($${i + 1})`).join(",")}
                 ON CONFLICT ("sudarymoData") DO NOTHING;`,
                sudarymoDatos,
            );
        }
        timings.end("importSudarymoDatosUpsert");

        timings.start("importVpmSutartysUpsert");
        for (const canonical of canonicalSutartys) {
            await upsertVpmSutartis(canonical);
        }
        timings.end("importVpmSutartysUpsert");
    }

    return { timings };
}

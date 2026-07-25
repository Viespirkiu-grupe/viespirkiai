/*
Importuoja sutarčių duomenis į Postgres.
*/

import { postgres } from "../../postgres/postgres.js";
import Timings from "../../utils/timings.js";
import { irasytiFailus } from "../failai/failuIrasymas.js";
import { upsertVpmSutartis } from "./upsertVpmSutartis.js";
import {
    normalizeScrapedSutartis,
    prepareNormalizedScrapedCanonical,
} from "./prepareScrapedCanonical.js";

export { parseDateOnly, parseNullableNumber } from "./prepareScrapedCanonical.js";

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
        const rawId = data[i].sutartiesUnikalusID;

        // Brokuoti laukai (pvz., "0000-00-00", "0022-10-12", "3.13.00")
        // nustatomi į null, kad sutartis vis tiek būtų importuota; ID
        // fiksuojamas vpmSutartysBrokas auditui.
        const markBrokas = (error) => {
            const id = Number(rawId);
            if (Number.isSafeInteger(id) && id > 0) brokuotiIds.add(id);
            console.warn(error);
        };
        const item = normalizeScrapedSutartis(data[i], { onInvalid: markBrokas });

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
            const canonical = prepareNormalizedScrapedCanonical(item);
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


        // Dublikatus atmeta files unikalūs indeksai (žr. failuIrasymas.js).
        timings.start("importPostgresFailaiUpsert");
        await irasytiFailus(newFailai);
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

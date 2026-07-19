/*
Importuoja sutarčių duomenis į Postgres.
*/

import { postgres } from "../../postgres/postgres.js";
import Timings from "../../utils/timings.js";
import { prepareCanonicalSutartis } from "./canonicalSutartis.js";
import { upsertVpmSutartis } from "./upsertVpmSutartis.js";

/**
 * Konvertuoja datą į Postgres timestamp formatą.
 * @param {Date|string|null} date - Data, kurią reikia konvertuoti.
 * @returns {string|null}
 */
function toPostgresTimestamp(date) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d)) return null;
    return (
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
    );
}

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
        // Į lentelę sutartys
        const values = [];
        const placeholders = [];

        // Į lentelę failai
        const newFailai = [];
        const canonicalSutartys = [];

        // Paruošiame duomenis įterpimui
        items.forEach((item, i) => {
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

            const baseIndex = i * 26;
            placeholders.push(
                `(${Array.from({ length: 26 }, (_, j) => `$${baseIndex + j + 1}`).join(",")})`,
            );

            values.push(
                item.sutartiesUnikalusID,
                pirkimoNumeris,
                item.pavadinimas,
                item.bvpzKodas,
                item.bvpzPavadinimas,
                JSON.stringify(item.dokumentai || []),
                item.dokumentuKiekis,
                item.faktineIvykdimoData,
                faktineIvykdimoVerte,
                item.galiojimoData,
                item.kategorija,
                toPostgresTimestamp(item.paskelbimoData),
                toPostgresTimestamp(item.paskutinioAtnaujinimoData),
                toPostgresTimestamp(item.paskutinioRedagavimoData),
                item.perkanciojiOrganizacija,
                item.perkanciosiosOrganizacijosKodas,
                item.sudarymoData,
                item.sutartiesNumeris,
                item.tiekejas,
                item.tiekejoKodas,
                item.tipas,
                item.verte,
                item.papildomiTiekejai,
                item.papildomiTiekejaiKodai,
                item.papildomiBvpzKodai,
                item.papildomiBvpzPavadinimai,
            );

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

        // Įterpiame (UPSERT) duomenis
        timings.start("importPostgresUpsert");
        await postgres.query(
            `INSERT INTO "sutartys" (
              "sutartiesUnikalusId",
              "pirkimoNumeris",
              "pavadinimas",
              "bvpzKodas",
              "bvpzPavadinimas",
              "dokumentai",
              "dokumentuKiekis",
              "faktineIvykdimoData",
              "faktineIvykdimoVerte",
              "galiojimoData",
              "kategorija",
              "paskelbimoData",
              "paskutinioAtnaujinimoData",
              "paskutinioRedagavimoData",
              "perkanciojiOrganizacija",
              "perkanciosiosOrganizacijosKodas",
              "sudarymoData",
              "sutartiesNumeris",
              "tiekejas",
              "tiekejoKodas",
              "tipas",
              "verte",
              "papildomiTiekejai",
              "papildomiTiekejaiKodai",
              "papildomiBvpzKodai",
              "papildomiBvpzPavadinimai"
            ) VALUES ${placeholders.join(",")}
            ON CONFLICT ("sutartiesUnikalusId") DO UPDATE SET
              "pirkimoNumeris" = EXCLUDED."pirkimoNumeris",
              "pavadinimas" = EXCLUDED."pavadinimas",
              "bvpzKodas" = EXCLUDED."bvpzKodas",
              "bvpzPavadinimas" = EXCLUDED."bvpzPavadinimas",
              "dokumentai" = EXCLUDED."dokumentai",
              "dokumentuKiekis" = EXCLUDED."dokumentuKiekis",
              "faktineIvykdimoData" = EXCLUDED."faktineIvykdimoData",
              "faktineIvykdimoVerte" = EXCLUDED."faktineIvykdimoVerte",
              "galiojimoData" = EXCLUDED."galiojimoData",
              "kategorija" = EXCLUDED."kategorija",
              "paskelbimoData" = EXCLUDED."paskelbimoData",
              "paskutinioAtnaujinimoData" = EXCLUDED."paskutinioAtnaujinimoData",
              "paskutinioRedagavimoData" = EXCLUDED."paskutinioRedagavimoData",
              "perkanciojiOrganizacija" = EXCLUDED."perkanciojiOrganizacija",
              "perkanciosiosOrganizacijosKodas" = EXCLUDED."perkanciosiosOrganizacijosKodas",
              "sudarymoData" = EXCLUDED."sudarymoData",
              "sutartiesNumeris" = EXCLUDED."sutartiesNumeris",
              "tiekejas" = EXCLUDED."tiekejas",
              "tiekejoKodas" = EXCLUDED."tiekejoKodas",
              "tipas" = EXCLUDED."tipas",
              "verte" = EXCLUDED."verte",
              "papildomiTiekejai" = EXCLUDED."papildomiTiekejai",
              "papildomiTiekejaiKodai" = EXCLUDED."papildomiTiekejaiKodai",
              "papildomiBvpzKodai" = EXCLUDED."papildomiBvpzKodai",
              "papildomiBvpzPavadinimai" = EXCLUDED."papildomiBvpzPavadinimai"
            WHERE "sutartys"."pirkimoNumeris" IS DISTINCT FROM EXCLUDED."pirkimoNumeris"
               OR "sutartys"."pavadinimas" IS DISTINCT FROM EXCLUDED."pavadinimas"
               OR "sutartys"."bvpzKodas" IS DISTINCT FROM EXCLUDED."bvpzKodas"
               OR "sutartys"."bvpzPavadinimas" IS DISTINCT FROM EXCLUDED."bvpzPavadinimas"
               OR "sutartys"."dokumentai" IS DISTINCT FROM EXCLUDED."dokumentai"
               OR "sutartys"."dokumentuKiekis" IS DISTINCT FROM EXCLUDED."dokumentuKiekis"
               OR "sutartys"."faktineIvykdimoData" IS DISTINCT FROM EXCLUDED."faktineIvykdimoData"
               OR "sutartys"."faktineIvykdimoVerte" IS DISTINCT FROM EXCLUDED."faktineIvykdimoVerte"
               OR "sutartys"."galiojimoData" IS DISTINCT FROM EXCLUDED."galiojimoData"
               OR "sutartys"."kategorija" IS DISTINCT FROM EXCLUDED."kategorija"
               OR "sutartys"."paskelbimoData" IS DISTINCT FROM EXCLUDED."paskelbimoData"
               OR "sutartys"."paskutinioAtnaujinimoData" IS DISTINCT FROM EXCLUDED."paskutinioAtnaujinimoData"
               OR "sutartys"."paskutinioRedagavimoData" IS DISTINCT FROM EXCLUDED."paskutinioRedagavimoData"
               OR "sutartys"."perkanciojiOrganizacija" IS DISTINCT FROM EXCLUDED."perkanciojiOrganizacija"
               OR "sutartys"."perkanciosiosOrganizacijosKodas" IS DISTINCT FROM EXCLUDED."perkanciosiosOrganizacijosKodas"
               OR "sutartys"."sudarymoData" IS DISTINCT FROM EXCLUDED."sudarymoData"
               OR "sutartys"."sutartiesNumeris" IS DISTINCT FROM EXCLUDED."sutartiesNumeris"
               OR "sutartys"."tiekejas" IS DISTINCT FROM EXCLUDED."tiekejas"
               OR "sutartys"."tiekejoKodas" IS DISTINCT FROM EXCLUDED."tiekejoKodas"
               OR "sutartys"."tipas" IS DISTINCT FROM EXCLUDED."tipas"
               OR "sutartys"."verte" IS DISTINCT FROM EXCLUDED."verte"
               OR "sutartys"."papildomiTiekejai" IS DISTINCT FROM EXCLUDED."papildomiTiekejai"
               OR "sutartys"."papildomiTiekejaiKodai" IS DISTINCT FROM EXCLUDED."papildomiTiekejaiKodai"
               OR "sutartys"."papildomiBvpzKodai" IS DISTINCT FROM EXCLUDED."papildomiBvpzKodai"
               OR "sutartys"."papildomiBvpzPavadinimai" IS DISTINCT FROM EXCLUDED."papildomiBvpzPavadinimai";`,
            values,
        );
        timings.end("importPostgresUpsert");

        // "paskutiniKartaMatyta" / "paskutiniKartaAtnaujinta" iškelti į plonąją
        // sutartysAtnaujinimai lentelę (1:1), kad dažni "matyta dabar" rašymai
        // nebebloatintų sutartys eilutės. Abu laukai gauna tą pačią reikšmę,
        // kaip darydavo ankstesnis bendras upsert.
        timings.start("importPostgresAtnaujinimaiUpsert");
        const atnaujinimaiValues = [];
        const atnaujinimaiPlaceholders = items.map((item, i) => {
            atnaujinimaiValues.push(
                item.sutartiesUnikalusID,
                item.paskutiniKartaMatyta,
                item.paskutiniKartaMatyta,
            );
            const base = i * 3;
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
        });
        await postgres.query(
            `INSERT INTO "sutartysAtnaujinimai" (
              "sutartiesUnikalusId",
              "paskutiniKartaMatyta",
              "paskutiniKartaAtnaujinta"
            ) VALUES ${atnaujinimaiPlaceholders.join(",")}
            ON CONFLICT ("sutartiesUnikalusId") DO UPDATE SET
              "paskutiniKartaMatyta" = EXCLUDED."paskutiniKartaMatyta",
              "paskutiniKartaAtnaujinta" = EXCLUDED."paskutiniKartaAtnaujinta";`,
            atnaujinimaiValues,
        );
        timings.end("importPostgresAtnaujinimaiUpsert");

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

        timings.start("importVpmSutartysUpsert");
        for (const canonical of canonicalSutartys) {
            await upsertVpmSutartis(canonical);
        }
        timings.end("importVpmSutartysUpsert");
    }

    return { timings };
}

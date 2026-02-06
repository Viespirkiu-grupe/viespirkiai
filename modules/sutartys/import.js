/*
Importuoja sutarčių duomenis į Postgres ir Typesense.
*/

import { addDocumentsToSearch } from "../../typesense/typesense.js";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

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

/**
 * Grąžina datą be laiko komponento.
 * @param {Date|null} d - Data, iš kurios reikia pašalinti laiką.
 * @returns {Date|null}
 */
function dateOnly(d) {
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Importuoja sutarčių duomenys į Postgres ir Typesense.
 * @param {Array} data - Duomenų masyvas, kuriame yra sutarčių informacija.
 * @returns {Promise<void>}
 */
export async function importArray(data) {
    let items = [];

    // Aptvarkome duomenų tipus
    for (let i = 0; i < data.length; i++) {
        let item = data[i];

        // Skaičiai
        item.verte =
            typeof item.verte === "string"
                ? parseFloat(item.verte.replace(/,/g, "."))
                : null;
        item.faktineIvykdimoVerte =
            typeof item.faktineIvykdimoVerte === "string" &&
            item.faktineIvykdimoVerte !== ""
                ? parseFloat(item.faktineIvykdimoVerte.replace(/,/g, "."))
                : null;

        // Datos
        const dateFields = [
            "sudarymoData",
            "galiojimoData",
            "faktineIvykdimoData",
            "paskelbimoData",
            "paskutinioAtnaujinimoData",
            "paskutinioRedagavimoData",
        ];
        for (const field of dateFields) {
            if (item[field]) {
                const d = new Date(item[field]);
                item[field] = isNaN(d) ? null : d; // Replace invalid dates with null
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

    if (items.length > 0) {
        // Įterpiame į Typesense
        let startTypesenseTime = Date.now();
        await addDocumentsToSearch(items);

        log(
            `Typesense addDocument užtruko ${Date.now() - startTypesenseTime}ms`,
        );

        // Įterpiame į Postgres
        let startPostgresTime = Date.now();

        // Į lentelę sutartys
        const values = [];
        const placeholders = [];

        // Į lentelę failai
        const failaiValues = [];
        const failaiPlaceholders = [];

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

            const baseIndex = i * 28;
            placeholders.push(
                `(${Array.from({ length: 28 }, (_, j) => `$${baseIndex + j + 1}`).join(",")})`,
            );

            values.push(
                item.sutartiesUnikalusID,
                pirkimoNumeris,
                item.pavadinimas,
                item.bvpzKodas,
                item.bvpzPavadinimas,
                JSON.stringify(item.dokumentai || []),
                item.dokumentuKiekis,
                toPostgresTimestamp(item.faktineIvykdimoData),
                faktineIvykdimoVerte,
                dateOnly(item.galiojimoData),
                item.kategorija,
                toPostgresTimestamp(item.paskelbimoData),
                toPostgresTimestamp(item.paskutinioAtnaujinimoData),
                toPostgresTimestamp(item.paskutinioRedagavimoData),
                item.perkanciojiOrganizacija,
                item.perkanciosiosOrganizacijosKodas,
                dateOnly(item.sudarymoData),
                item.sutartiesNumeris,
                item.tiekejas,
                item.tiekejoKodas,
                item.tipas,
                item.verte,
                item.papildomiTiekejai,
                item.papildomiTiekejaiKodai,
                item.papildomiBvpzKodai,
                item.papildomiBvpzPavadinimai,
                item.paskutiniKartaMatyta,
                item.paskutiniKartaMatyta,
            );

            if (!item.dokumentai || !Array.isArray(item.dokumentai)) return;

            item.dokumentai.forEach((d) => {
                const fileIdMatch = (d.url || "").match(/file_id=(\d+)/);
                if (!fileIdMatch) return;
                const fileId = parseInt(fileIdMatch[1], 10);

                const extension = d.pavadinimas
                    ? d.pavadinimas.split(".").pop()
                    : null;
                const dokId = item.sutartiesUnikalusID;
                const pavadinimas = d.pavadinimas || null;

                const baseIndex = failaiValues.length;
                failaiPlaceholders.push(
                    `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`,
                );
                failaiValues.push(
                    dokId,
                    fileId,
                    pavadinimas,
                    extension,
                    "sutartys",
                );
            });
        });

        // Įterpiame (UPSERT) duomenis
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
              "papildomiBvpzPavadinimai",
              "paskutiniKartaMatyta",
              "paskutiniKartaAtnaujinta"
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
              "papildomiBvpzPavadinimai" = EXCLUDED."papildomiBvpzPavadinimai",
              "paskutiniKartaMatyta" = EXCLUDED."paskutiniKartaMatyta",
              "paskutiniKartaAtnaujinta" = EXCLUDED."paskutiniKartaAtnaujinta";`,
            values,
        );

        if (failaiValues.length > 0) {
            await postgres.query(
                `INSERT INTO failai ("dokId", "fileId", "pavadinimas", "extension", "saltinis")
                 VALUES ${failaiPlaceholders.join(", ")}
                 ON CONFLICT ("dokId", "fileId") WHERE ("dokId" IS NOT NULL AND "fileId" IS NOT NULL) DO NOTHING;`,
                failaiValues,
            );
        }

        log(`Postgres užtruko ${Date.now() - startPostgresTime}ms`);
    }
}

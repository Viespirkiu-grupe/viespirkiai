import { viespirkiai } from "../mongo/mongoDb.js";
import { addDocumentToSearch } from "../typesense/typesense.js";
import { log } from "../utils/log.js";
import { postgres } from "../postgres/postgres.js";

/**
 * Importuoja sutarčių duomenys į MongoDB ir Typesense.
 * @param {Array} data - Duomenų masyvas, kuriame yra sutarčių informacija.
 * @returns {Promise<void>}
 */
export async function importArray(data) {
    // Paruošiame duomenis įrašymui į MongoDB ir Typesense
    let operations = [];
    let items = [];
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
                item[field] = isNaN(d) ? null : d; // replace invalid dates with null
            }
        }

        // ID
        item.sutartiesUnikalusID = item.sutartiesUnikalusID
            ? parseInt(item.sutartiesUnikalusID, 10)
            : null;

        // Praleidžiame be unikalaus ID (nors tokių neturėtų būti)
        if (!item.sutartiesUnikalusID) continue;

        // Įrašome operacijas
        operations.push({
            updateOne: {
                filter: { sutartiesUnikalusID: item.sutartiesUnikalusID },
                update: { $set: item },
                upsert: true,
            },
        });

        items.push(item);
    }

    if (operations.length > 0) {
        // Įterpiame į MongoDB
        let startTime = Date.now();
        await viespirkiai.bulkWrite(operations);
        log(`MondoDB bulkWrite užtruko ${Date.now() - startTime}ms`);

        // Įterpiame į Typesense
        let startTypesenseTime = Date.now();
        for (const item of items) {
            await addDocumentToSearch(item);
        }

        log(
            `Typesense addDocument užtruko ${Date.now() - startTypesenseTime}ms`,
        );

        // Įterpiame į Postgres
        let startPostgresTime = Date.now();
        for (const item of items) {
            // console.log(item);
            // Prepare numeric
            const faktineIvykdimoVerte =
                typeof item.faktineIvykdimoVerte === "string" &&
                item.faktineIvykdimoVerte !== ""
                    ? parseFloat(item.faktineIvykdimoVerte.replace(/,/g, "."))
                    : typeof item.faktineIvykdimoVerte === "number"
                      ? item.faktineIvykdimoVerte
                      : null;

            const pirkimoNumeris =
                item.pirkimoNumeris?.replace(/\x00/g, "").trim() || null;

            function toUTCDate(date) {
                if (!date) return null;

                const d = new Date(date);
                if (isNaN(d)) return null; // invalid input

                // Construct a UTC date equivalent to the original date/time
                return new Date(
                    Date.UTC(
                        d.getFullYear(),
                        d.getMonth(),
                        d.getDate(),
                        d.getHours(),
                        d.getMinutes(),
                        d.getSeconds(),
                        d.getMilliseconds(),
                    ),
                );
            }

            function dateOnly(d) {
                if (!d) return null;
                return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // local midnight
            }

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
              "verte"
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              $21,$22
            )
            ON CONFLICT ("sutartiesUnikalusId")
            DO UPDATE SET
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
              "verte" = EXCLUDED."verte"
            `,
                [
                    item.sutartiesUnikalusID,
                    pirkimoNumeris,
                    item.pavadinimas,
                    item.bvpzKodas,
                    item.bvpzPavadinimas,
                    JSON.stringify(item.dokumentai || []),
                    item.dokumentuKiekis,
                    toUTCDate(item.faktineIvykdimoData),
                    faktineIvykdimoVerte,
                    dateOnly(item.galiojimoData),
                    item.kategorija,
                    toUTCDate(item.paskelbimoData),
                    toUTCDate(item.paskutinioAtnaujinimoData),
                    toUTCDate(item.paskutinioRedagavimoData),
                    item.perkanciojiOrganizacija,
                    item.perkanciosiosOrganizacijosKodas,
                    dateOnly(item.sudarymoData),
                    item.sutartiesNumeris,
                    item.tiekejas,
                    item.tiekejoKodas,
                    item.tipas,
                    item.verte,
                ],
            );
        }

        log(`Postgres užtruko ${Date.now() - startPostgresTime}ms`);
    }
}

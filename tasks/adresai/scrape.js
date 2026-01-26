/*
Randa JAR adresų koordinates ir įrašo į adresai (MySQL) lentelę.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const SLEEP_MS = 1001;
const USER_AGENT = "Viespirkiai/1.0 (sveiki@viespirkiai.org)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Randa JAR įrašą be adreso koordinačių, užklausia Nominatim ir įrašo koordinates.
 * @returns {Promise<boolean>} Grąžina true, jei buvo apdorotas įrašas, false jei nebuvo įrašų.
 */
export async function atrastiJarAdresoKoordinates() {
    let reikiaLaukti = false;

    // Randame JAR įrašą, kuriam reikia adreso koordinačių
    const { rows } = await postgres.query(`
      SELECT "jarKodas", adresas
      FROM "jarCsv"
      WHERE "adresoId" IS NULL AND adresas IS NOT NULL
      LIMIT 1
    `);

    if (rows.length === 0) {
        log("Visų JAR adresų koordinatės jau rastos.");
        return false;
    }

    let { jarKodas, adresas } = rows[0];

    /// Patikriname ar adresas jau egzistuojantis
    const { rows: existingRows } = await postgres.query(
        `SELECT id, latitude, longitude
       FROM adresai
       WHERE adresas = $1
       LIMIT 1`,
        [adresas],
    );

    if (existingRows.length > 0) {
        var adresoId = existingRows[0].id;
        var lat = existingRows[0].latitude;
        var lon = existingRows[0].longitude;
    } else {
        // Suformuojame užklausą į Nominatim
        log(`Užklausiama dėl: ${adresas}`);
        const normalizedAddress = await supaprastintasAdresas(adresas);
        log(`Suprastintas adresas: ${normalizedAddress}`);

        const url = new URL(NOMINATIM_URL);
        url.searchParams.set("q", normalizedAddress);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "1");

        try {
            // Atliekame užklausą
            reikiaLaukti = true;
            const res = await fetch(url, {
                headers: { "User-Agent": USER_AGENT },
            });
            const data = await res.json();

            if (!data.length) {
                console.warn(`No geocode result for: ${adresas}`);
                var adresoId = -1; // Adresas nerastas
            } else {
                // Įterpiame rastą adresą į duomenų bazę
                var { lat, lon } = data[0];
                log(`Adresas rastas: lat=${lat}, lon=${lon}`);

                const insertRes = await postgres.query(
                    `INSERT INTO adresai (latitude, longitude, adresas)
                   VALUES ($1, $2, $3)
                   RETURNING id`,
                    [parseFloat(lat), parseFloat(lon), adresas],
                );

                var adresoId = insertRes.rows[0].id;
            }
        } catch (e) {
            console.error(`Klaida vykdant užklausą ${adresas}:`, e);

            throw e;
        }
    }

    // Atnaujiname JAR įrašą su adresu
    await postgres.query(
        `
      UPDATE "jarCsv"
      SET
        "adresoId" = $1,
        location = ST_SetSRID(ST_MakePoint($2, $3), 4326)
      WHERE "jarKodas" = $4
      `,
        [adresoId, lon, lat, jarKodas],
    );

    log(`Atnaujintas jar ${jarKodas} → adresoId=${adresoId}`);
    if (reikiaLaukti) {
        await sleep(SLEEP_MS);
    }

    return true;
}

/**
 * Supaprastina adresą, pakeičia linksnį.
 * @param {string} raw - Originalus adresas
 * @returns {Promise<string>} Supaprastintas adresas
 */
async function supaprastintasAdresas(raw) {
    // Kaimų ir viensėdžių pavadinimai turi būt konvertuojami į vardininko linksnį
    for (const prefix of ["k.", "vs."]) {
        const match = raw.match(
            new RegExp(`([\\p{L}\\s.'\\-]+?)\\s*${prefix}`, "iu"),
        );

        if (match) {
            // Randame tinkamą linksnį
            let place = match[1].trim();
            const { rows: foundRows } = await postgres.query(
                `SELECT "pavadinimas" FROM "gyvenamosVietoves" WHERE "pavadinimasK" = $1 LIMIT 1`,
                [place],
            );

            // Pakeičiame
            if (foundRows.length > 0 && foundRows[0].pavadinimas) {
                raw = raw.replace(place, foundRows[0].pavadinimas);
            }
        }
    }

    raw = raw.replace(/\bk\.\s*/gi, ""); // Panaikiname k.
    raw = raw.replace(/\bvs\.\s*/gi, ""); // Panaikiname vs.
    raw = raw.replace(/\bglž\.\s*/gi, ""); // Panaikiname glž. st.

    // Panaikiname LT- pašto kodo prefiksą
    const postcodeMatch = raw.match(/LT-(\d{5})/i);
    const postcode = postcodeMatch ? postcodeMatch[1] : "";

    // Išimtis – Maigės -> P. Cvirkos
    raw = raw.replace(/\bMaigės\b/gi, "P. Cvirkos");

    // Randame adreso numerį
    const streetNumberMatch = raw.match(
        /([\p{L}\s.'\-]+?\d+[A-Za-z]?(-\d+[A-Za-z]?)?)/iu,
    );

    const streetNumber = (
        streetNumberMatch ? streetNumberMatch[1].trim() : ""
    ).replace(/-\d+[A-Za-z]?$/, "");

    // Suformuojame galutinį adresą
    let addr = "";

    if (streetNumber) addr += streetNumber;
    if (postcode) addr += (addr ? ", " : "") + postcode;

    addr += (addr ? ", " : "") + "Lithuania";

    return addr;
}

// If ran directly
if (import.meta.url.endsWith(process.argv[1])) {
    (async () => {
        try {
            while (await atrastiJarAdresoKoordinates()) {
                // Kartojame, kol yra įrašų
            }
            process.exit(0);
        } catch (e) {
            console.error("Klaida:", e);
            process.exit(1);
        }
    })();
}

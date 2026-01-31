import { postgres } from "../../postgres/postgres.js";

/**
 * Supaprastina adresą, pakeičia linksnį į naudojamą OpenStreetMap
 * @param {string} raw - Originalus adresas
 * @returns {Promise<string>} Supaprastintas adresas
 */
export async function supaprastintiLtAdresa(raw) {
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

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Viespirkiai (viespirkiai@viespirkiai.org)";
/**
 * Get coordinates for a simplified address using Nominatim with caching.
 *
 * Checks the "nominatimCache" table first. If a cached result exists, it returns
 * it immediately. If not, queries the Nominatim API, stores the result in the cache,
 * and indicates whether it was a cache hit or a fresh lookup.
 *
 * @param {string} address - The simplified address to geocode.
 * @async
 * @returns {Promise<{ location: [number, number], hit: boolean } | undefined>}
 * Returns an object with:
 * - `location`: [latitude, longitude] coordinates of the address.
 * - `hit`: `true` if the result came from cache, `false` if it was freshly fetched.
 * Returns `undefined` if the address could not be geocoded.
 */
export async function getAddressCoords(address) {
    // Check cache first
    const { rows } = await postgres.query(
        `SELECT ST_X(point::geometry) AS lon, ST_Y(point::geometry) AS lat, exists
       FROM "nominatimCache"
       WHERE address = $1
       LIMIT 1`,
        [address],
    );

    if (rows.length) {
        const row = rows[0];

        if (!row.exists || row.lon === null || row.lat === null)
            return undefined;

        return {
            location: [row.lat, row.lon], // [latitude, longitude]
            hit: true,
        };
    }

    try {
        const url = new URL(NOMINATIM_URL);
        url.searchParams.set("q", address);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "1");

        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        const data = await res.json();

        if (!data.length) {
            // Cache failed lookup
            await postgres.query(
                `INSERT INTO "nominatimCache" (address, exists) VALUES ($1, false)`,
                [address],
            );
            return undefined;
        }

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);

        // Cache successful lookup
        await postgres.query(
            `INSERT INTO "nominatimCache" (address, point, exists)
             VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), true)`,
            [address, lon, lat],
        );

        return {
            location: [lat, lon],
            hit: false,
        };
    } catch (e) {
        console.error("Nominatim request failed:", e);
        return undefined;
    }
}

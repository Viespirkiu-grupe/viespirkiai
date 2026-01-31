import {
    supaprastintiLtAdresa,
    getAddressCoords,
} from "../geografija/adresai.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const DELAY_WITHOUT_CACHE_HIT = 1001; //ms
/**
 * Finds a jarCsv entry without coordinates, queries Nominatim, and updates the database.
 * Uses `locationState`:
 *   1 = success,
 *   0/null = needs lookup,
 *  -404 = not found.
 *
 * @returns {Promise<boolean>} True if a record was processed, false if none needed.
 */
export async function geolocateJarCsv() {
    // Find one JAR record that needs coordinates
    const { rows } = await postgres.query(`
      SELECT "jarKodas", adresas
      FROM "jarCsv"
      WHERE ("locationState" IS NULL OR "locationState" = 0)
        AND adresas IS NOT NULL
      LIMIT 1
    `);

    if (!rows.length) return false;

    const { jarKodas, adresas } = rows[0];

    // Simplify the address
    const simplifiedAddress = await supaprastintiLtAdresa(adresas);

    // Get coordinates from cache or Nominatim
    const result = await getAddressCoords(simplifiedAddress);

    if (!result) {
        // No coordinates found, mark as not found
        await postgres.query(
            `UPDATE "jarCsv"
             SET "locationState" = -404
             WHERE "jarKodas" = $1`,
            [jarKodas],
        );
        return true;
    }

    const [lat, lon] = result.location;

    // Update record with coordinates and mark as found
    await postgres.query(
        `UPDATE "jarCsv"
         SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
             "locationState" = 1
         WHERE "jarKodas" = $3`,
        [lon, lat, jarKodas],
    );

    // Delay if it was a fresh Nominatim request
    if (!result.hit) {
        log(
            `Found coordinates for JAR ${jarKodas}: ${lat}, ${lon}, no cache hit`,
        );
        await new Promise((resolve) =>
            setTimeout(resolve, DELAY_WITHOUT_CACHE_HIT),
        );
    } else {
        log(`Found coordinates for JAR ${jarKodas}: ${lat}, ${lon}, cache hit`);
    }

    return true;
}

if (import.meta.url.endsWith(process.argv[1])) {
    while (await geolocateJarCsv()) {}
}

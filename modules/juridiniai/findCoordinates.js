import { getAddressCoords } from "../geografija/adresai.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const LOCATION_VERSION = 1;

/**
 * Finds a jarCsv entry without coordinates, looks up via AR database, and updates.
 * Uses `locationState`:
 *   1 = success,
 *   0/null = needs lookup,
 *  -404 = not found.
 * Uses `locationVersion` to allow re-geocoding when the version changes.
 *
 * @returns {Promise<boolean>} True if a record was processed, false if none needed.
 */
export async function geolocateJarCsv() {
    const { rows } = await postgres.query(
        `
    SELECT "jarKodas", adresas
    FROM "jarCsv"
    WHERE (
      "locationState" IS NULL
      OR "locationState" = 0
      OR "locationVersion" IS NULL
      OR "locationVersion" < $1
    )
    AND adresas IS NOT NULL
    LIMIT 1
  `,
        [LOCATION_VERSION],
    );
    if (!rows.length) return false;

    const { jarKodas, adresas } = rows[0];
    const result = await getAddressCoords(adresas);

    if (!result) {
        await postgres.query(
            `UPDATE "jarCsv"
       SET "locationState" = -404,
           "locationVersion" = $1
       WHERE "jarKodas" = $2`,
            [LOCATION_VERSION, jarKodas],
        );
        log(`Not found: JAR ${jarKodas} — ${adresas}`);
        return true;
    }

    const [lat, lon] = result.location;
    await postgres.query(
        `UPDATE "jarCsv"
     SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
         "locationState" = 1,
         "locationVersion" = $3
     WHERE "jarKodas" = $4`,
        [lon, lat, LOCATION_VERSION, jarKodas],
    );
    log(`Found: JAR ${jarKodas} — ${lat}, ${lon}`);
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    while (await geolocateJarCsv()) {}
    await postgres.end();
}

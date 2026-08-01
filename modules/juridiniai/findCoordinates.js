import { getAddressCoords } from "../geografija/adresai.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const LOCATION_VERSION = 1;

/**
 * Geokoduoja RC tekstinį adresą tik tada, kai jam nepateiktas AOB kodas.
 * Uses `fallbackLocationState`:
 *   1 = success,
 *   0/null = needs lookup,
 *  -404 = not found.
 * Uses `fallbackLocationVersion` to allow re-geocoding when the version changes.
 *
 * @returns {Promise<boolean>} True if a record was processed, false if none needed.
 */
export async function geolocateJarAddress() {
    const { rows } = await postgres.query(
        `
    SELECT "jarKodas", adresas
    FROM "jarAsmenuAdresai"
    WHERE (
      "fallbackLocationState" IS NULL
      OR "fallbackLocationState" = 0
      OR "fallbackLocationVersion" IS NULL
      OR "fallbackLocationVersion" < $1
    )
    AND "aobKodas" IS NULL
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
            `UPDATE "jarAsmenuAdresai"
       SET "fallbackLocationState" = -404,
           "fallbackLocationVersion" = $1
       WHERE "jarKodas" = $2`,
            [LOCATION_VERSION, jarKodas],
        );
        log(`Not found: JAR ${jarKodas} — ${adresas}`);
        return true;
    }

    const [lat, lon] = result.location;
    await postgres.query(
        `UPDATE "jarAsmenuAdresai"
     SET "fallbackLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326),
         "fallbackLocationState" = 1,
         "fallbackLocationVersion" = $3
     WHERE "jarKodas" = $4`,
        [lon, lat, LOCATION_VERSION, jarKodas],
    );
    log(`Found: JAR ${jarKodas} — ${lat}, ${lon}`);
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    while (await geolocateJarAddress()) {}
    await postgres.end();
}

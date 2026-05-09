import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { buildNodeWayMaps, extractWays, walkWays } from "./utils.js";

const overpassQuery = `
[out:json][timeout:180];
relation
  [admin_level=2]
  [name="Lietuva"];
out body;
>;
out skel qt;
`;

const COUNTRY_DATA_VERSION = 1;

/**
 * Updates country boundaries in the database from the Overpass API.
 *
 * - Checks the current version in "geografiniaiPlotaiVersijos"; exits if up to date.
 * - Deletes existing country entries.
 * - Fetches new OSM data via Overpass API using a predefined query.
 * - Builds node and way maps, extracts outer and inner ways for each relation.
 * - Connects ways into closed rings and constructs MultiPolygon GeoJSON.
 * - Inserts new country geometries into "geografiniaiPlotai".
 *
 * @async
 * @returns {Promise<boolean>} True when update completes successfully or if data is already up to date.
 * @throws {Error} If the Overpass API request fails.
 */
async function updateCountries() {
    const { rows } = await postgres.query(
        `SELECT versija
       FROM "geografiniaiPlotaiVersijos"
       WHERE tipas = 'salis'`,
    );
    if (rows[0]?.versija >= COUNTRY_DATA_VERSION) {
        return true; // up to date
    }

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            `DELETE FROM "geografiniaiPlotai" WHERE tipas = 'salis'`,
        );
        const params = new URLSearchParams();
        params.append("data", overpassQuery);
        const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: params.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Overpass API error: ${res.status}\n${text}`);
        }
        const data = await res.json();
        const { wayMap } = buildNodeWayMaps(data.elements);
        for (const el of data.elements) {
            if (el.type !== "relation" || !el.tags?.name) continue;
            const tipas = "salis";
            const pavadinimas = el.tags.name;
            const { outerWays, innerWays } = extractWays(el.members, wayMap);
            if (!outerWays.length) continue;
            const outerRings = walkWays(outerWays);
            const innerRings = walkWays(innerWays);
            const multipolygon = outerRings.map((o) => [o, ...innerRings]);
            const geojson = { type: "MultiPolygon", coordinates: multipolygon };
            await client.query(
                `INSERT INTO "geografiniaiPlotai" (tipas, pavadinimas, geometrija)
                 VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))`,
                [tipas, pavadinimas, JSON.stringify(geojson)],
            );
        }

        await client.query(
            `INSERT INTO "geografiniaiPlotaiVersijos" (tipas, versija)
             VALUES ('salis', $1)
             ON CONFLICT (tipas) DO UPDATE SET versija = EXCLUDED.versija`,
            [COUNTRY_DATA_VERSION],
        );

        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
    log("Atnaujintos šalių ribos");
    return true;
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    await updateCountries();
    await postgres.end();
}

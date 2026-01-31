import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    buildNodeWayMaps,
    extractWays,
    walkWays,
} from "../../utils/geography.js";

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

async function updateCountries() {
    const { rows } = await postgres.query(
        `SELECT versija
       FROM "geografiniaiPlotaiVersijos"
       WHERE tipas = 'salis'`,
    );

    if (rows[0]?.versija >= COUNTRY_DATA_VERSION) {
        return true; // up to date
    }

    await postgres.query(
        `DELETE FROM "geografiniaiPlotai" WHERE tipas = 'salis'`,
    );

    const params = new URLSearchParams();
    params.append("data", overpassQuery);

    const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: params.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Overpass API error: ${res.status}\n${text}`);
    }

    const data = await res.json();
    const { nodeMap, wayMap } = buildNodeWayMaps(data.elements);

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

        await postgres.query(
            `INSERT INTO "geografiniaiPlotai" (tipas, pavadinimas, geometrija)
             VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))`,
            [tipas, pavadinimas, JSON.stringify(geojson)],
        );
    }

    log("Atnaujintos šalių ribos");
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    await updateCountries();
    postgres.end();
}

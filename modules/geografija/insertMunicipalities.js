import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    buildNodeWayMaps,
    extractWays,
    walkWays,
} from "../../utils/geography.js";

const overpassQuery = `
[out:json][timeout:180];
area(id:3600072596)->.a;
relation
  [boundary=administrative]
  [admin_level=5]
  (area.a);
out body;
>;
out skel qt;
`;

const MUNICIPALITY_DATA_VERSION = 1;

async function updateMunicipalities() {
    const { rows } = await postgres.query(
        `SELECT versija
         FROM "geografiniaiPlotaiVersijos"
         WHERE tipas = 'savivaldybe'`,
    );

    if (rows[0]?.versija >= MUNICIPALITY_DATA_VERSION) {
        return true; // up to date
    }

    await postgres.query(
        `DELETE FROM "geografiniaiPlotai" WHERE tipas = 'savivaldybe'`,
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

        const tipas = "savivaldybe";
        const pavadinimas = el.tags.name;

        // extractWays is now fully in geoHelpers
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

        await postgres.query(
            `INSERT INTO "geografiniaiPlotaiVersijos" ("tipas", "versija")
                VALUES ('savivaldybe', $1)
                ON CONFLICT ("tipas")
                DO UPDATE SET "versija" = EXCLUDED."versija"`,
            [MUNICIPALITY_DATA_VERSION],
        );
    }

    log("Atnaujintos savivaldybių ribos");
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    await updateMunicipalities();
    postgres.end();
}

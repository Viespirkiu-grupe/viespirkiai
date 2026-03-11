import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { getArDataSources } from "./adresuRegistrasDataSources.js";
import proj4 from "proj4";

const lks94 =
    "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9998 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs";
const wgs84 = "EPSG:4326";

const convertCoords = (coords) => {
    if (typeof coords[0] === "number") return proj4(lks94, wgs84, coords);
    return coords.map(convertCoords);
};

async function updateGatves() {
    await postgres.query(`TRUNCATE "arGatves"`);

    const sources = await getArDataSources();
    const entry = sources.adminUnits.find((r) => r.name === "Gatvių ribos");

    const res = await fetch(entry.geojson);
    if (!res.ok) throw new Error(`Failed to fetch gatves: ${res.status}`);
    const data = await res.json();

    for (const feature of data.features) {
        const { GAT_KODAS, GAT_PAV, GAT_ILGIS, GYV_KODAS } = feature.properties;
        const geojson = {
            type: "MultiLineString",
            coordinates:
                feature.geometry.type === "MultiLineString"
                    ? convertCoords(feature.geometry.coordinates)
                    : [convertCoords(feature.geometry.coordinates)],
        };

        await postgres.query(
            `INSERT INTO "arGatves" ("kodas", "pavadinimas", "ilgis", "gyvKodas", "geometrija")
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
            [
                String(GAT_KODAS),
                GAT_PAV,
                GAT_ILGIS,
                String(GYV_KODAS),
                JSON.stringify(geojson),
            ],
        );
    }

    log("Atnaujintos gatvių ribos");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updateGatves();
    await postgres.end();
}

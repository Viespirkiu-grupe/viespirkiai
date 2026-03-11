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

async function updateSavivaldybes() {
    await postgres.query(`TRUNCATE "arSavivaldybes"`);

    const sources = await getArDataSources();
    const entry = sources.adminUnits.find(
        (r) => r.name === "Savivaldybių ribos",
    );

    const res = await fetch(entry.geojson);
    if (!res.ok) throw new Error(`Failed to fetch savivaldybes: ${res.status}`);
    const data = await res.json();

    for (const feature of data.features) {
        const { SAV_KODAS, SAV_PAV, SAV_PLOTAS, APS_KODAS } =
            feature.properties;
        const geojson = {
            type: feature.geometry.type,
            coordinates: convertCoords(feature.geometry.coordinates),
        };

        await postgres.query(
            `INSERT INTO "arSavivaldybes" (kodas, pavadinimas, plotas, "apskritiesKodas", geometrija)
       VALUES ($1, $2, $3, $4, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)))`,
            [
                SAV_KODAS,
                SAV_PAV,
                SAV_PLOTAS,
                APS_KODAS,
                JSON.stringify(geojson),
            ],
        );
    }

    log("Atnaujintos savivaldybių ribos");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updateSavivaldybes();
    await postgres.end();
}

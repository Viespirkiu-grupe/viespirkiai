import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "importApskriciuRibos" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getArDataSources } from "./adresuRegistrasDataSources.js";
import proj4 from "proj4";
import { enqueueAddressLinkedJuridiniai } from "../juridiniai/enqueueRefresh.js";
import { syncJuridiniaiDictionaries } from "../juridiniai/syncDictionaries.js";

const lks94 =
    "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9998 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs";
const wgs84 = "EPSG:4326";

const convertCoords = (coords) => {
    if (typeof coords[0] === "number") return proj4(lks94, wgs84, coords);
    return coords.map(convertCoords);
};

export async function updateApskritys() {
    await postgres.query(`TRUNCATE "adresuRegistras"."apskritys"`);

    const sources = await getArDataSources();
    const entry = sources.adminUnits.find((r) => r.name === "Apskričių ribos");

    const res = await scrapeFetch(entry.geojson);
    if (!res.ok) throw new Error(`Failed to fetch apskritys: ${res.status}`);
    const data = await res.json();

    for (const feature of data.features) {
        const { APS_KODAS, APS_PAV, APS_PLOTAS } = feature.properties;
        const geojson = {
            type: feature.geometry.type,
            coordinates: convertCoords(feature.geometry.coordinates),
        };

        await postgres.query(
            `INSERT INTO "adresuRegistras"."apskritys" (kodas, pavadinimas, plotas, geometrija)
       VALUES ($1, $2, $3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)))`,
            [APS_KODAS, APS_PAV, APS_PLOTAS, JSON.stringify(geojson)],
        );
    }

    await syncJuridiniaiDictionaries(postgres, "apskriciu-ribos-dictionaries");
    await enqueueAddressLinkedJuridiniai(postgres, "apskriciu-ribos");

    logger.log("Atnaujintos apskričių ribos");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updateApskritys();
    await postgres.end();
}

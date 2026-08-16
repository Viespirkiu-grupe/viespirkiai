import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import {
    drainIndexQueue,
    runShardedDrain,
} from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { toNumber } from "../../utils/coerce.js";
import { foldLithuanian } from "../../utils/text.js";
import { toRfc3339 } from "../../utils/time.js";
import { JURIDINIAI_QUICKWIT_INDEX_CONFIG } from "./quickwitIndexConfig.js";

const logger = new Logger();
const LENTELE = "juridiniai";
const BATCH_SIZE = 2_500;
const MAX_ZOOM = 19;
const MAX_MERCATOR_LAT = 85.0511287798066;
let configRegistered = false;

export async function ensureJuridiniaiQuickwitConfig() {
    if (configRegistered) return;
    await postgres.query(
        `INSERT INTO public."quickwitLenteles"
            ("lentele", "defaultShardSize", "indexConfig")
         VALUES ($1, $2, $3)
         ON CONFLICT ("lentele") DO UPDATE SET
            "defaultShardSize" = EXCLUDED."defaultShardSize",
            "indexConfig" = EXCLUDED."indexConfig"
         WHERE ROW(
            "quickwitLenteles"."defaultShardSize",
            "quickwitLenteles"."indexConfig"
         ) IS DISTINCT FROM ROW(
            EXCLUDED."defaultShardSize",
            EXCLUDED."indexConfig"
         )`,
        [LENTELE, 250_000, JURIDINIAI_QUICKWIT_INDEX_CONFIG],
    );
    configRegistered = true;
}

/**
 * Web Mercator tašką paverčia konkretaus zoom tile koordinatėmis.
 */
export function webMercatorTile(lat, lon, zoom) {
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM) {
        throw new RangeError(`zoom turi būti 0-${MAX_ZOOM}`);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const n = 2 ** zoom;
    const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
    const normalizedLon = Math.max(-180, Math.min(180, lon));
    const latRad = clampedLat * Math.PI / 180;
    const x = Math.max(0, Math.min(n - 1, Math.floor((normalizedLon + 180) / 360 * n)));
    const y = Math.max(
        0,
        Math.min(
            n - 1,
            Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n),
        ),
    );
    return { x, y };
}

/**
 * x bitai rašomi į lygines, y bitai — į nelygines pozicijas.
 * Iki z19 rezultatas telpa į tiksliai JS atvaizduojamą ir Quickwit i64 skaičių.
 */
export function mortonTileKey(x, y, zoom) {
    let key = 0n;
    const bx = BigInt(x);
    const by = BigInt(y);
    for (let bit = 0n; bit < BigInt(zoom); bit++) {
        key |= ((bx >> bit) & 1n) << (2n * bit);
        key |= ((by >> bit) & 1n) << (2n * bit + 1n);
    }
    return Number(key);
}

/** @returns {Record<string, number> | null} */
export function buildGeo(latValue, lonValue) {
    const lat = toNumber(latValue);
    const lon = toNumber(lonValue);
    if (lat == null || lon == null) return null;

    /** @type {Record<string, number>} */
    const geo = { lat, lon };
    for (let zoom = 0; zoom <= MAX_ZOOM; zoom++) {
        const { x, y } = webMercatorTile(lat, lon, zoom);
        geo[`z${zoom}`] = mortonTileKey(x, y, zoom);
    }
    return geo;
}

function withoutNulls(object) {
    return Object.fromEntries(
        Object.entries(object).filter(([, value]) => value != null),
    );
}

export function buildDoc(row) {
    return {
        jarKodas: String(row.jarKodas),
        pavadinimas: row.pavadinimas,
        pavadinimasAscii: foldLithuanian(row.pavadinimas),
        adresas: row.adresas,
        formosKodas: toNumber(row.formosKodas),
        formosPavadinimas: row.formosPavadinimas,
        viesasis: row.viesasis,
        statusoKodas: toNumber(row.statusoKodas),
        statusoPavadinimas: row.statusoPavadinimas,
        isregistruotas: row.isregistruotas,
        registravimoData: toRfc3339(row.registravimoData),
        isregistravimoData: toRfc3339(row.isregistravimoData),
        savivaldybe: row.savivaldybe,
        apskritis: row.apskritis,
        evrkKodas: row.evrkKodas,
        evrkPavadinimas: row.evrkPavadinimas,
        darbuotojai: toNumber(row.darbuotojai),
        vidutinisAtlyginimas: toNumber(row.vidutinisAtlyginimas),
        rodikliai: withoutNulls({
            // Skaitinis jarKodas – antrinis rikiavimo laukas (žr. searchQuickwit.js).
            // Quickwit nerikiuoja pagal `text` laukus, o json laukas leidžia jį
            // pridėti nekeičiant jau sukurtų shard'ų schemos.
            jarKodas: toNumber(row.jarKodas),
            vmiMokesciai: toNumber(row.vmiMokesciai),
            istatinisKapitalas: toNumber(row.istatinisKapitalas),
            pirkimuKiekis: toNumber(row.pirkimuKiekis),
            pirkimuSuma: toNumber(row.pirkimuSuma),
            pardavimuKiekis: toNumber(row.pardavimuKiekis),
            pardavimuSuma: toNumber(row.pardavimuSuma),
            byluKiekis: toNumber(row.byluKiekis),
            vdiPazeidimuKiekis: toNumber(row.vdiPazeidimuKiekis),
            domenuKiekis: toNumber(row.domenuKiekis),
        }),
        geo: buildGeo(row.lat, row.lon),
        atnaujinta: toRfc3339(row.atnaujinta),
    };
}

export async function processJuridiniaiIndexQueue(opts = {}) {
    await ensureJuridiniaiQuickwitConfig();
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "juridiniaiIndexQueue",
            keyColumn: "jarKodas",
            batchSize: BATCH_SIZE,
            commit: "auto",
            toEilutesId,
            rowId: (row) => row.jarKodas,
            buildDoc,
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT
                        j.*,
                        f."pavadinimas" AS "formosPavadinimas",
                        f."viesasis",
                        s."pavadinimas" AS "statusoPavadinimas",
                        sav."pavadinimas" AS "savivaldybe",
                        aps."pavadinimas" AS "apskritis",
                        e."pavadinimas" AS "evrkPavadinimas",
                        CASE WHEN j."location" IS NULL
                            THEN NULL ELSE ST_Y(j."location") END AS "lat",
                        CASE WHEN j."location" IS NULL
                            THEN NULL ELSE ST_X(j."location") END AS "lon"
                     FROM public."juridiniai" j
                     LEFT JOIN public."juridiniaiFormos" f
                        ON f."kodas" = j."formosKodas"
                     LEFT JOIN public."juridiniaiStatusai" s
                        ON s."kodas" = j."statusoKodas"
                     LEFT JOIN public."juridiniaiSavivaldybesPavadinimai" sav
                        ON sav."id" = j."savivaldybeId"
                     LEFT JOIN public."juridiniaiApskritysPavadinimai" aps
                        ON aps."id" = j."apskritisId"
                     LEFT JOIN public."juridiniaiEvrk" e
                        ON e."kodas" = j."evrkKodas"
                     WHERE j."jarKodas" = ANY($1::text[])`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

function toEilutesId(jarKodas) {
    if (!/^\d+$/.test(String(jarKodas))) {
        throw new Error(`juridiniai.jarKodas nėra skaitinis: ${jarKodas}`);
    }
    return String(jarKodas);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processJuridiniaiIndexQueue,
        label: "juridiniai",
        logger,
    });
    await postgres.end();
    process.exit(0);
}

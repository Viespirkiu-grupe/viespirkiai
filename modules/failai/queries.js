import { postgres } from "../../postgres/postgres.js";
import { preparedStatement } from "../../postgres/prepared.js";
import { FILES_JOINS, FILES_SELECT, papildytiFaila } from "./filesSkaitymas.js";

const FAILO_BAZĖ = `
    SELECT ${FILES_SELECT}
    FROM public.files f
    ${FILES_JOINS}`;

/*
Failo eilutė – 12 LEFT JOIN'ų, tad planavimas kainuoja daug daugiau nei pats
vykdymas: išmatuota `EXPLAIN (ANALYZE)` md5 paieškai – planavimas 58,3 ms,
vykdymas 0,70 ms. Paruoštas planas jungčiai tą kainą sumoka vieną kartą.
*/

const failasPagalMd5 = preparedStatement(
    "failasPagalMd5",
    `${FAILO_BAZĖ} WHERE m.md5 = $1 LIMIT 1`,
);

const failasPagalId = preparedStatement(
    "failasPagalId",
    `${FAILO_BAZĖ} WHERE f.id = $1 LIMIT 1`,
);

// Sutarčių šaltinio raktas — sourceId0/sourceId1 (buvę dokId/fileId).
const failasPagalSutartiesRakta = preparedStatement(
    "failasPagalSutartiesRakta",
    `${FAILO_BAZĖ} WHERE st.title = 'sutartys'
                     AND f."sourceId0" = $1::text AND f."sourceId1" = $2::text
     LIMIT 1`,
);

/**
 * Suranda failą pagal id, md5 arba sutarties (dokId, fileId) porą.
 * Grąžinama pg rezultato forma su eilutėmis senuoju pavidalu (žr. filesSkaitymas.js).
 * @returns {Promise<{ rows: Record<string, any>[] }|null>}
 */
export async function findFailas({ id, dokId, fileId }) {
    const grąžinti = async (cfg) => {
        const res = await postgres.query(cfg);
        res.rows = res.rows.map(papildytiFaila);
        return res;
    };

    if (id) {
        if (/^[a-f0-9]{32}$/.test(id)) return grąžinti(failasPagalMd5([id]));
        if (isNaN(id)) return null;
        return grąžinti(failasPagalId([id]));
    }
    if (dokId && fileId) {
        if (isNaN(dokId) || isNaN(fileId)) return null;
        return grąžinti(
            failasPagalSutartiesRakta([String(dokId), String(fileId)]),
        );
    }
    return null;
}

/**
 * Grąžina archyvo (zip/7z/rar/adoc) viduje esančius išarchyvuotus failus.
 * Naudojama, kad AI nesustotų ties „tuščiu" archyvu — realus turinys yra vaikuose.
 * @param {number|string} parentId - Archyvo (tėvinio) failo ID.
 */
export async function findArchyvoVaikai(parentId) {
    if (parentId == null || isNaN(parentId)) return [];
    const result = await postgres.query(
        `SELECT f.id, fn.filename AS pavadinimas, e.extension, m.md5,
                d."wordCount" AS "zodziuSkaicius", d."pageCount" AS "puslapiuSkaicius",
                CASE WHEN d.status < 0 THEN d.status ELSE d.version END AS nuskaitytas,
                f."downloadStatus" AS parsiustas
         FROM public.files f
         LEFT JOIN public."filesFilenames" fn ON fn.id = f."filenameId"
         LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
         LEFT JOIN public."filesMd5" m ON m.id = f."md5Id"
         LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
         WHERE f.parent = $1
         ORDER BY fn.filename ASC`,
        [parentId],
    );
    return result.rows;
}

// Planavimas 1,4 ms, vykdymas 0,4 ms – kviečiama ~307 tūkst. k./parą.
const dezePagalMd5 = preparedStatement(
    "dezePagalMd5",
    `SELECT m.md5, d.pavadinimas AS deze, b.filesize AS dydis,
            d.url, d.speed, d.pavadinimas, a."apiKey"
     FROM public."filesMd5Boxes" b
     JOIN public."filesMd5" m ON m.id = b."md5Id"
     JOIN public.dezes d ON d.id = b."boxId"
     JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
     WHERE m.md5 = $1
     ORDER BY -LN(random()) / NULLIF(d.speed, 0)
     LIMIT 1`,
);

export async function getDezeForMd5(md5) {
    const result = await postgres.query(dezePagalMd5([md5]));
    return result.rows[0] ?? null;
}

/**
 * Grąžina failo „nerodymo" įrašą iš `filesHidden` (jei toks yra), arba null.
 * `priezastis` — vieša priežastis, `status` — HTTP statusas (pvz. 451).
 */
export async function getFailasNerodymas(id) {
    if (id == null || isNaN(id)) return null;
    const result = await postgres.query(
        `SELECT reason AS priezastis, status FROM public."filesHidden" WHERE id = $1 LIMIT 1`,
        [id],
    );
    return result.rows[0] ?? null;
}

/**
 * Checks if a file is hidden (failaiNerodyti) or isn't yet downloaded.
 * Returns { error, message } if inaccessible, or {} if fine.
 */
export async function checkFailasAccessible(failas) {
    const nerodymas = await getFailasNerodymas(failas.id);
    if (nerodymas)
        return {
            error: nerodymas.status ?? 451,
            message: nerodymas.priezastis || "Dokumentas nerodomas.",
        };
    if (failas.parsiustas === 0)
        return { error: 404, message: "Failas dar neparsiųstas." };
    if (failas.parsiustas === -1)
        return { error: 404, message: "Failas nepavykęs parsiųsti." };
    return {};
}

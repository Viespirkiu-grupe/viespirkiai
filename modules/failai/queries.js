import { postgres } from "../../postgres/postgres.js";

export async function findFailas({ id, dokId, fileId }) {
    if (id) {
        if (/^[a-f0-9]{32}$/.test(id))
            return postgres.query(
                `SELECT f.* FROM failai f WHERE f."md5" = $1 LIMIT 1`,
                [id],
            );
        if (isNaN(id)) return null;
        return postgres.query(
            `SELECT f.* FROM failai f WHERE f."id" = $1 LIMIT 1`,
            [id],
        );
    }
    if (dokId && fileId) {
        if (isNaN(dokId) || isNaN(fileId)) return null;
        return postgres.query(
            `SELECT f.* FROM failai f WHERE f."dokId" = $1 AND f."fileId" = $2 LIMIT 1`,
            [dokId, fileId],
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
        `SELECT id, pavadinimas, extension, md5,
                "zodziuSkaicius", "puslapiuSkaicius", nuskaitytas, parsiustas
         FROM failai
         WHERE parent = $1
         ORDER BY pavadinimas ASC`,
        [parentId],
    );
    return result.rows;
}

export async function getDezeForMd5(md5) {
    const result = await postgres.query(
        `
        SELECT f.md5, f.deze, f.dydis, d.url, d.speed, d.pavadinimas, a."apiKey"
        FROM "failaiDezes" f
        JOIN dezes d ON f.deze = d.pavadinimas
        JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
        WHERE f.md5 = $1
        ORDER BY -LN(random()) / NULLIF(d.speed, 0)
        LIMIT 1
        `,
        [md5],
    );
    return result.rows[0] ?? null;
}

/**
 * Checks if a file has been legally removed or isn't yet downloaded.
 * Returns { error, message } if inaccessible, or {} if fine.
 */
export async function checkFailasAccessible(failas) {
    const removalCheck = await postgres.query(
        `SELECT 1 FROM "failuPasalinimai" WHERE "failoId" = $1 AND salinti = true LIMIT 1`,
        [failas.id],
    );
    if (removalCheck.rows.length)
        return {
            error: 451,
            message: "Failas pašalintas. Removed for legal reasons.",
        };
    if (failas.parsiustas === 0)
        return { error: 404, message: "Failas dar neparsiųstas." };
    if (failas.parsiustas === -1)
        return { error: 404, message: "Failas nepavykęs parsiųsti." };
    return {};
}

/** Returns true if the file has been marked for removal by dokId+fileId. */
export async function checkDokFileRemoved(dokId, fileId) {
    const result = await postgres.query(
        `SELECT 1 FROM "failuPasalinimai" WHERE "dokId" = $1 AND "fileId" = $2 AND salinti = true LIMIT 1`,
        [dokId, fileId],
    );
    return result.rows.length > 0;
}

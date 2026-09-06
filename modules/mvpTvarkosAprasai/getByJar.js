import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

export async function mvpAprasaiPagalJarKoda(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit === "max") {
        limit = 10_000_000;
    }

    const aprasaiRes = await postgres.query(
        `SELECT a."id", a."subjektoId", a."pavadinimas", a."rinkmenos",
                a."vptGavimoData", a."paskelbimoData", a."galiojaIki",
                s."jarKodas", s."pavadinimas" AS "subjektoPavadinimas",
                ${WINDOW_COUNT_SQL}
         FROM "mvpAprasai"."tvarkos" a
         JOIN "mvpAprasai"."subjektai" s ON s."id" = a."subjektoId"
         WHERE s."jarKodas" = $1
         ORDER BY a."paskelbimoData" DESC NULLS LAST
         LIMIT $2`,
        [jarKodas, limit],
    );
    const { rows: aprasaiRows, viso } = splitWindowCount(aprasaiRes.rows);

    // Collect all saltinioIds to batch-fetch from failai
    const allSaltinioIds = new Set();
    for (const row of aprasaiRows) {
        for (const href of row.rinkmenos || []) {
            if (!href) continue;
            const saltinioId = href
                .replace(/^https?:\/\/[^/]+/i, "")
                .replace(/^\/+/, "");
            allSaltinioIds.add(saltinioId);
        }
    }

    // Batch-fetch parsiustas status from files (rinkmenos jau saugomos be hosto → sourceId0)
    const failaiMap = new Map();
    if (allSaltinioIds.size > 0) {
        const failaiRes = await postgres.query(
            `SELECT f."sourceId0" AS "saltinioId", f."id",
                    f."downloadStatus" AS "parsiustas", f."filesize" AS "dydis", e."extension"
           FROM files.files f
           LEFT JOIN files."extensions" e ON e.id = f."extensionId"
           WHERE f."sourceTitleId" = (SELECT id FROM files."sourceTitles" WHERE title = 'mvpAprasai')
             AND f."sourceId0" = ANY($1)`,
            [Array.from(allSaltinioIds)],
        );
        for (const f of failaiRes.rows) {
            failaiMap.set(f.saltinioId, f);
        }
    }

    const resolveLink = (href) => {
        if (!href) return null;
        const saltinioId = href
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/^\/+/, "");
        const failas = failaiMap.get(saltinioId);
        const pavadinimas = decodeURIComponent(
            (saltinioId.split("/").pop() || "").trim(),
        );
        const originalUrl = `https://mw.eviesiejipirkimai.lt/${saltinioId}`;
        const url =
            failas && (failas.parsiustas === 1 || failas.parsiustas === -5)
                ? `/failas/${failas.id}`
                : null;
        return {
            url,
            originalUrl,
            pavadinimas,
            dydis: failas?.dydis ?? null,
            extension: failas?.extension ?? null,
        };
    };

    const aprasai = aprasaiRows.map((row) => ({
        id: row.id,
        subjektoId: row.subjektoId,
        subjektoPavadinimas: row.subjektoPavadinimas,
        pavadinimas: row.pavadinimas,
        rinkmenos: (row.rinkmenos || []).map(resolveLink).filter(Boolean),
        vptGavimoData: row.vptGavimoData,
        paskelbimoData: row.paskelbimoData,
        galiojaIki: row.galiojaIki,
    }));

    return {
        limit,
        count: viso,
        rows: aprasai,
    };
}

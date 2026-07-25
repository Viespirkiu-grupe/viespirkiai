import { postgres } from "../../postgres/postgres.js";

export async function mvpAprasaiPagalJarKoda(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit === "max") {
        limit = 10_000_000;
    }

    const [aprasaiRes, countRes] = await Promise.all([
        postgres.query(
            `SELECT a.*, s."jarKodas", s."pavadinimas" AS "subjektoPavadinimas"
             FROM "mvpTvarkosAprasai" a
             JOIN "mvpAprasaiSubjektai" s ON s."id" = a."sbjId"
             WHERE s."jarKodas" = $1
             ORDER BY a."paskelbimoData" DESC NULLS LAST
             LIMIT $2`,
            [jarKodas, limit],
        ),
        postgres.query(
            `SELECT COUNT(*) FROM "mvpTvarkosAprasai" a
             JOIN "mvpAprasaiSubjektai" s ON s."id" = a."sbjId"
             WHERE s."jarKodas" = $1`,
            [jarKodas],
        ),
    ]);

    // Collect all saltinioIds to batch-fetch from failai
    const allSaltinioIds = new Set();
    for (const row of aprasaiRes.rows) {
        for (const href of row.rinkmenos || []) {
            if (!href) continue;
            const saltinioId = href
                .replace(/^https?:\/\/[^/]+/i, "")
                .replace(/^\/+/, "");
            allSaltinioIds.add(saltinioId);
        }
    }

    // Batch-fetch parsiustas status from files (mvpAprasai saltinioId nedalinamas → sourceId0)
    const failaiMap = new Map();
    if (allSaltinioIds.size > 0) {
        const failaiRes = await postgres.query(
            `SELECT f."sourceId0" AS "saltinioId", f."id",
                    f."downloadStatus" AS "parsiustas", f."filesize" AS "dydis", e."extension"
           FROM public.files f
           LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
           WHERE f."sourceTitleId" = (SELECT id FROM public."filesSourceTitles" WHERE title = 'mvpAprasai')
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

    const aprasai = aprasaiRes.rows.map((row) => ({
        id: row.id,
        sbjId: row.sbjId,
        subjektoPavadinimas: row.subjektoPavadinimas,
        aprasymas: row.aprasymas,
        rinkmenos: (row.rinkmenos || []).map(resolveLink).filter(Boolean),
        vptGavimoData: row.vptGavimoData,
        paskelbimoData: row.paskelbimoData,
        galiojaIki: row.galiojaIki,
    }));

    return {
        limit,
        count: parseInt(countRes.rows[0].count),
        rows: aprasai,
    };
}

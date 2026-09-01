import { postgres } from "../../postgres/postgres.js";

export async function rastiKotisPagalGavejoKoda(gavejoKodas, options = {}) {
    const limit = Math.min(500, Math.max(1, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);
    const sorts = {
        data: 'p."suteikimoData"',
        teikejas: 'teikejas."pavadinimas"',
        tipas: 'tipas."pavadinimas"',
        rusis: 'rusis."pavadinimas"',
        forma: 'forma."pavadinimas"',
        suma: 'p."suma"',
        busena: 'busena."pavadinimas"',
    };
    const sort = Object.hasOwn(sorts, options.sort) ? options.sort : "data";
    const kryptis = options.kryptis === "asc" ? "asc" : "desc";
    const from = `FROM kotis."pagalbos" p
        JOIN kotis."subjektai" gavejas ON gavejas."id" = p."gavejoId"
        LEFT JOIN kotis."subjektai" teikejas ON teikejas."id" = p."teikejoId"
        JOIN kotis."pagalbosTipai" tipas ON tipas."id" = p."pagalbosTipoId"
        JOIN kotis."pagalbosRusys" rusis ON rusis."id" = p."pagalbosRusiesId"
        LEFT JOIN kotis."pagalbosFormos" forma ON forma."id" = p."pagalbosFormosId"
        JOIN kotis."busenos" busena ON busena."id" = p."busenosId"
        JOIN kotis."saltinioIrasai" saltinis ON saltinis."pagalbosId" = p."id"
            AND saltinis."busena" = 'visible'
        WHERE gavejas."kodas" = $1`;

    const [kotisRes, kotisCountRes] = await Promise.all([
        postgres.query(
            `SELECT p."id", p."suteikimoData", p."suma",
                teikejas."pavadinimas" AS "teikejas",
                tipas."pavadinimas" AS "pagalbosTipas",
                rusis."pavadinimas" AS "pagalbosRusis",
                forma."pavadinimas" AS "pagalbosForma",
                busena."pavadinimas" AS "busena"
             ${from}
             ORDER BY ${sorts[sort]} ${kryptis}, p."id" DESC LIMIT $2 OFFSET $3`,
            [gavejoKodas, limit, offset],
        ),
        postgres.query(
            `SELECT count(*)::bigint AS "count" ${from}`,
            [gavejoKodas],
        ),
    ]);

    return {
        limit,
        offset,
        sort,
        kryptis,
        count: Number(kotisCountRes.rows[0]?.count ?? 0),
        rows: kotisRes.rows,
    };
}

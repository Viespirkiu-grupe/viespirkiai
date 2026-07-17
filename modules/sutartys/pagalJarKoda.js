import { postgres } from "../../postgres/postgres.js";

export async function gautiSutarciuDuomenisPagalJarKoda(
    jarKodas,
    options = {},
) {
    const limitSql = options.limit
        ? `LIMIT ${parseInt(options.limit, 10)}`
        : "";

    const yearFilter = `"tipas" <> 'SP' AND "metai" >= 2000 AND "metai" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1`;

    const [
        { rows: pirkimaiKasMetus },
        { rows: tiekimaiKasMetus },
        { rows: topTiekejai },
        { rows: topPirkejai },
    ] = await Promise.all([
        postgres.query(
            `SELECT "metai" AS "year", ROUND(SUM("total")::numeric, 2) AS total
             FROM public."sutartysSumosMetaiPirkejas"
             WHERE "perkanciosiosOrganizacijosKodas" = $1 AND ${yearFilter}
             GROUP BY "metai" ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT "metai" AS "year", ROUND(SUM("total")::numeric, 2) AS total
             FROM public."sutartysSumosMetaiTiekejas"
             WHERE "tiekejoKodas" = $1 AND ${yearFilter}
             GROUP BY "metai" ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."tiekejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."kiekis" AS "count"
             FROM (SELECT "tiekejoKodas", "suma", "kiekis" FROM "sutartysSaliuSumos" WHERE "pirkejoKodas" = $1 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN public."jarCsv" j ON j."jarKodas"::text = agg."tiekejoKodas"`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."pirkejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."kiekis" AS "count"
             FROM (SELECT "pirkejoKodas", "suma", "kiekis" FROM "sutartysSaliuSumos" WHERE "tiekejoKodas" = $1 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN public."jarCsv" j ON j."jarKodas"::text = agg."pirkejoKodas"`,
            [jarKodas],
        ),
    ]);

    return { pirkimaiKasMetus, tiekimaiKasMetus, topPirkejai, topTiekejai };
}

// Ar yra bent viena sutartis pagal kodą (kaip pirkėjo arba tiekėjo)
export function arTuriSutarciu(sutartys) {
    return (
        sutartys.pirkimaiKasMetus.length > 0 ||
        sutartys.tiekimaiKasMetus.length > 0 ||
        sutartys.topTiekejai.length > 0 ||
        sutartys.topPirkejai.length > 0
    );
}

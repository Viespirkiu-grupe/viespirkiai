import { postgres } from "../../postgres/postgres.js";

// `vpmSutartysSumosPirkejasTiekejas` kodai yra text (pasitaiko ir užsienio PVM
// kodų, pvz. "GB879443177"), o `jarAsmenys."jarKodas"` – integer. Cast'as ant
// indeksuoto stulpelio (`j."jarKodas"::text = agg.kodas`) išjungdavo indeksą ir
// versdavo seq scan'ą per visą jarAsmenys lentelę, todėl castinam kitą pusę,
// o ne skaitinius kodus paverčiam NULL (jiems pavadinimo ir taip nėra).
const JAR_KODAS_INT = (kodas) =>
    `CASE WHEN ${kodas} ~ '^[0-9]{1,9}$' THEN ${kodas}::integer END`;

export async function gautiSutarciuDuomenisPagalJarKoda(
    jarKodas,
    options = {},
) {
    const limitSql = options.limit
        ? `LIMIT ${parseInt(options.limit, 10)}`
        : "";

    const yearFilter = `"metai" >= 2000 AND "metai" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1`;

    const [
        { rows: pirkimaiKasMetus },
        { rows: tiekimaiKasMetus },
        { rows: topTiekejai },
        { rows: topPirkejai },
    ] = await Promise.all([
        postgres.query(
            `SELECT "metai" AS "year", ROUND("pirkimuSuma"::numeric, 2) AS total
             FROM public."vpmSutartysSumosMetai"
             WHERE "saliesKodas" = $1 AND pirkimai > 0 AND ${yearFilter}
             ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT "metai" AS "year", ROUND("pardavimuSuma"::numeric, 2) AS total
             FROM public."vpmSutartysSumosMetai"
             WHERE "saliesKodas" = $1 AND pardavimai > 0 AND ${yearFilter}
             ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."tiekejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."pirkimai" AS "count"
             FROM (SELECT "tiekejoKodas", "suma", "pirkimai" FROM "vpmSutartysSumosPirkejasTiekejas" WHERE "pirkejoKodas" = $1 AND "pirkimai" > 0 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN public."jarAsmenys" j ON j."jarKodas" = ${JAR_KODAS_INT(`agg."tiekejoKodas"`)}
             ORDER BY (agg."suma" = 'NaN'::numeric), agg."suma" DESC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."pirkejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."pirkimai" AS "count"
             FROM (SELECT "pirkejoKodas", "suma", "pirkimai" FROM "vpmSutartysSumosPirkejasTiekejas" WHERE "tiekejoKodas" = $1 AND "pirkimai" > 0 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN public."jarAsmenys" j ON j."jarKodas" = ${JAR_KODAS_INT(`agg."pirkejoKodas"`)}
             ORDER BY (agg."suma" = 'NaN'::numeric), agg."suma" DESC`,
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

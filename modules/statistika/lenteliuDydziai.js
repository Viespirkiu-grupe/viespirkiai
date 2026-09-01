import { postgres } from "../../postgres/postgres.js";

/**
 * Lentelių dydžiai ir apytikslis eilučių kiekis iš Postgres statistikos.
 *
 * Naudoja `/statistika` (bendra lentelių lentelė) ir `/duomenys/lenteles`
 * (dokumentacijos puslapis). Užklausa laikoma vienoje vietoje, kad abu
 * puslapiai rodytų tuos pačius skaičius.
 *
 * `n_live_tup` yra ANALYZE įvertis, ne tikslus `COUNT(*)` — 318 mln. eilučių
 * bazėje tikslaus skaičiavimo daryti negalima, tad puslapiuose šie skaičiai
 * žymimi kaip apytiksliai.
 *
 * @param {{ schemos?: string[] }} [options] Schemų filtras; be jo – visos naudotojo schemos.
 * @returns {Promise<Array<{ schemaName: string, tableName: string, dataSize: number,
 *   indexSize: number, totalSize: number, approxRowCount: number }>>}
 */
export async function gautiLenteliuDydzius({ schemos } = {}) {
    const { rows } = await postgres.query(
        `
        SELECT
            s.schemaname                                        AS "schemaName",
            s.relname                                           AS "tableName",
            pg_table_size(s.relid)                              AS "dataSize",
            pg_indexes_size(s.relid)                            AS "indexSize",
            pg_table_size(s.relid) + pg_indexes_size(s.relid)   AS "totalSize",
            st.n_live_tup                                       AS "approxRowCount"
        FROM pg_catalog.pg_statio_user_tables s
        JOIN pg_catalog.pg_stat_user_tables st ON s.relid = st.relid
        WHERE $1::text[] IS NULL OR s.schemaname = ANY($1::text[])
        ORDER BY s.relname ASC
        `,
        [schemos ?? null],
    );

    return rows;
}

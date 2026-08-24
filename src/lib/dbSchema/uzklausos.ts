import { postgres } from '@/postgres/postgres.js';
import { gautiLenteliuDydzius } from '@/modules/statistika/lenteliuDydziai.js';

/**
 * Katalogo užklausos `/duomenys/lenteles` puslapiui.
 *
 * Principas: viena „visos bazės“ krova, o ne užklausa kiekvienai lentelei.
 * 324 lentelės × ~15 stulpelių ≈ 5000 eilučių – tai pigiau nei 324 atskiros
 * užklausos, ir modelis sulipdomas atmintyje.
 *
 * Filtras visur vienodas: ne-sisteminės schemos, t. y. `public`, `dba` ir
 * viskas, kas atsiras ateityje.
 */

const SCHEMU_FILTRAS = `
    n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
`;

export async function lenteles() {
    const { rows } = await postgres.query(`
        SELECT
            n.nspname                              AS "schema",
            c.relname                              AS "vardas",
            obj_description(c.oid, 'pg_class')     AS "aprasymas",
            c.reltuples                            AS "eiluciuIvertis",
            c.relispartition                       AS "arSekcija"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND ${SCHEMU_FILTRAS}
        ORDER BY n.nspname, c.relname
    `);
    return rows;
}

export async function stulpeliai() {
    const { rows } = await postgres.query(`
        SELECT
            n.nspname                                      AS "schema",
            c.relname                                      AS "lentele",
            a.attname                                      AS "vardas",
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS "tipas",
            a.attnotnull                                   AS "arButinas",
            a.attgenerated                                 AS "generuota",
            pg_get_expr(ad.adbin, ad.adrelid)              AS "numatytoji",
            col_description(a.attrelid, a.attnum)          AS "aprasymas",
            a.attnum                                       AS "eile"
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND ${SCHEMU_FILTRAS}
        ORDER BY n.nspname, c.relname, a.attnum
    `);
    return rows;
}

/**
 * Ribojimai su išskleistais stulpelių vardais – iš `conkey`/`confkey` masyvų
 * gaunamas FK grafas ER diagramai (nereikia parsinti `pg_get_constraintdef`).
 */
export async function ribojimai() {
    const { rows } = await postgres.query(`
        SELECT
            n.nspname                          AS "schema",
            c.relname                          AS "lentele",
            con.conname                        AS "vardas",
            con.contype                        AS "tipas",
            pg_get_constraintdef(con.oid, true) AS "apibrezimas",
            fn.nspname                         AS "isorineSchema",
            fc.relname                         AS "isorineLentele",
            (
                SELECT array_agg(att.attname::text ORDER BY u.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
            )                                  AS "stulpeliai",
            (
                SELECT array_agg(att.attname::text ORDER BY u.ord)
                FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = u.attnum
            )                                  AS "isoriniaiStulpeliai"
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_class fc ON fc.oid = con.confrelid
        LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
        WHERE ${SCHEMU_FILTRAS}
        ORDER BY n.nspname, c.relname, con.contype, con.conname
    `);
    return rows;
}

export async function indeksai() {
    const { rows } = await postgres.query(`
        SELECT
            n.nspname                     AS "schema",
            tbl.relname                   AS "lentele",
            idx.relname                   AS "vardas",
            i.indisprimary                AS "arPirminis",
            pg_get_indexdef(i.indexrelid) AS "apibrezimas",
            pg_relation_size(i.indexrelid) AS "dydis"
        FROM pg_index i
        JOIN pg_class tbl ON tbl.oid = i.indrelid
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = tbl.relnamespace
        WHERE ${SCHEMU_FILTRAS}
        ORDER BY n.nspname, tbl.relname, i.indisprimary DESC, idx.relname
    `);
    return rows;
}

export async function trigeriai() {
    const { rows } = await postgres.query(`
        SELECT
            n.nspname                      AS "schema",
            c.relname                      AS "lentele",
            t.tgname                       AS "vardas",
            pg_get_triggerdef(t.oid, true) AS "apibrezimas"
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND ${SCHEMU_FILTRAS}
        ORDER BY n.nspname, c.relname, t.tgname
    `);
    return rows;
}

export { gautiLenteliuDydzius as dydziai };

/**
 * Quickwit indeksai pagal lentelę – „kur duomenys keliauja toliau“ be jokio
 * rankinio darbo.
 */
export async function quickwitIndeksai() {
    const { rows } = await postgres.query(`
        SELECT "lentele", "indeksas"
        FROM public."quickwitIndeksai"
        WHERE "current"
        ORDER BY "lentele", "seq"
    `);
    return rows;
}

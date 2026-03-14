import { arrayToLithuanianTime } from "../../utils/time.js";
import { searchDocuments } from "../../typesense/typesense.js";
import { postgres } from "../../postgres/postgres.js";
import { FilterBuilder } from "../../utils/filter.js";
import { fixHtmlEntities } from "../../utils/fixHtmlEntities.js";
import { Readable, Transform } from "node:stream";
import { CONTRACT_TYPES } from "./contractTypes.js";
import QueryStream from "pg-query-stream";

const sutartysFilter = new FilterBuilder({
    fields: [
        { key: "perkanciosiosOrganizacijosKodas", hidden: true },
        {
            key: "tiekejoKodas",
            hidden: true,
            pgOverride: (addParam, val) =>
                `("tiekejoKodas" = ${addParam(val)} OR "papildomiTiekejaiKodai" @> ARRAY[${addParam(val)}])`,
            tsOverride: (val) =>
                `(tiekejoKodas:=${val} || papildomiTiekejaiKodai:=[${val}])`,
        },
        { key: "sutartiesNumeris", hidden: true },
        { key: "pirkimoNumeris", hidden: true },
        {
            key: "sutartiesUnikalusID",
            col: `"sutartiesUnikalusId"`,
            type: "integer",
            hidden: true,
        },
        { key: "tipas", hidden: true },
        {
            key: "sudarymoDataNuo",
            col: `"sudarymoData"`,
            type: "gte_date",
            hidden: true,
        },
        {
            key: "sudarymoDataIki",
            col: `"sudarymoData"`,
            type: "lte_date",
            hidden: true,
        },
        { key: "verteNuo", col: `"verte"`, type: "gte_number", hidden: true },
        { key: "verteIki", col: `"verte"`, type: "lte_number", hidden: true },
        {
            key: "tikSuDokumentais",
            isBoolean: true,
            hidden: true,
            pgOverride: () => `"dokumentuKiekis" > 0`,
            tsOverride: () => `dokumentuKiekis:>0`,
        },
        {
            key: "ignoruotiSp",
            isBoolean: true,
            hidden: true,
            pgOverride: () => `"tipas" != 'SP'`,
            tsOverride: () => `tipas:!=SP`,
        },
        { key: "search", col: `"search_tsv"`, type: "tsvector", pgOnly: true },
        {
            key: "bvpzPrefiksas",
            col: `"bvpzKodas"`,
            type: "prefix_range",
            hidden: true,
            pgOnly: true,
        },
        {
            key: "bvpzPrefiksasKitas",
            col: `"bvpzKodas"`,
            type: "prefix_range",
            hidden: true,
            pgOnly: true,
        },
    ],
    sort: {
        default: "paskutinioRedagavimoData",
        defaultDir: "desc",
        allowed: [
            "paskutinioRedagavimoData",
            "sudarymoData",
            "verte",
            "paskelbimoData",
            "suma",
        ],
        pgAliases: { suma: "verte" },
    },
});

const FIXED_WHERE = [`NOT COALESCE("istrinta", false)`];

/**
 * @typedef {"postgres" | "typesense"} Engine
 */

/**
 * @typedef {object} SearchOptions
 * @property {number} limit - Rows per page.
 * @property {number} [page=1] - Current page number.
 * @property {Engine} [engine="postgres"] - Search engine to use.
 * @property {boolean} [stream=false] - Return a raw stream instead of rows.
 *   When true, caller must release the returned `client`.
 */

/**
 * @typedef {object} SearchResult
 * @property {object[]} results - Processed rows. Empty when streaming.
 * @property {number | null} total - Total matching rows. Null if count timed out.
 * @property {object} values - Resolved filter values for form repopulation.
 * @property {string} queryParams - URL query string fragment for pagination links.
 * @property {import("pg-query-stream") | null} stream - Raw stream, or null.
 * @property {import("pg").PoolClient | null} client - Live pg client when streaming, else null.
 */

/**
 * Searches the sutartys table using Postgres or Typesense.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
export async function searchSutartys(
    query,
    { limit, page = 1, engine = "postgres", stream = false, sort = true } = {},
) {
    if (engine === "typesense") {
        const { filterBy, sortBy, values, queryParams } =
            sutartysFilter.build(query);

        if (stream) {
            return {
                results: [],
                total: null,
                values,
                queryParams,
                stream: Readable.from(streamTypesenseResults(query)),
                client: null,
            };
        }

        const { results: raw, total } = await searchDocuments(
            query.search || "*",
            { page, filterBy, sortBy, limit },
        );
        return {
            results: arrayToLithuanianTime(raw).map(aptvarkytiRezultata),
            total,
            values,
            queryParams,
            stream: null,
            client: null,
        };
    }

    const { sql, sqlCount, params, values, queryParams } = sutartysFilter.build(
        query,
        {
            table: "sutartys",
            fixedWhere: FIXED_WHERE,
            limit,
            page,
            sort,
        },
    );

    if (stream) {
        const client = await postgres.connect();
        return {
            results: [],
            total: null,
            values,
            queryParams,
            stream: client.query(new QueryStream(sql, params)).pipe(
                new Transform({
                    objectMode: true,
                    transform(row, _enc, cb) {
                        cb(null, aptvarkytiRezultata(row));
                    },
                }),
            ),
            client,
        };
    }

    const { rows } = await postgres.query(sql, params);
    return {
        results: rows.map(aptvarkytiRezultata),
        total: null,
        values,
        queryParams,
        stream: null,
        client: null,
    };
}

/**
 * Returns a precise COUNT of sutartys rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countSutartys(query) {
    const { sqlCount, params, visiIrasai } = sutartysFilter.build(query, {
        table: "sutartys",
        fixedWhere: FIXED_WHERE,
    });

    if (visiIrasai) {
        const { rows } = await postgres.query(
            `SELECT "rowCount" FROM "eiluciuSkaiciai" WHERE "tableName" = 'sutartys'`,
        );
        return Number(rows[0].rowCount);
    }

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}

/**
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiRezultata(r) {
    if (r.id) {
        r.sutartiesUnikalusId = r.id;
        delete r.id;
    }
    if (r.sutartiesUnikalusID) {
        r.id = r.sutartiesUnikalusID;
        delete r.sutartiesUnikalusID;
    }

    r.bvpzKodai = [r.bvpzKodas, ...(r.papildomiBvpzKodai ?? [])];
    delete r.bvpzKodas;
    delete r.papildomiBvpzKodai;

    r.bvpzPavadinimai = [
        r.bvpzPavadinimas,
        ...(r.papildomiBvpzPavadinimai ?? []),
    ];
    delete r.bvpzPavadinimas;
    delete r.papildomiBvpzPavadinimai;

    r.tiekejai = [r.tiekejas, ...(r.papildomiTiekejai ?? [])];
    delete r.tiekejas;
    delete r.papildomiTiekejai;

    r.tiekejaiKodai = [r.tiekejoKodas, ...(r.papildomiTiekejaiKodai ?? [])];
    delete r.tiekejoKodas;
    delete r.papildomiTiekejaiKodai;

    r.pavadinimas = fixHtmlEntities(r.pavadinimas);
    r.perkanciojiOrganizacija = fixHtmlEntities(r.perkanciojiOrganizacija);
    r.tiekejai = r.tiekejai.map(fixHtmlEntities);

    const tipo = (r.tipas || "").trim().toUpperCase();
    r.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    return r;
}

/**
 * Async generator that paginates through ALL Typesense results.
 * Yields one processed row at a time.
 * @param {object} query
 * @returns {AsyncGenerator<object>}
 */
export async function* streamTypesenseResults(query) {
    const { filterBy, sortBy } = sutartysFilter.build(query);
    const pageSize = 250;
    let page = 1;
    let fetched = 0;
    let total = Infinity;

    while (fetched < total) {
        const { results, total: t } = await searchDocuments(
            query.search || "*",
            { page, filterBy, sortBy, limit: pageSize },
        );

        if (page === 1) total = t;
        if (!results.length) break;

        for (const row of arrayToLithuanianTime(results).map(
            aptvarkytiRezultata,
        )) {
            yield row;
        }

        fetched += results.length;
        page++;
    }
}

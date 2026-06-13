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
            tsCol: "sutartiesUnikalusId",
            type: "integer",
            hidden: true,
        },
        { key: "tipas", hidden: true },
        {
            key: "sudarymoDataNuo",
            col: `"sudarymoData"`,
            tsCol: "sudarymoData",
            type: "gte_date",
            hidden: true,
        },
        {
            key: "sudarymoDataIki",
            col: `"sudarymoData"`,
            tsCol: "sudarymoData",
            type: "lte_date",
            hidden: true,
        },
        { key: "verteNuo", col: `"verte"`, tsCol: "verte", type: "gte_number", hidden: true },
        { key: "verteIki", col: `"verte"`, tsCol: "verte", type: "lte_number", hidden: true },
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
        },
});

const FIXED_WHERE = [`NOT COALESCE("istrinta", false)`];

export function getSutartysQueryMetadata(query) {
    const { values, queryParams } = sutartysFilter.build(query);
    return { values, queryParams };
}

// Visi sutarčių stulpeliai išskyrus search_tsv — sugeneruotas tsvector yra
// didelis ir rezultatuose nereikalingas (nutekėtų ir į MCP atsakymus).
export const SUTARTYS_COLUMNS = [
    `"sutartiesUnikalusId"`, `"pavadinimas"`, `"bvpzKodas"`, `"bvpzPavadinimas"`,
    `"dokumentai"`, `"dokumentuKiekis"`, `"faktineIvykdimoData"`, `"faktineIvykdimoVerte"`,
    `"galiojimoData"`, `"kategorija"`, `"paskelbimoData"`, `"paskutinioAtnaujinimoData"`,
    `"paskutinioRedagavimoData"`, `"perkanciojiOrganizacija"`, `"perkanciosiosOrganizacijosKodas"`,
    `"sudarymoData"`, `"sutartiesNumeris"`, `"tiekejas"`, `"tiekejoKodas"`, `"tipas"`,
    `"verte"`, `"pirkimoNumeris"`, `"papildomiTiekejai"`, `"papildomiTiekejaiKodai"`,
    `"papildomiBvpzKodai"`, `"papildomiBvpzPavadinimai"`, `"paskutiniKartaMatyta"`,
    `"suma"`, `"istrinta"`, `"paskutiniKartaAtnaujinta"`,
].join(", ");

/**
 * Loads complete contract rows from PostgreSQL while preserving Typesense order.
 * Missing or deleted PostgreSQL rows are omitted.
 * @param {{ id?: string | number }[]} typesenseRows
 * @returns {Promise<object[]>}
 */
async function loadTypesenseRowsFromPostgres(typesenseRows) {
    const ids = typesenseRows
        .map((row) => Number(row.id))
        .filter(Number.isSafeInteger);

    if (ids.length === 0) return [];

    const { rows } = await postgres.query(
        `SELECT ${SUTARTYS_COLUMNS}
         FROM sutartys
         WHERE "sutartiesUnikalusId" = ANY($1::int[])
           AND NOT COALESCE(istrinta, false)`,
        [ids],
    );
    const rowsById = new Map(
        rows.map((row) => [Number(row.sutartiesUnikalusId), row]),
    );

    return ids.map((id) => rowsById.get(id)).filter(Boolean);
}

/**
 * @typedef {"postgres" | "typesense"} Engine
 */

/**
 * @typedef {object} SearchOptions
 * @property {number | null} [limit] - Rows per page.
 * @property {number} [page=1] - Current page number.
 * @property {Engine} [engine="postgres"] - Search engine to use.
 * @property {boolean} [stream=false] - Return a raw stream instead of rows.
 *   When true, caller must release the returned `client`.
 * @property {boolean} [sort=true] - Whether to apply default sorting.
 * @property {boolean} [includeAggregates=false] - Compute matching row count and
 *   value sum for selective entity filters.
 */

/**
 * @typedef {Record<string, any> & {
 *   sutartiesUnikalusId: string | number,
 *   tipas: string,
 *   kategorija: string,
 *   perkanciosiosOrganizacijosKodas: string,
 *   perkanciojiOrganizacija: string,
 *   pavadinimas: string,
 *   tiekejai: string[],
 *   tiekejaiKodai: string[],
 *   bvpzKodai: string[]
 * }} ContractSearchRow
 */

/**
 * @typedef {object} SearchResult
 * @property {ContractSearchRow[]} results - Processed rows. Empty when streaming.
 * @property {number | null} total - Total matching rows. Null if count timed out.
 * @property {number | null} sutarciuKiekis - Matching row count when aggregates were requested.
 * @property {number | null} bendraVerte - Matching value sum when aggregates were requested.
 * @property {object} values - Resolved filter values for form repopulation.
 * @property {string} queryParams - URL query string fragment for pagination links.
 * @property {{label: string, phase: string, start: number, duration: number}[]} timings
 * @property {import("node:stream").Readable | null} stream - Raw stream, or null.
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
    {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeAggregates = false,
    } = {},
) {
    const searchStarted = performance.now();

    if (engine === "typesense") {
        const { filterBy, sortBy, values, queryParams } =
            sutartysFilter.build(query);

        if (stream) {
            return {
                results: [],
                total: null,
                values,
                queryParams,
                timings: [],
                stream: Readable.from(streamTypesenseResults(query, limit)),
                client: null,
            };
        }

        const typesenseStarted = performance.now();
        const { results: raw, total } = await searchDocuments(
            query.search || "*",
            { page, filterBy, sortBy, limit },
        );
        const typesenseEnded = performance.now();

        const postgresStarted = performance.now();
        const rows = await loadTypesenseRowsFromPostgres(raw);
        const postgresEnded = performance.now();
        return {
            results: arrayToLithuanianTime(rows).map(aptvarkytiRezultata),
            total,
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [
                {
                    label: "Typesense",
                    phase: "search",
                    start: Math.round(typesenseStarted - searchStarted),
                    duration: Math.round(typesenseEnded - typesenseStarted),
                },
                {
                    label: "PostgreSQL",
                    phase: "pg",
                    start: Math.round(postgresStarted - searchStarted),
                    duration: Math.round(postgresEnded - postgresStarted),
                },
            ],
            stream: null,
            client: null,
        };
    }

    const { sql, sqlCount, params, paramsCount, values, queryParams } =
        sutartysFilter.build(query, {
            table: "sutartys",
            select: SUTARTYS_COLUMNS,
            fixedWhere: FIXED_WHERE,
            limit,
            page,
            sort,
        });

    if (stream) {
        const client = await postgres.connect();
        return {
            results: [],
            total: null,
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [],
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

    // Only compute aggregates when a selective entity filter is present.
    // Date/value-only ranges can span millions of rows — too slow for a SUM scan.
    const SELECTIVE_KEYS = [
        "tiekejoKodas",
        "perkanciosiosOrganizacijosKodas",
        "sutartiesNumeris",
        "pirkimoNumeris",
        "sutartiesUnikalusID",
    ];
    const needsAgg =
        includeAggregates && SELECTIVE_KEYS.some((k) => query[k] != null);

    // "suma" = faktineIvykdimoVerte when settled, otherwise verte — same as Typesense index
    const mainQuery = postgres.query(sql, params);
    const aggQuery = needsAgg
        ? postgres.query(
              sqlCount.replace(
                  "SELECT COUNT(*)",
                  `SELECT COUNT(*) AS kiekis, COALESCE(SUM("suma"), 0) AS "bendraVerte"`,
              ),
              paramsCount,
          )
        : Promise.resolve(null);

    const [{ rows }, aggResult] = await Promise.all([mainQuery, aggQuery]);
    const postgresEnded = performance.now();

    return {
        results: rows.map(aptvarkytiRezultata),
        total: null,
        sutarciuKiekis: aggResult ? parseInt(aggResult.rows[0].kiekis, 10) : null,
        bendraVerte: aggResult ? parseFloat(aggResult.rows[0].bendraVerte) : null,
        values,
        queryParams,
        timings: [
            {
                label: "PostgreSQL",
                phase: "pg",
                start: 0,
                duration: Math.round(postgresEnded - searchStarted),
            },
        ],
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
 * @param {Record<string, any>} r
 * @returns {ContractSearchRow}
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

    if (r.dokumentai) {
        delete r.dokumentai;
    }

    return /** @type {ContractSearchRow} */ (r);
}

/**
 * Async generator that paginates through Typesense results.
 * Yields one processed row at a time.
 * @param {object} query
 * @param {number | null} [limit=null] - Maximum number of Typesense hits to process.
 * @returns {AsyncGenerator<object>}
 */
export async function* streamTypesenseResults(query, limit = null) {
    const { filterBy, sortBy } = sutartysFilter.build(query);
    const pageSize = 250;
    let page = 1;
    let fetched = 0;
    let total = Infinity;

    while (fetched < total && (limit == null || fetched < limit)) {
        const { results, total: t } = await searchDocuments(
            query.search || "*",
            { page, filterBy, sortBy, limit: pageSize },
        );

        if (page === 1) total = t;
        if (!results.length) break;

        const remaining = limit == null ? results : results.slice(0, limit - fetched);
        const rows = await loadTypesenseRowsFromPostgres(remaining);
        for (const row of arrayToLithuanianTime(rows).map(
            aptvarkytiRezultata,
        )) {
            yield row;
        }

        fetched += results.length;
        page++;
    }
}

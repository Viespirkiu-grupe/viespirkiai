import { Transform } from "node:stream";
import { postgres } from "../../../postgres/postgres.js";
import { streamQuery } from "../../../postgres/streamQuery.js";
import { search as quickwitSearch } from "../../../quickwit/quickwit.js";
import { createTtlPromiseCache } from "../../../utils/ttlPromiseCache.js";
import { FIXED_WHERE, viesiejiPirkimaiFilter } from "./filter.js";
import {
    buildViesiejiPirkimaiQuickwitQuery,
    QUICKWIT_LENTELE,
    QUICKWIT_PAGE_SIZE,
    quickwitSortBy,
} from "./quickwitQuery.js";
import { viesiejiPirkimaiFacets } from "./facets.js";
import { aptvarkytiRezultata, loadQuickwitRowsFromPostgres } from "./rows.js";

const cachedHomepageSearch = createTtlPromiseCache(5_000);

/**
 * @typedef {object} SearchOptions
 * @property {number} limit - Rows per page.
 * @property {number} [page=1] - Current page number.
 * @property {"postgres" | "quickwit"} [engine="postgres"] - Search engine to use.
 * @property {boolean} [stream=false] - Return a raw stream instead of rows.
 */

/**
 * @typedef {object} SearchResult
 * @property {object[]} results
 * @property {number | null} total
 * @property {object} values
 * @property {string} queryParams
 * @property {import("pg-query-stream") | null} stream
 * @property {import("pg").PoolClient | null} client
 */

/**
 * Searches the viesiejiPirkimai table using Postgres.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
async function searchViesiejiPirkimaiUncached(
    query,
    { limit, page = 1, engine = "postgres", stream = false, sort = true, includeFacets = false } = {},
) {
    const searchStarted = performance.now();

    if (engine === "quickwit" && !stream) {
        const { values, queryParams } = viesiejiPirkimaiFilter.build(query);
        const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query);
        const effLimit = limit ?? QUICKWIT_PAGE_SIZE;

        const quickwitStarted = performance.now();
        // Pagrindinė paieška ir facetų agregacijos vyksta lygiagrečiai.
        const [result, facets] = await Promise.all([
            quickwitSearch(
                QUICKWIT_LENTELE,
                { query: qwQuery, sort_by: sort ? quickwitSortBy(query) : undefined },
                { minHits: page * effLimit },
            ),
            includeFacets ? viesiejiPirkimaiFacets(query) : Promise.resolve(null),
        ]);
        const quickwitEnded = performance.now();

        const pageHits = result.hits.slice((page - 1) * effLimit, page * effLimit);

        const postgresStarted = performance.now();
        const rows = await loadQuickwitRowsFromPostgres(pageHits);
        const postgresEnded = performance.now();

        return {
            results: rows.map(aptvarkytiRezultata),
            total: result.numHitsEstimate ?? result.hits.length,
            values,
            queryParams,
            facets,
            timings: [
                {
                    label: "Quickwit",
                    phase: "search",
                    start: Math.round(quickwitStarted - searchStarted),
                    duration: Math.round(quickwitEnded - quickwitStarted),
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

    const { sql, params, values, queryParams } =
        viesiejiPirkimaiFilter.build(query, {
            table: `"viesiejiPirkimai"`,
            fixedWhere: FIXED_WHERE,
            limit,
            page,
            sort,
        });

    if (stream) {
        // Jungtį valdo pats streamQuery (transakcija + release), todėl `client`
        // grąžinamas null – iškvietėjų `client?.release()` tampa no-op'u.
        const source = await streamQuery(sql, params);
        const out = source.pipe(
            new Transform({
                objectMode: true,
                transform(row, _enc, cb) {
                    cb(null, aptvarkytiRezultata(row));
                },
            }),
        );
        // pipe() destroy'aus neperduoda pirmyn – be šito nutrauktas atsisiuntimas
        // paliktų kursorių ir jungtį kaboti iki proceso pabaigos.
        out.on("close", () => source.destroy());

        return {
            results: [],
            total: null,
            values,
            queryParams,
            stream: out,
            client: null,
        };
    }

    const { rows } = await postgres.query(sql, params);
    return {
        results: rows.map(aptvarkytiRezultata),
        total: null,
        values,
        queryParams,
        timings: [
            {
                label: "PostgreSQL",
                phase: "pg",
                start: 0,
                duration: Math.round(performance.now() - searchStarted),
            },
        ],
        stream: null,
        client: null,
    };
}

export async function searchViesiejiPirkimai(query, options = {}) {
    const {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeFacets = false,
    } = options;
    const { visiIrasai, orderBy } = viesiejiPirkimaiFilter.build(query);

    if (stream || page !== 1 || !visiIrasai) {
        return searchViesiejiPirkimaiUncached(query, options);
    }

    const cacheKey = JSON.stringify({
        limit: limit ?? null,
        engine,
        sort,
        orderBy,
        includeFacets,
    });
    return cachedHomepageSearch(cacheKey, () =>
        searchViesiejiPirkimaiUncached(query, options),
    );
}

/**
 * Returns a precise COUNT of viesiejiPirkimai rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countViesiejiPirkimai(query) {
    const { sqlCount, params, visiIrasai } = viesiejiPirkimaiFilter.build(
        query,
        {
            table: `"viesiejiPirkimai"`,
            fixedWhere: FIXED_WHERE,
        },
    );

    if (visiIrasai) {
        const { rows } = await postgres.query(
            `SELECT "rowCount" FROM "eiluciuSkaiciai" WHERE "tableName" = 'viesiejiPirkimai'`,
        );
        if (rows[0] && rows[0].rowCount) {
            return Number(rows[0].rowCount);
        }
    }

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}


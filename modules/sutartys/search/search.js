import { Transform, Readable } from "node:stream";
import { search as quickwitSearch, countDocs as quickwitCountDocs } from "../../../quickwit/quickwit.js";
import { postgres } from "../../../postgres/postgres.js";
import { streamQuery } from "../../../postgres/streamQuery.js";
import { createTtlPromiseCache } from "../../../utils/ttlPromiseCache.js";
import {
    FIXED_WHERE,
    SUTARTYS_COLUMNS,
    SUTARTYS_FROM,
    sutartysFilter,
} from "./filter.js";
import {
    buildSutartysQuickwitQuery,
    QUICKWIT_LENTELE,
    QUICKWIT_PAGE_SIZE,
    quickwitSortBy,
    SUTARTYS_EXPORT_LIMIT,
} from "./quickwitQuery.js";
import { sutartysFacets, sutartysQuickwitAggregates } from "./facets.js";
import { sumaBaze } from "./sumaBaze.js";
import { iterateSutartysQuickwitExport } from "./export.js";
import { aptvarkytiRezultata, loadSearchRowsFromPostgres } from "./rows.js";

const cachedHomepageSearch = createTtlPromiseCache(5_000);

/**
 * @typedef {"postgres" | "quickwit"} Engine
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
 * @property {boolean} [includeFacets=false] - Compute Quickwit sidebar facets
 *   (only meaningful for the `quickwit` engine).
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
 * @property {{ tipas: object[], kategorija: object[], buyers: object[], suppliers: object[], bvpz: object[] } | null} [facets] - Quickwit sidebar facets when includeFacets is set.
 * @property {object} values - Resolved filter values for form repopulation.
 * @property {string} queryParams - URL query string fragment for pagination links.
 * @property {{label: string, phase: string, start: number, duration: number}[]} timings
 * @property {import("node:stream").Readable | null} stream - Raw stream, or null.
 * @property {import("pg").PoolClient | null} client - Live pg client when streaming, else null.
 */

/**
 * Searches the sutartys table using Postgres or Quickwit.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
async function searchSutartysUncached(
    query,
    {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeAggregates = false,
        includeFacets = false,
    } = {},
) {
    const searchStarted = performance.now();

    // Quickwit variklis naudojamas tik nestriminei paieškai — eksportai
    // (stream) tebeeina Postgres keliu žemiau. Rezultatų eilutės pilnai
    // užkraunamos iš Postgres išsaugant Quickwit tvarką.
    if (engine === "quickwit" && !stream) {
        const { values, queryParams } = sutartysFilter.build(query);

        const qwQuery = buildSutartysQuickwitQuery(query);
        const effLimit = limit ?? QUICKWIT_PAGE_SIZE;

        const quickwitStarted = performance.now();
        // Pagrindinė paieška ir facetų agregacijos vyksta lygiagrečiai.
        const aggregatePromise = includeAggregates
            ? sutartysQuickwitAggregates(query)
            : Promise.resolve({ sutarciuKiekis: null, bendraVerte: null });
        const [result, facets, aggregates] = await Promise.all([
            quickwitSearch(
                QUICKWIT_LENTELE,
                { query: qwQuery, sort_by: quickwitSortBy(query) },
                { minHits: page * effLimit },
            ),
            includeFacets ? sutartysFacets(query) : Promise.resolve(null),
            aggregatePromise,
        ]);
        const quickwitEnded = performance.now();

        const pageHits = result.hits.slice((page - 1) * effLimit, page * effLimit);

        const postgresStarted = performance.now();
        const rows = await loadSearchRowsFromPostgres(
            pageHits.map((h) => ({ id: h.sutartiesUnikalusId })),
        );
        const postgresEnded = performance.now();

        return {
            results: rows.map(aptvarkytiRezultata),
            total: result.numHitsEstimate ?? result.hits.length,
            sutarciuKiekis: aggregates.sutarciuKiekis,
            bendraVerte: aggregates.bendraVerte,
            facets,
            values,
            queryParams,
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

    // Eksportai (stream) su Quickwit varikliu: atrenkam atitinkančius įrašus per
    // Quickwit (kaip ir ekrane — su prefiksais/wildcard'ais), tada pilnas eilutes
    // užkraunam iš Postgres išsaugant Quickwit tvarką. Kitaip eksportas eitų per
    // Postgres pilnatekstę paiešką (`plainto_tsquery`), kuri `brok*` traktuoja kaip
    // tikslų leksemą ir grąžina kitą (dažnai tuščią) rinkinį nei rodoma ekrane.
    if (engine === "quickwit" && stream) {
        const { values, queryParams } = sutartysFilter.build(query);
        const effLimit = limit ?? SUTARTYS_EXPORT_LIMIT;

        return {
            results: [],
            total: null,
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [],
            stream: Readable.from(iterateSutartysQuickwitExport(query, { limit: effLimit }), { objectMode: true }),
            client: null,
        };
    }

    const { sql, sqlCount, params, paramsCount, values, queryParams } =
        sutartysFilter.build(query, {
            table: SUTARTYS_FROM,
            select: SUTARTYS_COLUMNS,
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
        // pipe() destroy'aus neperduoda pirmyn – be šito nutrauktas eksportas
        // paliktų kursorių ir jungtį kaboti iki proceso pabaigos.
        out.on("close", () => source.destroy());

        return {
            results: [],
            total: null,
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [],
            stream: out,
            client: null,
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

    // Suma — pagal pasirinktą sumos bazę: `s.verte` (faktinė, o jos nesant
    // numatyta), tik faktinė arba tik numatyta (žr. sumaBaze.js).
    const mainQuery = postgres.query(sql, params);
    const aggQuery = needsAgg
        ? postgres.query(
              sqlCount.replace(
                  "SELECT COUNT(*)",
                  `SELECT COUNT(*) AS kiekis, COALESCE(SUM(${sumaBaze(query).pg}), 0) AS "bendraVerte"`,
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

export async function searchSutartys(query, options = {}) {
    const {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeAggregates = false,
        includeFacets = false,
    } = options;
    const { visiIrasai, orderBy } = sutartysFilter.build(query);

    if (stream || page !== 1 || !visiIrasai) {
        return searchSutartysUncached(query, options);
    }

    const cacheKey = JSON.stringify({
        limit: limit ?? null,
        engine,
        sort,
        orderBy,
        includeAggregates,
        includeFacets,
    });
    return cachedHomepageSearch(cacheKey, () =>
        searchSutartysUncached(query, options),
    );
}

/**
 * Returns a precise COUNT of sutartys rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countSutartys(query) {
    const { sqlCount, params, visiIrasai } = sutartysFilter.build(query, {
        table: SUTARTYS_FROM,
        fixedWhere: FIXED_WHERE,
    });

    if (visiIrasai) {
        const { rows } = await postgres.query(
            `SELECT COUNT(*) AS "rowCount" FROM "vpmSutartys"."sutartys" WHERE istrinta = false`,
        );
        return Number(rows[0].rowCount);
    }

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}

/**
 * Įvertintas atitinkančių gyvų sutarčių skaičius per Quickwit — atspindi tą patį
 * rinkinį kaip ekrane (su prefiksais/wildcard'ais), skirtingai nei Postgres
 * `countSutartys`. Naudojama eksporto ribų tikrinimui, kai variklis — Quickwit.
 * @param {object} query
 * @returns {Promise<number>}
 */
export async function countSutartysQuickwit(query) {
    return quickwitCountDocs(QUICKWIT_LENTELE, {
        query: buildSutartysQuickwitQuery(query),
    });
}


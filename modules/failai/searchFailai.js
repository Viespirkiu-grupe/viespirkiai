import { arrayToLithuanianTime } from "../../utils/time.js";
import { postgres } from "../../postgres/postgres.js";
import { FilterBuilder } from "../../utils/filter.js";
import QueryStream from "pg-query-stream";

const failaiFilter = new FilterBuilder({
    fields: [
        {
            key: "extension",
            col: `"extension"`,
            type: "lowereq",
            hidden: true,
        },
        { key: "md5", col: `"md5"`, hidden: true },
        {
            key: "puslapiaiMin",
            col: `"puslapiuSkaicius"`,
            type: "gte_number",
            hidden: true,
        },
        {
            key: "puslapiaiMax",
            col: `"puslapiuSkaicius"`,
            type: "lte_number",
            hidden: true,
        },
        {
            key: "saltinis",
            hidden: true,
            pgOverride: (addParam, val) =>
                val === "sutartys"
                    ? `("saltinis" = ${addParam(val)} OR "saltinis" IS NULL)`
                    : `"saltinis" = ${addParam(val)}`,
        },
        {
            key: "telefonas",
            hidden: true,
            pgOverride: (addParam, val) => `
                EXISTS (
                    SELECT 1 FROM "failaiTelefonai" ft
                    WHERE ft.id = f.id AND ft.telefonas = ${addParam(val)}
                )`,
        },
        {
            key: "email",
            hidden: true,
            pgOverride: (addParam, val) => `
                EXISTS (
                    SELECT 1 FROM "failaiEmails" fe
                    WHERE fe.id = f.id AND fe.email = ${addParam(val)}
                )`,
        },
        {
            key: "domain",
            hidden: true,
            pgOverride: (addParam, val) => `
                EXISTS (
                    SELECT 1 FROM "failaiDomains" fd
                    WHERE fd.id = f.id AND fd.domain = ${addParam(val)}
                )`,
        },
        {
            key: "iban",
            hidden: true,
            pgOverride: (addParam, val) => `
                EXISTS (
                    SELECT 1 FROM "failaiIban" fi
                    WHERE fi.id = f.id AND fi.iban = ${addParam(val)}
                )`,
        },
        {
            key: "jarKodas",
            hidden: true,
            pgOverride: (addParam, val) => `
                EXISTS (
                    SELECT 1 FROM "failaiJarKodai" fj
                    WHERE fj.id = f.id AND fj."jarKodas" = ${addParam(val)}
                )`,
        },
        {
            key: "search",
            col: `f.search_index`,
            type: "tsvector",
            pgOnly: true,
        },
    ],
});

/**
 * @typedef {object} SearchOptions
 * @property {number} limit - Rows per page.
 * @property {number} [page=1] - Current page number.
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
 * Searches the failai table using Postgres.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
export async function searchFailai(
    query,
    { limit, page = 1, stream = false } = {},
) {
    const { sql, sqlCount, params, values, queryParams } = failaiFilter.build(
        query,
        {
            table: "failai f",
            limit,
            page,
        },
    );

    if (stream) {
        const client = await postgres.connect();
        return {
            results: [],
            total: null,
            values,
            queryParams,
            stream: client.query(new QueryStream(sql, params)),
            client,
        };
    }

    const { rows } = await postgres.query(sql, params);
    return {
        results: arrayToLithuanianTime(rows).map(aptvarkytiFailoRezultata),
        total: null,
        values,
        queryParams,
        stream: null,
        client: null,
    };
}

/**
 * Returns a COUNT(*) of failai rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countFailai(query) {
    const { sqlCount, params } = failaiFilter.build(query, {
        table: "failai f",
    });

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}

/**
 * Normalises a single failai row for API consumption.
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiFailoRezultata(r) {
    if (r.extension) {
        r.extension = r.extension.toLowerCase();
    }
    return r;
}

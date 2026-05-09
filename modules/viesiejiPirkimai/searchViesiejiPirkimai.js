import { postgres } from "../../postgres/postgres.js";
import { FilterBuilder } from "../../utils/filter.js";
import { fixHtmlEntities } from "../../utils/fixHtmlEntities.js";
import { Transform } from "node:stream";
import QueryStream from "pg-query-stream";
import { STATUSAS, PIRKIMO_BUDAS } from "./viesiejiPirkimaiEnums.js";

const viesiejiPirkimaiFilter = new FilterBuilder({
    fields: [
        {
            key: "pvJarKodas",
            col: `"jarKodas"`,
            hidden: true,
        },
        {
            key: "pirkimoId",
            hidden: true,
        },
        {
            key: "pirkimoBudas",
            hidden: true,
            enum: PIRKIMO_BUDAS,
        },
        {
            key: "statusas",
            hidden: true,
            enum: STATUSAS,
        },
        {
            key: "zingsnis",
            hidden: true,
        },
        {
            key: "type",
            hidden: true,
        },
        {
            key: "paskelbimoDataNuo",
            col: `"paskelbimoData"`,
            type: "gte_date",
            hidden: true,
        },
        {
            key: "paskelbimoDataIki",
            col: `"paskelbimoData"`,
            type: "lte_date",
            hidden: true,
        },
        {
            key: "pasiulymuTerminasNuo",
            col: `"pasiulymuPateikimoTerminas"`,
            type: "gte_date",
            hidden: true,
        },
        {
            key: "pasiulymuTerminasIki",
            col: `"pasiulymuPateikimoTerminas"`,
            type: "lte_date",
            hidden: true,
        },
        {
            key: "verteNuo",
            col: `"numatomaBendraPirkimoVerte"`,
            type: "gte_number",
            hidden: true,
        },
        {
            key: "verteIki",
            col: `"numatomaBendraPirkimoVerte"`,
            type: "lte_number",
            hidden: true,
        },
        {
            key: "search",
            col: `"searchTsv"`,
            type: "tsvector",
            pgOnly: true,
        },
        {
            key: "turinioNuskaitymas",
            type: "integer",
            hidden: true,
        },
        {
            key: "bvpzPrefiksai",
            hidden: true,
            pgOverride: (addParam, val) => {
                const ors = val
                    .split(/[\s,;]+/)
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .map((prefix) => {
                        const end = String(parseInt(prefix, 10) + 1).padStart(
                            prefix.length,
                            "0",
                        );
                        return `(code >= ${addParam(prefix.padEnd(8, "0"))} AND code < ${addParam(end.padEnd(8, "0"))})`;
                    });
                if (!ors.length) return null;
                return `"bvpzKodai" && ARRAY(SELECT code FROM "bvpzKodai" WHERE ${ors.join(" OR ")})`;
            },
        },
    ],
    sort: {
        default: "paskelbimoData",
        defaultDir: "desc",
        allowed: [
            "paskelbimoData",
            "pasiulymuPateikimoTerminas",
            "numatomaBendraPirkimoVerte",
        ],
    },
});

const FIXED_WHERE = [];

/**
 * @typedef {object} SearchOptions
 * @property {number} limit - Rows per page.
 * @property {number} [page=1] - Current page number.
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
export async function searchViesiejiPirkimai(
    query,
    { limit, page = 1, stream = false, sort = true } = {},
) {
    const { sql, params, values, queryParams } =
        viesiejiPirkimaiFilter.build(query, {
            table: `"viesiejiPirkimai"`,
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

/**
 * Normalises a single row from the DB.
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiRezultata(r) {
    r.pavadinimas = fixHtmlEntities(r.pavadinimas ?? "");
    r.pirkimoVykdytojas = fixHtmlEntities(r.pirkimoVykdytojas ?? "");
    r.informacija = fixHtmlEntities(r.informacija ?? "");

    return r;
}

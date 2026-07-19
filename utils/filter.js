/**
 * Escapes special characters for safe use in Typesense filter_by expressions.
 * @param {string} value
 * @returns {string}
 */
function sanitizeForTypesense(value) {
    if (typeof value !== "string") return value;
    return value.replace(/([:"<>=&|!()\[\]{}~*?\\/])/g, "\\$1");
}

/**
 * Coerces a raw string value to a number, replacing commas with dots.
 * Returns null if the result is NaN.
 * @param {string} raw
 * @returns {number | null}
 */
function coerceNumber(raw) {
    const n = parseFloat(String(raw).replace(",", "."));
    return isNaN(n) ? null : n;
}

/**
 * Coerces a raw string value to an integer.
 * Returns null if the result is NaN.
 * @param {string} raw
 * @returns {number | null}
 */
function coerceInteger(raw) {
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
}

/**
 * Coerces a raw string to a Unix timestamp (seconds).
 * Returns null if the date is invalid.
 * @param {string} raw
 * @returns {number | null}
 */
function coerceTimestamp(raw) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

/**
 * Coerces a raw string to an ISO date string.
 * Returns null if the date is invalid.
 * @param {string} raw
 * @returns {string | null}
 */
function coerceDate(raw) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Built-in comparison types. Each type defines how to render a filter into
 * a Postgres WHERE fragment and a Typesense filter_by fragment, and optionally
 * how to coerce the raw query string value before use.
 *
 * @type {Record<string, {
 *   coerce?: (raw: string) => unknown,
 *   pg: (col: string, addParam: (val: unknown) => string, val: unknown) => string,
 *   ts: (col: string, val: unknown) => string,
 * }>}
 */
const COMPARISON_TYPES = {
    eq: {
        pg: (col, addParam, val) => `${col} = ${addParam(val)}`,
        ts: (col, val) => `${col}:=${val}`,
    },
    lowereq: {
        pg: (col, addParam, val) => `LOWER(${col}) = LOWER(${addParam(val)})`,
        ts: (col, val) => `${col}:=${val.toLowerCase()}`,
    },
    neq: {
        pg: (col, addParam, val) => `${col} != ${addParam(val)}`,
        ts: (col, val) => `${col}:!=${val}`,
    },
    gt: {
        pg: (col, addParam, val) => `${col} > ${addParam(val)}`,
        ts: (col, val) => `${col}:>${val}`,
    },
    gte: {
        pg: (col, addParam, val) => `${col} >= ${addParam(val)}`,
        ts: (col, val) => `${col}:>=${val}`,
    },
    lt: {
        pg: (col, addParam, val) => `${col} < ${addParam(val)}`,
        ts: (col, val) => `${col}:<${val}`,
    },
    lte: {
        pg: (col, addParam, val) => `${col} <= ${addParam(val)}`,
        ts: (col, val) => `${col}:<=${val}`,
    },
    gte_number: {
        coerce: coerceNumber,
        pg: (col, addParam, val) => `${col} >= ${addParam(val)}`,
        ts: (col, val) => `${col}:>=${val}`,
    },
    lte_number: {
        coerce: coerceNumber,
        pg: (col, addParam, val) => `${col} <= ${addParam(val)}`,
        ts: (col, val) => `${col}:<=${val}`,
    },
    gte_date: {
        coerce: coerceDate,
        pg: (col, addParam, val) => `${col} >= ${addParam(val)}`,
        ts: (col, val) => `${col}:>=${coerceTimestamp(val)}`,
    },
    lte_date: {
        coerce: coerceDate,
        pg: (col, addParam, val) => `${col} <= ${addParam(val)}`,
        ts: (col, val) => `${col}:<=${coerceTimestamp(val)}`,
    },
    integer: {
        coerce: coerceInteger,
        pg: (col, addParam, val) => `${col} = ${addParam(val)}`,
        ts: (col, val) => `${col}:=${val}`,
    },
    like: {
        pg: (col, addParam, val) => `${col} ILIKE ${addParam(`%${val}%`)}`,
        ts: (col, val) => `${col}:=${val}`,
    },
    boolean: {
        pg: (col, addParam, val) =>
            `${col} = ${addParam(val === true || val === "true")}`,
        ts: (col, val) => `${col}:=${val ? "true" : "false"}`,
    },
    /** Postgres full-text search using plainto_tsquery or phraseto_tsquery (auto-detected). */
    tsvector: {
        pg: (col, addParam, val) => {
            const quoteMatch = val.match(/^"(.*)"$/);
            const fn = quoteMatch ? "phraseto_tsquery" : "plainto_tsquery";
            const clean = quoteMatch ? quoteMatch[1] : val;
            return `${col} @@ ${fn}('simple', ${addParam(clean)})`;
        },
        ts: (col, val) => `${col}:=${val}`,
    },
    /** Postgres array containment: column @> ARRAY[value] */
    array_contains: {
        pg: (col, addParam, val) => `${col} @> ARRAY[${addParam(val)}]`,
        ts: (col, val) => `${col}:=[${val}]`,
    },
    /** Postgres EXISTS subquery. Requires `subquery` to be set on the field definition. */
    exists: {
        pg: (col, addParam, val, extra) =>
            `EXISTS (${extra.subquery(addParam, val)})`,
        ts: (col, val) => `${col}:=${val}`,
    },
    /** Postgres ST_DWithin spatial filter. Expects val = "lat,lon" and extra.radius param key. */
    geo_radius: {
        pg: (col, addParam, val, extra) => {
            const [lat, lon] = val.split(",").map(parseFloat);
            const radius = parseFloat(extra.radius);
            if ([lat, lon, radius].some(isNaN)) return null;
            return `${col} IS NOT NULL AND ST_DWithin(${col}::geography, ST_SetSRID(ST_MakePoint(${addParam(lon)}, ${addParam(lat)}), 4326)::geography, ${addParam(radius)})`;
        },
        ts: () => null,
    },
    /**
     * Splits a space-separated string of numeric prefixes and generates range
     * conditions for each, matching any value that starts with that prefix.
     * Expects the column to be lexicographically comparable (e.g. a code string).
     */
    prefix_range: {
        pg: (col, addParam, val) => {
            const ors = val
                .split(" ")
                .map((p) => p.trim())
                .filter(Boolean)
                .map((prefix) => {
                    const end = String(parseInt(prefix, 10) + 1).padStart(
                        prefix.length,
                        "0",
                    );
                    return `(${col} >= ${addParam(prefix)} AND ${col} < ${addParam(end)})`;
                });
            return ors.length ? `(${ors.join(" OR ")})` : null;
        },
        ts: (col, val) => {
            const ors = val
                .split(" ")
                .map((p) => p.trim())
                .filter(Boolean)
                .map((prefix) => `${col}:=${prefix}*`);
            return ors.length ? `(${ors.join(" || ")})` : null;
        },
    },
};

/**
 * @typedef {object} FieldDefinition
 * @property {string} key - Query param key to read from the request.
 * @property {string} [col] - Column/field name in the database. Defaults to `key`.
 * @property {string} [tsCol] - Typesense field name if different from `col`.
 * @property {keyof COMPARISON_TYPES | string} [type="eq"] - Comparison type.
 * @property {boolean} [isBoolean] - Triggered by presence of the key rather than its value.
 * @property {boolean} [hidden] - Sets usedHiddenFields when this filter is applied.
 * @property {boolean} [pgOnly] - Only applies to Postgres queries.
 * @property {boolean} [tsOnly] - Only applies to Typesense queries.
 * @property {Function} [coerce] - Custom coercion function overriding the type default.
 * @property {object} [extra] - Extra data passed to the type renderer (e.g. subquery, radius).
 * @property {string} [pgOverride] - Raw Postgres WHERE fragment, bypasses type system entirely.
 * @property {string} [tsOverride] - Raw Typesense filter fragment, bypasses type system.
 */

/**
 * @typedef {object} SortConfig
 * @property {string} default - Default sort column.
 * @property {string} [defaultDir="desc"] - Default sort direction.
 * @property {string[]} allowed - Allowed sort column names.
 * @property {Record<string, string>} [pgAliases] - Maps query column names to Postgres column names.
 * @property {Record<string, string>} [tsAliases] - Maps query column names to Typesense field names.
 * @property {boolean} [nullsLast=false] - Appends NULLS LAST to Postgres sorting.
 */

/**
 * @typedef {object} FilterBuilderOptions
 * @property {FieldDefinition[]} fields - Filter field definitions.
 * @property {SortConfig} sort - Sort configuration.
 * @property {Record<string, object>} [customTypes] - Additional or overriding comparison types.
 */

/**
 * @typedef {object} BuildOptions
 * @property {string} [table] - Postgres FROM clause (required for SQL generation).
 * @property {string} [select="*"] - Postgres SELECT expression.
 * @property {string[]} [fixedWhere=[]] - WHERE clauses always applied regardless of query.
 * @property {number} [limit] - Rows per page (required for SQL generation).
 * @property {number} [page=1] - Current page number.
 */

/**
 * @typedef {object} BuiltFilter
 * @property {string} sql - Postgres SELECT query string.
 * @property {string} sqlCount - Postgres COUNT query string.
 * @property {unknown[]} params - Positional Postgres params.
 * @property {string} filterBy - Typesense filter_by string.
 * @property {string} sortBy - Typesense sort_by string.
 * @property {string} orderBy - Postgres ORDER BY clause fragment.
 * @property {object} values - Resolved values for SSR form repopulation.
 * @property {string} queryParams - URL query string fragment for pagination links.
 * @property {boolean} usedHiddenFields - Whether any hidden filters were applied.
 * @property {boolean} visiIrasai - True when no filters narrowed the result set.
 */

export class FilterBuilder {
    /**
     * Creates a reusable filter builder that produces both Postgres and Typesense
     * query representations from a single declarative field definition list.
     * @param {FilterBuilderOptions} options
     */
    constructor({ fields, sort, customTypes = {} }) {
        this.fields = fields;
        this.sort = sort;
        this.types = { ...COMPARISON_TYPES, ...customTypes };
    }

    /**
     * Builds Postgres SQL, Typesense filter_by, resolved values, and pagination
     * metadata from an Express-style query object.
     * @param {object} query - Express request query object.
     * @param {BuildOptions} [options={}]
     * @returns {BuiltFilter}
     */
    build(
        query,
        {
            table,
            select = "*",
            fixedWhere = [],
            limit,
            page = 1,
            sort = true,
        } = {},
    ) {
        const params = [];
        const addParam = (val) => {
            params.push(val);
            return `$${params.length}`;
        };
        const whereClauses = [...fixedWhere];
        const tsFilters = [];
        const values = {};
        const queryParams = [];
        let usedHiddenFields = false;
        let visiIrasai = true;

        for (const field of this.fields) {
            const rawQuery = query[field.key];
            const raw = field.enum ? (field.enum[rawQuery] ?? null) : rawQuery;

            const active = field.isBoolean
                ? raw !== undefined
                : raw?.length > 0;
            if (!active) continue;

            const type = this.types[field.type ?? "eq"];
            if (!type) throw new Error(`Unknown filter type: ${field.type}`);

            const coerce = field.coerce ?? type.coerce ?? ((v) => v);
            const val = field.isBoolean ? true : coerce(raw);
            if (val === null) continue;

            const col = field.col ?? `"${field.key}"`;
            const tsCol = field.tsCol ?? field.col ?? field.key;

            if (!field.tsOnly) {
                const pgFragment = field.pgOverride
                    ? field.pgOverride(addParam, val, query)
                    : type.pg(col, addParam, val, field.extra ?? {});
                if (pgFragment) whereClauses.push(pgFragment);
            }

            if (!field.pgOnly) {
                const tsFragment = field.tsOverride
                    ? field.tsOverride(val)
                    : type.ts(
                          tsCol,
                          sanitizeForTypesense(String(val)),
                          field.extra ?? {},
                      );
                if (tsFragment) tsFilters.push(tsFragment);
            }

            if (field.hidden) usedHiddenFields = true;
            visiIrasai = false;

            if (field.isBoolean) {
                values[field.key] = true;
                queryParams.push(`${field.key}=true`);
            } else {
                values[field.key] = rawQuery;
                queryParams.push(
                    `${field.key}=${encodeURIComponent(rawQuery)}`,
                );
            }
        }

        const { orderBy, sortBy } = this._resolveSort(
            query,
            values,
            queryParams,
        );

        const where = whereClauses.length
            ? "WHERE " + whereClauses.join(" AND ")
            : "";
        const qStr = queryParams.length ? "&" + queryParams.join("&") : "";

        let sql = "";
        const paramsCount = [...params];
        let sqlCount = `SELECT COUNT(*) FROM ${table} ${where};`;

        if (table) {
            const orderClause = sort && orderBy ? ` ORDER BY ${orderBy}` : "";
            if (limit) {
                const limitParam = addParam(limit);
                const offsetParam = addParam(Math.max((page - 1) * limit, 0));
                sql = `SELECT ${select} FROM ${table} ${where} ${orderClause} LIMIT ${limitParam} OFFSET ${offsetParam};`;
            } else {
                sql = `SELECT ${select} FROM ${table} ${where} ${orderClause};`;
            }
        }

        return {
            sql,
            sqlCount,
            params,
            paramsCount,
            filterBy: tsFilters.join(" && "),
            sortBy,
            orderBy,
            values,
            queryParams: qStr,
            usedHiddenFields,
            visiIrasai,
        };
    }

    /**
     * Resolves sort column and direction from query params, validating against
     * the configured allowed list and falling back to configured defaults.
     * Mutates `values` and `queryParams` with the resolved sort state.
     * @param {object} query
     * @param {object} values
     * @param {string[]} queryParams
     * @returns {{ orderBy: string, sortBy: string }}
     */
    _resolveSort(query, values, queryParams) {
        if (!this.sort || !this.sort.default) {
            return { orderBy: null, sortBy: null };
        }

        const {
            default: def,
            defaultDir = "desc",
            allowed,
            pgAliases = {},
            tsAliases = {},
            nullsLast = false,
        } = this.sort;
        const allowedSet = new Set(allowed);

        const col = query.sort && allowedSet.has(query.sort) ? query.sort : def;
        const dir = ["asc", "desc"].includes(
            (query.sortDir || "").toLowerCase(),
        )
            ? query.sortDir.toLowerCase()
            : defaultDir;

        if (query.sort) {
            values.sort = col;
            values.sortDir = dir;
            queryParams.push(
                `sort=${encodeURIComponent(col)}`,
                `sortDir=${encodeURIComponent(dir)}`,
            );
        }

        const pgCol = pgAliases[col] ?? col;
        const tsCol = tsAliases[col] ?? col;

        return {
            orderBy: `"${pgCol}" ${dir.toUpperCase()}${nullsLast ? " NULLS LAST" : ""}`,
            sortBy: `${tsCol}:${dir}`,
        };
    }
}

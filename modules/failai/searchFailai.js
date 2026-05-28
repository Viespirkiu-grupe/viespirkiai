import { arrayToLithuanianTime } from "../../utils/time.js";
import { postgres } from "../../postgres/postgres.js";
import { FilterBuilder } from "../../utils/filter.js";
import QueryStream from "pg-query-stream";
import { Transform } from "stream";
import config from "../../utils/config.js";
import { search, countDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
import { readMetaduomenysFs } from "./metaduomenysFs.js";
import { readTekstasFs } from "./tekstasFs.js";

const SNIPPET_CONCURRENCY = 32;
export const SNIPPET_LEAD = 150;
export const SNIPPET_LEN = 400;

export async function buildSnippets(rows, positionTerm, readFn = readTekstasFs) {
    let cursor = 0;
    const out = new Array(rows.length);
    const needle = positionTerm ? foldLithuanian(positionTerm).toLowerCase() : null;
    await Promise.all(
        Array.from({ length: Math.min(SNIPPET_CONCURRENCY, rows.length) }, async () => {
            while (cursor < rows.length) {
                const i = cursor++;
                const hash = rows[i].tekstasHash;
                if (!hash) { out[i] = null; continue; }
                const raw = await readFn(hash);
                if (!raw) { out[i] = null; continue; }
                if (needle) {
                    const pos = foldLithuanian(raw).toLowerCase().indexOf(needle);
                    const start = pos < 0 ? 0 : Math.max(0, pos - SNIPPET_LEAD);
                    out[i] = raw.slice(start, start + SNIPPET_LEN);
                } else {
                    out[i] = raw.slice(0, SNIPPET_LEN);
                }
            }
        }),
    );
    return out;
}

async function attachMetaduomenys(rows) {
    await Promise.all(rows.map(async (r) => {
        if (r.metaduomenysHash) {
            r.metaduomenys = await readMetaduomenysFs(r.metaduomenysHash);
        }
    }));
    return rows;
}

function metaduomenysTransform() {
    return new Transform({
        objectMode: true,
        async transform(row, _enc, cb) {
            try {
                if (row?.metaduomenysHash) {
                    row.metaduomenys = await readMetaduomenysFs(row.metaduomenysHash);
                }
                cb(null, row);
            } catch (err) {
                cb(err);
            }
        },
    });
}

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
            hidden: true,
            pgOnly: true,
            // PG full-text on tekstas was removed (broken + column is being dropped).
            // search-only queries must go through Quickwit; PG path no longer filters by tekstas.
            pgOverride: () => null,
        },
        {
            key: "location",
            hidden: true,
            pgOnly: true,
            pgOverride: (addParam, val, query) => {
                const [latStr, lngStr] = val.split(",");
                const lat = parseFloat(latStr);
                const lng = parseFloat(lngStr);
                if (isNaN(lat) || isNaN(lng)) return null;

                const radius = parseFloat(query?.locationRadius) || 10;

                return `ST_DWithin(
                    f.location,
                    ST_SetSRID(ST_MakePoint(${addParam(lng)}, ${addParam(lat)}), 4326)::geography,
                    ${addParam(radius)}
                )`;
            },
        },
    ],
});

// ── Quickwit helpers ──────────────────────────────────────────────────────────

function foldLithuanian(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

function escapeQwTerm(val) {
    return val.replace(/[+,^`:{}"[\]()\~!\\* ]/g, "\\$&");
}

/**
 * Translates Express query params into a Quickwit query string.
 * Only handles fields that are stored in the Quickwit index.
 */
function buildQuickwitQuery(query) {
    const parts = [];

    if (query.search) {
        const s = query.search.trim();
        const isPhrase = /^".*"$/.test(s);
        if (isPhrase) {
            const inner = foldLithuanian(s.slice(1, -1)).replace(/"/g, '\\"');
            parts.push(`(tekstas:"${inner}" OR pavadinimas:"${inner}" OR autorius:"${inner}")`);
        } else {
            const folded = foldLithuanian(s.replace(/"/g, ""));
            parts.push(`(tekstas:${folded} OR pavadinimas:${folded} OR autorius:${folded})`);
        }
    }

    if (query.extension) {
        parts.push(`extension:${escapeQwTerm(query.extension.toLowerCase())}`);
    }

    if (query.saltinis) {
        if (query.saltinis === "sutartys") {
            parts.push(`(saltinis:sutartys OR NOT saltinis:*)`);
        } else {
            parts.push(`saltinis:${escapeQwTerm(query.saltinis)}`);
        }
    }

    if (query.puslapiaiMin) {
        const n = parseInt(query.puslapiaiMin, 10);
        if (!isNaN(n)) parts.push(`puslapiuSkaicius:>=${n}`);
    }

    if (query.puslapiaiMax) {
        const n = parseInt(query.puslapiaiMax, 10);
        if (!isNaN(n)) parts.push(`puslapiuSkaicius:<=${n}`);
    }

    return parts.length ? parts.join(" AND ") : "*";
}

/** Only use Quickwit when there is a full-text search term and no PG-only filters
 *  (telefonas, email, domain, iban, jarKodas, location, md5) that would require
 *  post-filtering and break pagination/counts. */
function hasQuickwitFilters(query) {
    if (!query.search) return false;
    const pgOnlyFields = ['telefonas', 'email', 'domain', 'iban', 'jarKodas', 'location', 'md5'];
    return !pgOnlyFields.some((f) => !!query[f]);
}

/**
 * Builds the extra WHERE conditions and params for fields NOT in the Quickwit
 * index (telefonas, email, domain, iban, jarKodas, location, md5).
 */
function buildPgOnlyFilters(query) {
    const conditions = [];
    const params = [];
    const addParam = (v) => {
        params.push(v);
        return `$${params.length}`;
    };

    if (query.md5) {
        conditions.push(`f.md5 = ${addParam(query.md5)}`);
    }
    if (query.telefonas) {
        conditions.push(`EXISTS (
            SELECT 1 FROM "failaiTelefonai" ft
            WHERE ft.id = f.id AND ft.telefonas = ${addParam(query.telefonas)}
        )`);
    }
    if (query.email) {
        conditions.push(`EXISTS (
            SELECT 1 FROM "failaiEmails" fe
            WHERE fe.id = f.id AND fe.email = ${addParam(query.email)}
        )`);
    }
    if (query.domain) {
        conditions.push(`EXISTS (
            SELECT 1 FROM "failaiDomains" fd
            WHERE fd.id = f.id AND fd.domain = ${addParam(query.domain)}
        )`);
    }
    if (query.iban) {
        conditions.push(`EXISTS (
            SELECT 1 FROM "failaiIban" fi
            WHERE fi.id = f.id AND fi.iban = ${addParam(query.iban)}
        )`);
    }
    if (query.jarKodas) {
        conditions.push(`EXISTS (
            SELECT 1 FROM "failaiJarKodai" fj
            WHERE fj.id = f.id AND fj."jarKodas" = ${addParam(query.jarKodas)}
        )`);
    }
    if (query.location) {
        const [latStr, lngStr] = query.location.split(",");
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (!isNaN(lat) && !isNaN(lng)) {
            const radius = parseFloat(query.locationRadius) || 10;
            conditions.push(`ST_DWithin(
                f.location,
                ST_SetSRID(ST_MakePoint(${addParam(lng)}, ${addParam(lat)}), 4326)::geography,
                ${addParam(radius)}
            )`);
        }
    }

    return { conditions, params };
}


const QW_MIN_HITS = 50;

// ── Public API ────────────────────────────────────────────────────────────────

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
 * @property {boolean} usedHiddenFields
 * @property {string} engine - "Quickwit" or "PostgreSQL"
 */

/**
 * Searches the failai table.
 * Uses Quickwit when config.quickwitUp and the query has QW-translatable filters;
 * falls back to Postgres otherwise.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
export async function searchFailai(
    query,
    { limit, page = 1, stream = false } = {},
) {
    const { sql, params, sqlCount, paramsCount, values, queryParams, usedHiddenFields } =
        failaiFilter.build(query, {
            table: "failai f",
            limit,
            page,
        });

    if (stream) {
        const client = await postgres.connect();
        const raw = client.query(new QueryStream(sql, params));
        const enriched = raw.pipe(metaduomenysTransform());
        raw.on("error", (err) => enriched.destroy(err));
        return {
            results: [],
            total: null,
            values,
            queryParams,
            usedHiddenFields,
            engine: "PostgreSQL",
            stream: enriched,
            client,
        };
    }

    if (config.quickwitUp && hasQuickwitFilters(query)) {
        const qwQuery = buildQuickwitQuery(query);

        const needed = Math.max(page * limit, QW_MIN_HITS);
        const { hits, numHitsEstimate, rawExhausted, qwMs, filterMs } = await search(
            "failai",
            { query: qwQuery, search_field: "tekstas,pavadinimas,autorius" },
            { minHits: needed },
        );

        const pageHits = hits.slice((page - 1) * limit, page * limit);
        const ids = pageHits.map((h) => h.id);

        let rows = [];
        let pgMs = 0;
        if (ids.length > 0) {
            const { conditions, params: pgParams } = buildPgOnlyFilters(query);

            const idParam = `$${pgParams.length + 1}`;
            const extraWhere = conditions.length
                ? ` AND ${conditions.join(" AND ")}`
                : "";

            const pgStart = Date.now();
            // Locate the search term inside the full text in Postgres and return
            // a window around it. For multi-word non-phrase queries the full
            // string may not appear contiguously, so fall back to the first word.
            // POSITION returns 0 when not found → GREATEST(1, 0-150) = 1 → start.
            let positionTerm = null;
            if (query.search) {
                const s = query.search.trim();
                const isPhrase = /^".*"$/.test(s);
                const inner = foldLithuanian(isPhrase ? s.slice(1, -1) : s);
                positionTerm = isPhrase ? inner : inner.split(/\s+/)[0];
            }

            const { rows: pgRows } = await postgres.query(
                `SELECT * FROM failai f WHERE f.id = ANY(${idParam})${extraWhere}`,
                [...pgParams, ids],
            );

            const snippets = await buildSnippets(pgRows, positionTerm);
            const byId = new Map(
                pgRows.map((r, i) => [r.id, { ...r, snippet: snippets[i] ?? null }]),
            );
            rows = ids.map((id) => byId.get(id)).filter(Boolean);
            pgMs = Date.now() - pgStart;
        }

        if (config.dev) log(`qw=${qwMs}ms filter=${filterMs}ms pg=${pgMs}ms hits=${hits.length}/${needed}`);

        // When Quickwit exhausts its results, its tokenization may differ from
        // Postgres (e.g. "a" matches 39 in QW vs 7000+ via Postgres ###). Return
        // null so the route falls back to countFailai for an accurate Postgres count.
        // When not exhausted, QW has plenty of hits and the estimate is meaningful.
        const total = rawExhausted ? null : Math.round(numHitsEstimate);

        const qwUsedHiddenFields = ['extension', 'saltinis', 'puslapiaiMin', 'puslapiaiMax', 'telefonas', 'email', 'domain', 'iban', 'jarKodas', 'location', 'md5']
            .some((f) => !!query[f]);

        await attachMetaduomenys(rows);

        return {
            results: arrayToLithuanianTime(rows).map(aptvarkytiFailoRezultata),
            total,
            approximate: !rawExhausted,
            values,
            queryParams,
            usedHiddenFields: qwUsedHiddenFields,
            engine: "Quickwit",
            timings: [
                { label: "Quickwit", phase: "search", start: 0, duration: qwMs },
                { label: "Filtravimas", phase: "filter", start: qwMs, duration: filterMs },
                { label: "Ištraukos", phase: "pg", start: qwMs + filterMs, duration: pgMs },
            ],
            stream: null,
            client: null,
        };
    }

    const [{ rows }, { rows: countRows }] = await Promise.all([
        postgres.query(sql, params),
        postgres.query(sqlCount, paramsCount),
    ]);
    await attachMetaduomenys(rows);
    return {
        results: arrayToLithuanianTime(rows).map(aptvarkytiFailoRezultata),
        total: parseInt(countRows[0].count, 10),
        values,
        queryParams,
        usedHiddenFields,
        engine: "PostgreSQL",
        stream: null,
        client: null,
    };
}

/**
 * Returns a COUNT(*) of failai rows matching the given query.
 * Uses Quickwit estimate when config.quickwitUp; falls back to Postgres otherwise.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countFailai(query) {
    if (config.quickwitUp && hasQuickwitFilters(query)) {
        return countDocs("failai", { query: buildQuickwitQuery(query) });
    }

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

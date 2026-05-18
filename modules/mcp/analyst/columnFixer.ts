import { postgres } from "../../../postgres/postgres.js";
import { VIEW_METADATA } from "../tools/getSchema.js";
import { TABLE_WHITELIST } from "./validateSql.js";

export const MAX_AUTO_RETRIES = 5;

type ToolResult = {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
};

// Built synchronously from VIEW_METADATA at module init — no DB required.
const _viewMap = (() => {
    const m = new Map<string, string>();
    for (const meta of Object.values(VIEW_METADATA)) {
        for (const colStr of meta.columns) {
            const col = colStr.split(": ")[0];
            if (col !== col.toLowerCase()) m.set(col.toLowerCase(), col);
        }
    }
    return m;
})();

// Lazy-loaded promise that extends _viewMap with raw table columns from the DB.
// Cached after the first call; safe to call concurrently.
let _fullMapPromise: Promise<Map<string, string>> | null = null;

export async function getMixedCaseMap(): Promise<Map<string, string>> {
    if (_fullMapPromise) return _fullMapPromise;
    _fullMapPromise = _buildFullMap();
    return _fullMapPromise;
}

async function _buildFullMap(): Promise<Map<string, string>> {
    const map = new Map(_viewMap);
    try {
        const result = await postgres.query(
            `SELECT DISTINCT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [[...TABLE_WHITELIST]],
        );
        for (const { column_name } of result.rows) {
            if (column_name !== column_name.toLowerCase()) {
                map.set(column_name.toLowerCase(), column_name);
            }
        }
    } catch (_err) {
        // DB unavailable — keep the view-only map
    }
    return map;
}

// Extracts the lowercased column name from a PostgreSQL "does not exist" error message.
// Handles both quoted form:   column "pirkimonumeris" does not exist
// and unquoted qualified form: column d.pirkimonumeris does not exist
export function extractBadColumnName(errorText: string): string | null {
    const quotedMatch = errorText.match(/column "([^"]+)" does not exist/);
    if (quotedMatch) {
        // Strip any table-qualifier prefix (e.g. "d.pirkimonumeris" → "pirkimonumeris")
        const col = quotedMatch[1];
        const dotIdx = col.lastIndexOf(".");
        return dotIdx >= 0 ? col.slice(dotIdx + 1) : col;
    }
    // Unquoted form with optional table qualifier: column d.pirkimonumeris does not exist
    const unquotedMatch = errorText.match(/column (?:\w+\.)?(\w+) does not exist/);
    return unquotedMatch?.[1] ?? null;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces occurrences of a wrong-case column in a SQL string with the properly
 * quoted correct form.  Handles both quoted lowercase ("pirkejokodas") and unquoted
 * camelCase variants (pirkejoKodas, PIRKEJOKODAS, …).
 */
export function fixColumnInQuery(query: string, badColLower: string, correctCol: string): string {
    // 1. Replace quoted wrong-case: "pirkejokodas" → "pirkejoKodas"
    let fixed = query.replaceAll(`"${badColLower}"`, `"${correctCol}"`);

    // 2. Replace any unquoted case-insensitive occurrence that isn't already quoted
    //    or part of a longer identifier.
    //    Lookbehind: not preceded by " or a word character (avoids already-quoted or embedded).
    //    Lookahead:  not followed by a word character or " (avoids partial matches).
    const re = new RegExp(`(?<!["\\w])${escapeRegex(correctCol)}(?![\\w"])`, "gi");
    fixed = fixed.replace(re, `"${correctCol}"`);
    return fixed;
}

/**
 * Executes `runAttempt(query)` and, on a "column does not exist" error, attempts to
 * correct the column name case and retry — up to MAX_AUTO_RETRIES times total.
 */
export async function executeWithColumnFix(
    runAttempt: (query: string) => Promise<ToolResult>,
    initialQuery: string,
): Promise<ToolResult> {
    const errors: Array<{ attempt: number; query: string; error: string }> = [];
    let query = initialQuery;

    for (let attempt = 1; attempt <= MAX_AUTO_RETRIES; attempt++) {
        const result = await runAttempt(query);
        if (!result.isError) return result;

        const errorText = result.content?.[0]?.text ?? "";
        errors.push({ attempt, query, error: errorText });

        const badColLower = extractBadColumnName(errorText);
        if (!badColLower) break; // not a column-name error — stop immediately

        const map = await getMixedCaseMap();
        const correctCol = map.get(badColLower);
        if (!correctCol) break; // unknown column — nothing we can do

        const nextQuery = fixColumnInQuery(query, badColLower, correctCol);
        if (nextQuery === query) break; // replacement made no change — stop

        console.error(`[columnFixer] attempt ${attempt}: auto-correcting "${badColLower}" → "${correctCol}"`);
        query = nextQuery;
    }

    const text = errors
        .map((e) => `[attempt ${e.attempt}] ${e.error}`)
        .join("\n\n---\n\n");
    return {
        content: [{ type: "text", text }],
        isError: true,
    };
}

import {postgres} from "../../../postgres/postgres.js";
import {VIEW_METADATA} from "../tools/getSchema.js";
import {TABLE_WHITELIST} from "./validateSql.js";

type ToolResult = {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
};

// Maximum retry attempts when auto-correcting a wrong-case column name.
export const MAX_AUTO_RETRIES = 5;

// Lowercased → mixed-case column map seeded from VIEW_METADATA at module init. No DB required.
const _viewMap: Map<string, string> = buildViewMap();

// Extends _viewMap with raw DB table columns. Populated lazily on first getMixedCaseMap() call; safe to call concurrently.
let _fullMapPromise: Promise<Map<string, string>> | null = null;

function buildViewMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const meta of Object.values(VIEW_METADATA)) {
        for (const colStr of meta.columns) {
            const col = colStr.split(": ")[0];
            if (col !== col.toLowerCase()) m.set(col.toLowerCase(), col);
        }
    }
    return m;
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
        for (const {column_name} of result.rows) {
            if (column_name !== column_name.toLowerCase()) {
                map.set(column_name.toLowerCase(), column_name);
            }
        }
    } catch {
        // DB unavailable — keep the view-only map
    }
    return map;
}

export async function getMixedCaseMap(): Promise<Map<string, string>> {
    if (_fullMapPromise) return _fullMapPromise;
    _fullMapPromise = _buildFullMap();
    return _fullMapPromise;
}

export function extractBadColumnName(errorText: string): string | null {
    const quotedMatch = errorText.match(/column "([^"]+)" does not exist/);
    if (quotedMatch) {
        // Strip table-qualifier prefix: "d.pirkimonumeris" → "pirkimonumeris"
        const col = quotedMatch[1];
        const dotIdx = col.lastIndexOf(".");
        return dotIdx >= 0 ? col.slice(dotIdx + 1) : col;
    }
    const unquotedMatch = errorText.match(/column (?:\w+\.)?(\w+) does not exist/);
    return unquotedMatch?.[1] ?? null;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replaces wrong-case occurrences of a column in SQL with the properly quoted correct form.
export function fixColumnInQuery(query: string, badColLower: string, correctCol: string): string {
    // Quoted lowercase form: "pirkejokodas" → "pirkejoKodas"
    let fixed = query.replaceAll(`"${badColLower}"`, `"${correctCol}"`);

    // Any unquoted case variant; lookbehind/ahead prevents matching already-quoted or partial identifiers.
    const re = new RegExp(`(?<!["\\w])${escapeRegex(correctCol)}(?![\\w"])`, "gi");
    return fixed.replace(re, `"${correctCol}"`);
}

// Runs runAttempt(query) and retries on "column does not exist" errors by
// auto-correcting column name casing — up to MAX_AUTO_RETRIES times.
export async function executeWithColumnFix(
    runAttempt: (query: string) => Promise<ToolResult>,
    initialQuery: string,
): Promise<ToolResult> {
    const errors: Array<{ attempt: number; query: string; error: string }> = [];
    let query = initialQuery;

    for (let attempt = 1; attempt <= MAX_AUTO_RETRIES; attempt++) {
        const result = await runAttempt(query);
        if (!result.isError) return result;

        const errorText = result.content[0]?.text ?? "";
        errors.push({attempt, query, error: errorText});

        const badColLower = extractBadColumnName(errorText);
        if (!badColLower) break; // not a column-name error — stop immediately

        const map = await getMixedCaseMap();
        const correctCol = map.get(badColLower);
        if (!correctCol) break; // unknown column — nothing we can do

        const nextQuery = fixColumnInQuery(query, badColLower, correctCol);
        if (nextQuery === query) break; // replacement made no change — stop

        query = nextQuery;
    }

    const text = errors.map((e) => `[attempt ${e.attempt}] ${e.error}`).join("\n\n---\n\n");
    return {
        content: [{type: "text", text}],
        isError: true,
    };
}

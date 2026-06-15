/**
 * Preprocesses SQL before node-sql-parser validation.
 * Transforms PostgreSQL-specific constructs that the parser rejects
 * into semantically equivalent forms it can parse.
 * Pure and idempotent — no SQL parsing, only string transformations.
 */
export function normalizeSql(sql: string): string {
    return sql
        // 1. Collapse all whitespace (newlines, tabs, Unicode spaces) to a single ASCII space.
        //    Fixes: multi-line queries (§1.1) and diacritics failures in multi-line context (§1.8).
        .replace(/\s+/g, " ")
        .trim()
        // 2. IS DISTINCT FROM → IS NOT TRUE / IS NOT FALSE (semantically equivalent in PostgreSQL).
        //    Handle IS NOT DISTINCT FROM first to avoid double-replacement. Fixes §1.3.
        .replace(/\bIS\s+NOT\s+DISTINCT\s+FROM\s+true\b/gi, "IS TRUE")
        .replace(/\bIS\s+NOT\s+DISTINCT\s+FROM\s+false\b/gi, "IS FALSE")
        .replace(/\bIS\s+DISTINCT\s+FROM\s+true\b/gi, "IS NOT TRUE")
        .replace(/\bIS\s+DISTINCT\s+FROM\s+false\b/gi, "IS NOT FALSE");
}

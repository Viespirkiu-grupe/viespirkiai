import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Loads a .sql file packaged next to a Risk Indicator's definition.ts,
// cached after first read so a run doesn't re-read the file on every call.
const sqlCache = new Map<string, string>();

export function loadPackagedSql(callerUrl: string, relativePath: string): string {
    const baseDir = path.dirname(fileURLToPath(callerUrl));
    const absolutePath = path.resolve(baseDir, relativePath);

    const cached = sqlCache.get(absolutePath);
    if (cached !== undefined) return cached;

    const sql = fs.readFileSync(absolutePath, "utf8");
    sqlCache.set(absolutePath, sql);
    return sql;
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskDb } from "../../postgres/riskDb.js";

// Test-only `public` schema shared by every Risk Indicator's collect.it.ts:
// applies migrations/risk/test/001_public_test_tables.sql plus the real
// v_pirkimas/v_dalyviai view definitions (the same files the analyst MCP
// tool uses) onto the local risk-dev Postgres, so calculation tests run the
// real SQL against fixture rows — never against the real database. See
// docs/indicators-story/risk-service-architecture.md §8.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TEST_TABLES_SQL = path.join(ROOT, "migrations/risk/test/001_public_test_tables.sql");
const VIEW_FILES = [
    path.join(ROOT, "modules/mcp/analyst/views/v_pirkimas.sql"),
    path.join(ROOT, "modules/mcp/analyst/views/v_dalyviai.sql"),
];

const TEST_TABLES = [
    '"atn1atmestiPasiulymai"',
    '"atn1pasiulymuEile"',
    '"atn1dalyviai"',
    '"atn1ataskaitos"',
    '"vpmSutartys"',
    '"cvppViesiejiPirkimai"',
    '"viesiejiPirkimaiVykdytojai"',
    '"viesiejiPirkimai"',
    '"jarAsmenys"',
] as const;

let ensured = false;

export async function ensurePublicTestSchema(): Promise<void> {
    if (ensured) return;
    await riskDb.query(fs.readFileSync(TEST_TABLES_SQL, "utf8"));
    for (const viewFile of VIEW_FILES) {
        await riskDb.query(fs.readFileSync(viewFile, "utf8"));
    }
    ensured = true;
}

export async function truncateTestPublicTables(): Promise<void> {
    await riskDb.query(`TRUNCATE TABLE ${TEST_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

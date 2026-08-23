import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskDb } from "../../postgres/riskDb.js";

// Test-only `public` schema shared by every Risk Indicator's collect.it.ts
// and test/risk/procurementReader.it.ts: applies
// migrations/risk/test/001_public_test_tables.sql plus the risk service's own
// v_pirkimas_v2/v_pirkimo_dalis_v2/v_dalyviai_v2/v_pirkimo_pabaiga_v2 view
// definitions onto the local risk-dev Postgres, so calculation tests run the
// real SQL against fixture rows — never against the real database. See
// docs/indicators-story/risk-service-architecture-v2.md.
//
// The risk service queries its own _v2-suffixed views (see
// modules/mcp/analyst/views/v_pirkimas_v2.sql's header comment) rather than
// the shared analyst v_pirkimas/v_pirkimo_dalis/v_dalyviai, so it never
// depends on the shared views' column shape or naming drift.
// v_pirkimo_pabaiga_v2 has no shared analyst counterpart at all — see its
// own header comment.
//
// v_dalyviai_v2.sql reads xlsxPPA*-named tables — the real database renamed
// these from an earlier atn1*-named schema (see git history on
// modules/mcp/analyst/views/v_dalyviai.sql); the fixture tables below and in
// 001_public_test_tables.sql follow the current, real names.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TEST_TABLES_SQL = path.join(ROOT, "migrations/risk/test/001_public_test_tables.sql");
// v_pirkimo_dalis_v2 depends on v_dalyviai_v2, so it must apply after it.
// v_pirkimo_pabaiga_v2 has no dependency on any other view.
const VIEW_FILES = [
    path.join(ROOT, "modules/mcp/analyst/views/v_pirkimas_v2.sql"),
    path.join(ROOT, "modules/mcp/analyst/views/v_dalyviai_v2.sql"),
    path.join(ROOT, "modules/mcp/analyst/views/v_pirkimo_dalis_v2.sql"),
    path.join(ROOT, "modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql"),
];

const TEST_TABLES = [
    '"xlsxPPAatmestiPasiulymai"',
    '"xlsxPPAatmestuPasiulymuStatusai"',
    '"xlsxPPApasiulymuEile"',
    '"xlsxPPAproceduruPabaiga"',
    '"xlsxPPAdalyviai"',
    '"xlsxPPAataskaitos"',
    '"viesiejiPirkimaiDalys"',
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

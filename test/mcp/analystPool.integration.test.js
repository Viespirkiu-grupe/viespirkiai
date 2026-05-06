/**
 * Integration tests for the analyst pool and TEMP views.
 * Uses the existing read-only database user from config.js (pgUser / pgPassword)
 * so no separate mcp_analyst role is required to run these tests.
 *
 * Run individually:
 *   node --test test/mcp/analystPool.integration.test.js
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pkg from "pg";
import config from "../../utils/config.js";
import { TEMP_VIEWS_SQL } from "../../modules/mcp/analyst/tempViews.js";
import { VIEW_NAMES } from "../../modules/mcp/analyst/validateSql.js";

const { Pool } = pkg;

// Test pool: same credentials as the main app user but on the direct PG port
// (not PgBouncer) so TEMP views survive across queries on the same connection.
const testPool = new Pool({
    host: config.pgHost,
    port: config.pgPort,   // direct PostgreSQL port — TEMP views are session-scoped
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10_000,
    statement_cache_size: 0,
});

testPool.on("connect", (client) => {
    client.query(TEMP_VIEWS_SQL).catch(() => {});
});

// One shared client so all view tests run on the same backend connection,
// guaranteeing the TEMP views created on connect are still present.
let sharedClient;

async function getClient() {
    if (!sharedClient) sharedClient = await testPool.connect();
    return sharedClient;
}

after(async () => {
    if (sharedClient) sharedClient.release();
    await testPool.end();
});

// ---------------------------------------------------------------------------
// Pool connectivity
// ---------------------------------------------------------------------------

describe("analyst pool — connectivity", () => {
    it("connects and runs a simple query", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT 1 AS ok");
        assert.equal(rows[0].ok, 1);
    });
});

// ---------------------------------------------------------------------------
// TEMP views — presence after connect
// ---------------------------------------------------------------------------

describe("analyst pool — TEMP views are present after connect", () => {
    it("all 6 views exist in pg_temp schema", async () => {
        const client = await getClient();
        const { rows } = await client.query(`
            SELECT viewname
            FROM pg_views
            WHERE schemaname LIKE 'pg_temp%'
            ORDER BY viewname
        `);
        const found = new Set(rows.map((r) => r.viewname));
        for (const viewName of VIEW_NAMES) {
            assert.ok(found.has(viewName), `TEMP view '${viewName}' not found — pool.on('connect') may not have fired`);
        }
    });
});

// ---------------------------------------------------------------------------
// TEMP views — each view returns rows with expected columns
// ---------------------------------------------------------------------------

describe("v_company", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_company LIMIT 1");
        assert.ok(rows.length > 0, "v_company returned no rows");
        const row = rows[0];
        assert.ok("jarKodas" in row, "missing jarKodas");
        assert.ok("pavadinimas" in row, "missing pavadinimas");
        assert.ok("darbuotojai" in row, "missing darbuotojai");
        assert.ok("melagingisTiekejas" in row, "missing melagingisTiekejas");
        assert.ok("nepatikimasTiekejas" in row, "missing nepatikimasTiekejas");
    });
});

describe("v_sutartys", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_sutartys LIMIT 1");
        assert.ok(rows.length > 0, "v_sutartys returned no rows");
        const row = rows[0];
        assert.ok("sutartiesUnikalusId" in row, "missing sutartiesUnikalusId");
        assert.ok("pirkejas" in row, "missing pirkejas (joined from jarCsv)");
        assert.ok("tiekejas" in row, "missing tiekejas (joined from jarCsv)");
    });
});

describe("v_pirkimas", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_pirkimas LIMIT 1");
        assert.ok(rows.length > 0, "v_pirkimas returned no rows");
        const row = rows[0];
        assert.ok("pirkimoId" in row, "missing pirkimoId");
        assert.ok("organizatorius" in row, "missing organizatorius (joined from viesiejiPirkimaiVykdytojai)");
        assert.ok("numatomaVerteEUR" in row, "missing numatomaVerteEUR");
    });
});

describe("v_person_links", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_person_links LIMIT 1");
        assert.ok(rows.length > 0, "v_person_links returned no rows");
        const row = rows[0];
        assert.ok("jarKodas" in row, "missing jarKodas");
        assert.ok("vardas" in row, "missing vardas");
        assert.ok("imonesVardas" in row, "missing imonesVardas (joined from jarCsv)");
        assert.ok("rysioPobudzioPavadinimas" in row, "missing rysioPobudzioPavadinimas");
    });
});

describe("v_dalyviai", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_dalyviai LIMIT 1");
        assert.ok(rows.length > 0, "v_dalyviai returned no rows");
        const row = rows[0];
        assert.ok("pirkimoNumeris" in row, "missing pirkimoNumeris");
        assert.ok("tiekejoKodas" in row, "missing tiekejoKodas");
        assert.ok("tiekejas" in row, "missing tiekejas (joined from jarCsv)");
        assert.ok("pasiulymoKaina" in row, "missing pasiulymoKaina");
    });
});

describe("v_bylos", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        const { rows } = await client.query("SELECT * FROM v_bylos LIMIT 1");
        assert.ok(rows.length > 0, "v_bylos returned no rows");
        const row = rows[0];
        assert.ok("bylosId" in row, "missing bylosId");
        assert.ok("bylosNumeris" in row, "missing bylosNumeris");
        assert.ok("jarKodas" in row, "missing jarKodas");
        assert.ok("dalyvioPavadinimas" in row, "missing dalyvioPavadinimas (joined from jarCsv)");
        assert.ok("bylojeKaip" in row, "missing bylojeKaip");
    });
});

// ---------------------------------------------------------------------------
// Pagination wrapper — the same SQL used by executeInvestigationQuery
// ---------------------------------------------------------------------------

describe("pagination wrapper", () => {
    it("LIMIT n+1 trick: 51 rows fetched means hasMore is true", async () => {
        const client = await getClient();
        // Fetch 51 rows (PAGE_SIZE + 1); sutartys has far more than 50 rows
        const { rows } = await client.query(`
            SELECT q.* FROM (
                SELECT "sutartiesUnikalusId" FROM sutartys ORDER BY "sutartiesUnikalusId"
            ) AS q LIMIT 51 OFFSET 0
        `);
        assert.equal(rows.length, 51, "expected exactly 51 rows when table has >50 rows");
        // hasMore logic: strip the 51st
        const hasMore = rows.length > 50;
        assert.ok(hasMore, "hasMore should be true");
        const page1Rows = rows.slice(0, 50);
        assert.equal(page1Rows.length, 50);
    });

    it("page 2 returns the next 50 rows", async () => {
        const client = await getClient();
        const base = `SELECT "sutartiesUnikalusId" FROM sutartys ORDER BY "sutartiesUnikalusId"`;
        const [r1, r2] = await Promise.all([
            client.query(`SELECT q.* FROM (${base}) AS q LIMIT 51 OFFSET 0`),
            client.query(`SELECT q.* FROM (${base}) AS q LIMIT 51 OFFSET 50`),
        ]);
        assert.ok(r2.rows.length > 0, "page 2 should have rows");
        assert.notEqual(
            r1.rows[0].sutartiesUnikalusId,
            r2.rows[0].sutartiesUnikalusId,
            "page 1 and page 2 should start with different rows"
        );
    });

    it("v_sutartys is accessible inside the pagination wrapper", async () => {
        const client = await getClient();
        const { rows } = await client.query(`
            SELECT q.* FROM (
                SELECT pirkejas, tiekejas FROM v_sutartys LIMIT 100
            ) AS q LIMIT 51 OFFSET 0
        `);
        assert.ok(rows.length > 0, "expected rows from v_sutartys via pagination wrapper");
        assert.ok("pirkejas" in rows[0], "missing pirkejas");
        assert.ok(!("__total__" in rows[0]), "__total__ column must not be present");
    });
});

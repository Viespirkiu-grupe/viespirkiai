/**
 * Integration tests for the analyst pool and TEMP views.
 * Uses the existing read-only database user from config.js (pgUser / pgPassword)
 * so no separate mcp_analyst role is required to run these tests.
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, afterAll } from "vitest";
import pkg from "pg";
import type { PoolClient } from "pg";
import config from "../../utils/config.js";
import { TEMP_VIEWS_SQL, VIEW_NAMES } from "../../modules/mcp/analyst/tempViews.js";

const { Pool } = pkg;

// Test pool: same credentials as the main app user but on the direct PG port
// (not PgBouncer) so TEMP views survive across queries on the same connection.
const testPool = new Pool({
    host: config.pgHost,
    port: config.pgPort, // direct PostgreSQL port — TEMP views are session-scoped
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10_000,
});

testPool.on("connect", (client) => {
    client.query(TEMP_VIEWS_SQL).catch(() => {});
});

// One shared client so all view tests run on the same backend connection,
// guaranteeing the TEMP views created on connect are still present.
let sharedClient: PoolClient | null = null;

async function getClient() {
    if (!sharedClient) sharedClient = await testPool.connect();
    return sharedClient;
}

afterAll(async () => {
    if (sharedClient) sharedClient.release();
    await testPool.end();
});

// ---------------------------------------------------------------------------
// Pool connectivity
// ---------------------------------------------------------------------------

describe("analyst pool — connectivity", () => {
    it("connects and runs a simple query", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT 1 AS ok");
        expect(rows[0].ok).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// TEMP views — presence after connect
// ---------------------------------------------------------------------------

describe("analyst pool — TEMP views are present after connect", () => {
    it("all 6 views exist in pg_temp schema", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(`
            SELECT viewname
            FROM pg_views
            WHERE schemaname LIKE 'pg_temp%'
            ORDER BY viewname
        `);
        const found = new Set(rows.map((r: { viewname: string }) => r.viewname));
        for (const viewName of VIEW_NAMES) {
            expect(found.has(viewName), `TEMP view '${viewName}' not found — pool.on('connect') may not have fired`).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// TEMP views — each view returns rows with expected columns
// ---------------------------------------------------------------------------

describe("v_company", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_company LIMIT 1");
        expect(rows.length, "v_company returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("jarKodas" in row, "missing jarKodas").toBe(true);
        expect("pavadinimas" in row, "missing pavadinimas").toBe(true);
        expect("darbuotojai" in row, "missing darbuotojai").toBe(true);
        expect("melagingisTiekejas" in row, "missing melagingisTiekejas").toBe(true);
        expect("nepatikimasTiekejas" in row, "missing nepatikimasTiekejas").toBe(true);
    });
});

describe("v_sutartys", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_sutartys LIMIT 1");
        expect(rows.length, "v_sutartys returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("sutartiesUnikalusId" in row, "missing sutartiesUnikalusId").toBe(true);
        expect("pirkejas" in row, "missing pirkejas (joined from jarCsv)").toBe(true);
        expect("tiekejas" in row, "missing tiekejas (joined from jarCsv)").toBe(true);
    });
});

describe("v_pirkimas", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_pirkimas LIMIT 1");
        expect(rows.length, "v_pirkimas returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("saltinis" in row, "missing saltinis").toBe(true);
        expect("pirkimoId" in row, "missing pirkimoId").toBe(true);
        expect("organizatorius" in row, "missing organizatorius (joined from viesiejiPirkimaiVykdytojai)").toBe(true);
        expect("numatomaVerteEUR" in row, "missing numatomaVerteEUR").toBe(true);
    });

    it("includes both cvpis and cvpp sources", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(
            `SELECT saltinis, count(*) AS cnt FROM v_pirkimas GROUP BY saltinis ORDER BY saltinis`,
        );
        const counts = Object.fromEntries(
            rows.map((r: { saltinis: string; cnt: string }) => [r.saltinis, Number(r.cnt)]),
        );
        expect(counts.cvpis, "expected cvpis rows").toBeGreaterThan(0);
        expect(counts.cvpp, "expected cvpp rows").toBeGreaterThan(0);
    });

    it("cvpp rows have NULL for CVP IS-only fields and a link in informacija", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(
            `SELECT * FROM v_pirkimas WHERE saltinis = 'cvpp' LIMIT 1`,
        );
        expect(rows.length, "expected at least one cvpp row").toBeGreaterThan(0);
        const row = rows[0];
        expect(row.jarKodas).toBeNull();
        expect(row.pirkimoBudas).toBeNull();
        expect(row.statusas).toBeNull();
        expect(row.numatomaVerteEUR).toBeNull();
        expect(row.bvpzKodai).toBeNull();
        expect(typeof row.informacija).toBe("string");
        expect(row.informacija.startsWith("http"), "informacija should be a CVPP link").toBe(true);
    });

    it("excludes cvpp rows whose pirkimoNumeris already exists in viesiejiPirkimai (no duplicates)", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(`
            SELECT count(*) AS cnt FROM v_pirkimas v
            WHERE v.saltinis = 'cvpp'
              AND EXISTS (SELECT 1 FROM "viesiejiPirkimai" p WHERE p."pirkimoId" = v."pirkimoId")
        `);
        expect(Number(rows[0].cnt)).toBe(0);
    });

    it("only includes 'Skelbimas apie pirkimą' notices from the cvpp archive", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(`
            SELECT count(*) AS cnt FROM v_pirkimas v
            WHERE v.saltinis = 'cvpp'
              AND v."pirkimoId" NOT IN (
                  SELECT "pirkimoNumeris" FROM "cvppViesiejiPirkimai" WHERE "skelbimoTipas" = 'Skelbimas apie pirkimą'
              )
        `);
        expect(Number(rows[0].cnt)).toBe(0);
    });
});

describe("v_person_links", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_person_links LIMIT 1");
        expect(rows.length, "v_person_links returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("jarKodas" in row, "missing jarKodas").toBe(true);
        expect("vardas" in row, "missing vardas").toBe(true);
        expect("imonesVardas" in row, "missing imonesVardas (joined from jarCsv)").toBe(true);
        expect("rysioPobudzioPavadinimas" in row, "missing rysioPobudzioPavadinimas").toBe(true);
    });
});

describe("v_dalyviai", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_dalyviai LIMIT 1");
        expect(rows.length, "v_dalyviai returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("pirkimoNumeris" in row, "missing pirkimoNumeris").toBe(true);
        expect("tiekejoKodas" in row, "missing tiekejoKodas").toBe(true);
        expect("tiekejas" in row, "missing tiekejas (joined from jarCsv)").toBe(true);
        expect("pasiulymoKaina" in row, "missing pasiulymoKaina").toBe(true);
    });
});

describe("v_bylos", () => {
    it("returns rows with expected columns", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query("SELECT * FROM v_bylos LIMIT 1");
        expect(rows.length, "v_bylos returned no rows").toBeGreaterThan(0);
        const row = rows[0];
        expect("bylosId" in row, "missing bylosId").toBe(true);
        expect("bylosNumeris" in row, "missing bylosNumeris").toBe(true);
        expect("jarKodas" in row, "missing jarKodas").toBe(true);
        expect("dalyvioPavadinimas" in row, "missing dalyvioPavadinimas (joined from jarCsv)").toBe(true);
        expect("bylojeKaip" in row, "missing bylojeKaip").toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Pagination wrapper — the same SQL used by executeQuery
// ---------------------------------------------------------------------------

describe("pagination wrapper", () => {
    it("LIMIT n+1 trick: 51 rows fetched means hasMore is true", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(`
            SELECT q.* FROM (
                SELECT "sutartiesUnikalusId" FROM sutartys ORDER BY "sutartiesUnikalusId"
            ) AS q LIMIT 51 OFFSET 0
        `);
        expect(rows.length, "expected exactly 51 rows when table has >50 rows").toBe(51);
        const hasMore = rows.length > 50;
        expect(hasMore, "hasMore should be true").toBe(true);
        const page1Rows = rows.slice(0, 50);
        expect(page1Rows.length).toBe(50);
    });

    it("page 2 returns the next 50 rows", async () => {
        const client = await getClient();
        const base = `SELECT "sutartiesUnikalusId" FROM sutartys ORDER BY "sutartiesUnikalusId"`;
        const [r1, r2] = await Promise.all([
            // @ts-ignore
            client.query(`SELECT q.* FROM (${base}) AS q LIMIT 51 OFFSET 0`),
            // @ts-ignore
            client.query(`SELECT q.* FROM (${base}) AS q LIMIT 51 OFFSET 50`),
        ]);
        expect(r2.rows.length, "page 2 should have rows").toBeGreaterThan(0);
        expect(r1.rows[0].sutartiesUnikalusId).not.toBe(r2.rows[0].sutartiesUnikalusId);
    });

    it("v_sutartys is accessible inside the pagination wrapper", async () => {
        const client = await getClient();
        // @ts-ignore
        const { rows } = await client.query(`
            SELECT q.* FROM (
                SELECT pirkejas, tiekejas FROM v_sutartys LIMIT 100
            ) AS q LIMIT 51 OFFSET 0
        `);
        expect(rows.length, "expected rows from v_sutartys via pagination wrapper").toBeGreaterThan(0);
        expect("pirkejas" in rows[0], "missing pirkejas").toBe(true);
        expect("__total__" in rows[0], "__total__ column must not be present").toBe(false);
    });
});

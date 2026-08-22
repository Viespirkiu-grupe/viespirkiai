import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Procurement Reader's queries run against the real database through the
// `postgres` pool's role (postgres/postgres.js — a dev-mode stand-in for the
// dedicated read-only `risk_calc` role riskDb.js's header comment describes),
// which has SELECT on every base table these views read but no CREATE
// privilege on the `public` schema there — so the _v2 views under
// modules/mcp/analyst/views/ can never be persisted as real database objects
// on that connection. This module inlines the same view SQL as a WITH
// (CTE) prefix instead: it is applied fresh, per query, over whatever
// connection runs it, rather than once via CREATE VIEW.
//
// A CTE of the same name simply shadows a persisted view inside the query
// that defines it, so this works unchanged against test/risk/testPublicDb.ts's
// local Postgres too, where the same three files are also applied for real
// via CREATE VIEW (riskDb there is an admin-owned local Docker instance).
//
// Keep this in sync with modules/mcp/analyst/views/v_pirkimas_v2.sql,
// v_dalyviai_v2.sql and v_pirkimo_dalis_v2.sql by hand — same convention
// those files already use to track their non-_v2 counterparts.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIEWS_DIR = path.join(ROOT, "modules/mcp/analyst/views");

function loadViewBody(fileName: string): string {
    const sql = fs.readFileSync(path.join(VIEWS_DIR, fileName), "utf8");
    const header = sql.match(/CREATE OR REPLACE VIEW\s+\S+\s+AS\b/i);
    if (!header?.index && header?.index !== 0) {
        throw new Error(`${fileName}: expected a "CREATE OR REPLACE VIEW ... AS" header`);
    }
    return sql.slice(header.index + header[0].length).trim();
}

const PIRKIMAS_BODY = loadViewBody("v_pirkimas_v2.sql");
const DALYVIAI_BODY = loadViewBody("v_dalyviai_v2.sql");
// v_pirkimo_dalis_v2.sql's "stebetos" CTE reads public.v_dalyviai_v2 as a
// persisted view; here it must resolve to the sibling CTE below instead, so
// the schema qualifier — meaningless for a CTE name — is dropped.
const PIRKIMO_DALIS_BODY = loadViewBody("v_pirkimo_dalis_v2.sql").replaceAll("public.v_dalyviai_v2", "v_dalyviai_v2");

// Prepended verbatim to every Procurement Reader query. An unreferenced CTE
// costs nothing — Postgres never plans or executes one that the outer query
// doesn't name — so every query can carry all three regardless of which it
// actually uses.
export const PUBLIC_VIEWS_CTE = `WITH
v_pirkimas_v2 AS (
${PIRKIMAS_BODY}
),
v_dalyviai_v2 AS (
${DALYVIAI_BODY}
),
v_pirkimo_dalis_v2 AS (
${PIRKIMO_DALIS_BODY}
)`;

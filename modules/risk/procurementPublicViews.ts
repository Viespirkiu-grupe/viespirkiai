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
// local Postgres too, where the same four files are also applied for real
// via CREATE VIEW (riskDb there is an admin-owned local Docker instance).
//
// Keep this in sync with modules/mcp/analyst/views/v_pirkimas_v2.sql,
// v_dalyviai_v2.sql, v_pirkimo_dalis_v2.sql, v_pirkimo_pabaiga_v2.sql and
// v_pirkimo_sutartys_v2.sql by hand — same convention those files already
// use to track their non-_v2 counterparts.

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

export type PublicViewName =
    | "v_pirkimas_v2"
    | "v_dalyviai_v2"
    | "v_pirkimo_dalis_v2"
    | "v_pirkimo_pabaiga_v2"
    | "v_pirkimo_sutartys_v2";

// Each view's body plus the sibling views it reads. Order matters only in
// that a CTE may reference one defined before it, which VIEW_ORDER below
// fixes once for every caller.
const VIEWS: Readonly<Record<PublicViewName, { body: string; dependsOn: readonly PublicViewName[] }>> = {
    v_pirkimas_v2: { body: loadViewBody("v_pirkimas_v2.sql"), dependsOn: [] },
    v_dalyviai_v2: { body: loadViewBody("v_dalyviai_v2.sql"), dependsOn: [] },
    // v_pirkimo_dalis_v2.sql's "stebetos" CTE reads public.v_dalyviai_v2 as a
    // persisted view; here it must resolve to the sibling CTE instead, so the
    // schema qualifier — meaningless for a CTE name — is dropped.
    v_pirkimo_dalis_v2: {
        body: loadViewBody("v_pirkimo_dalis_v2.sql").replaceAll("public.v_dalyviai_v2", "v_dalyviai_v2"),
        dependsOn: ["v_dalyviai_v2"],
    },
    // v_pirkimo_pabaiga_v2.sql has no dependency on any other view — it reads
    // ppa."ataskaitos"/ppa."proceduruPabaiga" directly.
    v_pirkimo_pabaiga_v2: { body: loadViewBody("v_pirkimo_pabaiga_v2.sql"), dependsOn: [] },
    // v_pirkimo_sutartys_v2.sql likewise has no dependency on any other view —
    // it reads vpmSutartys directly.
    v_pirkimo_sutartys_v2: { body: loadViewBody("v_pirkimo_sutartys_v2.sql"), dependsOn: [] },
};

// Definition order for the emitted WITH list: a view may only reference one
// that appears earlier.
const VIEW_ORDER: readonly PublicViewName[] = [
    "v_pirkimas_v2",
    "v_dalyviai_v2",
    "v_pirkimo_dalis_v2",
    "v_pirkimo_pabaiga_v2",
    "v_pirkimo_sutartys_v2",
];

/**
 * The WITH prefix defining exactly `names` and whatever those transitively
 * read — nothing more.
 *
 * Emitting all five unconditionally, as this module used to, is not free the
 * way an unused CTE normally is. Postgres inlines a non-recursive CTE only
 * when the query references it exactly once, and it counts references from
 * *every* CTE in the query, including ones the outer query never names. So
 * shipping v_pirkimo_dalis_v2 alongside a query that reads v_dalyviai_v2
 * directly pushed v_dalyviai_v2's reference count to two and forced it to be
 * materialised: the whole participation universe was built and spilled to
 * disk, then filtered, because no predicate could be pushed through a
 * materialised CTE. Naming only what a query reads restores inlining, and
 * with it pushdown of both the dataAsOf cutoff and the subjects scope down to
 * ppa."ataskaitos"' own pirkimoNumeris index.
 */
export function publicViewsCte(names: readonly PublicViewName[]): string {
    const required = new Set<PublicViewName>();
    const visit = (name: PublicViewName): void => {
        if (required.has(name)) return;
        required.add(name);
        for (const dependency of VIEWS[name].dependsOn) visit(dependency);
    };
    for (const name of names) visit(name);

    const defined = VIEW_ORDER.filter((name) => required.has(name));
    if (defined.length === 0) throw new Error("publicViewsCte: at least one view is required");

    return `WITH\n${defined.map((name) => `${name} AS (\n${VIEWS[name].body}\n)`).join(",\n")}`;
}

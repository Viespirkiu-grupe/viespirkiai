// Integration test for the Procurement Risk Service's real execution path
// (services/procurement-risk/runJob.ts's runEvaluation — the same function
// services/procurement-risk/index.ts's CLI calls). Unlike the rest of
// test/risk, which runs indicator SQL against local fixture rows
// (test/risk/testPublicDb.ts), this test reads real canonical procurement
// facts through the production `postgres` pool (postgres/postgres.js) —
// exactly what a real `npm run risk:run` does — and writes through the local
// risk-dev `riskDb` (postgres/riskDb.js, docs/indicators-story/compose.yml). See
// docs/indicators-story/risk-service-architecture.md §1/§4.
//
// Named procurements: a comma-separated pirkimoNumeris list — the same
// "subjects" API index.ts's `npm run risk:run -- <pirkimoNumeris...>` and
// runEvaluation's RunJobOptions.subjects already expose. Override with the
// RISK_IT_PIRKIMO_NUMERIAI env var (e.g.
// RISK_IT_PIRKIMO_NUMERIAI=1039344,1042171,1044751) to target specific real
// procurements; otherwise this samples the first 3 distinct ATN-1
// procurement ids that also resolve to a real v_pirkimas_v2 row (so the
// Procurement Reader is guaranteed to find all of them, not just report
// them).
//
// Safety: riskDb (the only pool this file writes to) MUST be the local,
// disposable risk-dev Postgres — never a real database. The assertion below
// refuses to run otherwise. This test never truncates or deletes rows: the
// local risk-dev database is shared with manual `npm run risk:run`
// investigation, and wiping risk.* out from under that would destroy
// whatever the person running it is looking at. Instead its assertions are
// scoped to just the sampled subjects' own rows, so it coexists with
// whatever else already lives in the table.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../utils/config.js";
import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { runEvaluation } from "../../services/procurement-risk/runJob.ts";
import { publicViewsCte } from "../../modules/risk/procurementPublicViews.ts";

const PIRKIMO_NUMERIAI_ENV = "RISK_IT_PIRKIMO_NUMERIAI";
const SUBJECT_COUNT = 3;

/**
 * riskDb (postgres/riskDb.js) must be the local risk-dev Docker container
 * (docs/indicators-story/compose.yml) — never the shared production database
 * `postgres` (postgres/postgres.js) reads canonical facts from. Called both
 * in beforeAll and again right before the run, so a config change mid-suite
 * can't slip the guard.
 */
function assertTargetsLocalRiskDb(): void {
    if (config.riskPgHost !== "localhost" || config.riskPgUser !== "risk_rw") {
        throw new Error(
            "refusing to run: riskDb must be the local risk-dev Postgres " +
                `(riskPgHost === "localhost", riskPgUser === "risk_rw"), got ` +
                `riskPgHost=${JSON.stringify(config.riskPgHost)}, riskPgUser=${JSON.stringify(config.riskPgUser)}. ` +
                "This test writes real risk.risk_procurement_decisions/risk_signals/risk_evaluation_runs rows.",
        );
    }
}

async function resolvePirkimoNumeriai(): Promise<readonly string[]> {
    const raw = process.env[PIRKIMO_NUMERIAI_ENV];
    if (raw) {
        const subjects = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (subjects.length === 0) {
            throw new Error(`${PIRKIMO_NUMERIAI_ENV} must list at least one pirkimoNumeris, comma-separated`);
        }
        return subjects;
    }

    // Same ATN-1 source table index.ts's own --limit sampler reads, joined to
    // v_pirkimas_v2 so every sampled id is guaranteed to resolve to a real
    // Procurement — an ATN-1 report can be filed ahead of the procurement's
    // own announcement (risk-service-architecture.md's ProcurementReader
    // note), which would otherwise make the decisions-count assertion below
    // flaky.
    const { rows } = await postgres.query<{ pirkimoNumeris: string }>(
        `
        ${publicViewsCte(["v_pirkimas_v2"])}
        SELECT DISTINCT a."pirkimoNumeris"
        FROM ppa."ataskaitos" a
        JOIN v_pirkimas_v2 p ON p."pirkimoNumeris" = a."pirkimoNumeris"
        ORDER BY a."pirkimoNumeris"
        LIMIT $1
        `,
        [SUBJECT_COUNT],
    );
    if (rows.length < SUBJECT_COUNT) {
        throw new Error(
            `expected at least ${SUBJECT_COUNT} real, announced ATN-1 procurements to sample from, found ${rows.length}`,
        );
    }
    return rows.map((row) => row.pirkimoNumeris);
}

// Scoped to just the sampled subjects, never the whole table — the local
// risk-dev database is shared with manual `npm run risk:run` investigation,
// so this must tell its own rows apart from whatever else is already there
// rather than owning (and clearing) the table.
async function countDecisions(subjects: readonly string[]): Promise<number> {
    const { rows } = await riskDb.query<{ count: string }>(
        `SELECT count(*) FROM risk.risk_procurement_decisions WHERE procurement_id = ANY($1)`,
        [subjects],
    );
    return Number(rows[0].count);
}

async function countSignals(subjects: readonly string[]): Promise<number> {
    const { rows } = await riskDb.query<{ count: string }>(
        `SELECT count(*) FROM risk.risk_signals s
           JOIN risk.risk_procurement_decisions d ON d.id = s.decision_id
          WHERE d.procurement_id = ANY($1)`,
        [subjects],
    );
    return Number(rows[0].count);
}

describe("Procurement Risk Service — real execution on named procurements", () => {
    let subjects: readonly string[];

    beforeAll(async () => {
        assertTargetsLocalRiskDb();
        subjects = await resolvePirkimoNumeriai();
    });

    afterAll(async () => {
        await Promise.all([postgres.end(), riskDb.end()]);
    });

    it("evaluates the named procurements against real data, and run a second time writes no additional decisions or signals", async () => {
        assertTargetsLocalRiskDb();
        expect(subjects.length).toBe(SUBJECT_COUNT);

        const first = await runEvaluation({ subjects });
        expect(first.status).toBe("succeeded");

        const decisionsAfterFirst = await countDecisions(subjects);
        const signalsAfterFirst = await countSignals(subjects);
        expect(decisionsAfterFirst).toBe(subjects.length);
        expect(signalsAfterFirst).toBeGreaterThan(0);

        // A refresh over the same subjects: same decisions rows (upserted in
        // place), same signals rows (wiped and reinserted, but with the same
        // content) — never a growing count for these subjects.
        const second = await runEvaluation({ subjects });
        expect(second.status).toBe("succeeded");
        expect(second.runId).not.toBe(first.runId);

        const decisionsAfterSecond = await countDecisions(subjects);
        const signalsAfterSecond = await countSignals(subjects);
        expect(decisionsAfterSecond).toBe(decisionsAfterFirst);
        expect(signalsAfterSecond).toBe(signalsAfterFirst);
    });
});

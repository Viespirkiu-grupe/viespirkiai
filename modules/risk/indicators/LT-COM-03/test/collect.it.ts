// Integration test for LT-COM-03's collect.sql. Runs the real statement
// against fixture rows in the local risk-dev Postgres's test-only `public`
// schema, and asserts the *facts* it returns — the decisions derived from them
// are decision.test.ts's job, and need no database
// (docs/indicators-story/risk-service-architecture-v2.md). The "end to end"
// describe block below additionally proves the Procurement Reader +
// isEligible()/assessRisk() wiring, which collect.sql alone no longer covers
// since it dropped its join to v_pirkimas.
//
// Named `.it.ts` to match this repo's integration-test convention
// (vitest.integration.config.ts); run via `npm run test:integration`, which
// requires the local Docker Postgres from docker/risk/compose.yml to be up.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskDb } from "../../../../../postgres/riskDb.js";
import { ensurePublicTestSchema, truncateTestPublicTables } from "../../../../../test/risk/testPublicDb.ts";
import { insertAtaskaita, insertDalyvis, insertPasiulymas } from "../../test/xlsxPPAFixtures.ts";
import { PostgresRiskDataSource } from "../../../riskDataSource.ts";
import type { RiskSignal } from "../../../types.ts";
import { loadProcurements } from "../../../procurementReader.ts";
import { ltCom03v1, type LtCom03Facts } from "../decision.ts";
import {
    differentSuppliersAcrossTwoLots,
    duplicateSupplierRows,
    fiveSuppliers,
    lateReport,
    oneSupplier,
    reportedBeforeParameters,
    sameSupplierAcrossTwoLots,
    twoSuppliers,
    unmatchedProcurement,
    type LotFixture,
    type ProcurementFixture,
} from "./fixtures.ts";

const DATA_AS_OF = "2026-08-12T00:00:00.000Z";

// Read straight from the indicator's directory rather than through the
// definition, so a broken sqlFile wiring shows up as a failing assertion here
// instead of as two halves quietly agreeing on the wrong statement.
const COLLECT_SQL = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../collect.sql"),
    "utf8",
);

const facts = new PostgresRiskDataSource(riskDb);

async function insertProcurement(fixture: ProcurementFixture): Promise<void> {
    const pirkimoNumeris = String(fixture.pirkimoId);

    if (fixture.registerProcurement) {
        await riskDb.query(
            `INSERT INTO public."viesiejiPirkimai" ("pirkimoId", "pavadinimas", "pirkimoBudas")
             VALUES ($1, $2, $3)`,
            [fixture.pirkimoId, `Fixture ${fixture.pirkimoId}`, fixture.pirkimoBudas],
        );
    }

    const ataskaitaId = await insertAtaskaita({
        pirkimoNumeris,
        pirkimoBudas: fixture.pirkimoBudas,
        daliuSkaicius: fixture.lots.length,
        sukurtaAt: fixture.reportedAt,
    });

    for (const lot of fixture.lots as readonly LotFixture[]) {
        for (const kodas of lot.bidders) {
            await insertDalyvis({ ataskaitaId, kodas });
            // Rejection status has no bearing on this indicator — every
            // participant is recorded as a submitted, unrejected bid.
            await insertPasiulymas({ ataskaitaId, daliesNumeris: lot.daliesNumeris, dalyvioKodas: kodas });
        }
    }
}

/** collect.sql on its own, with the two arguments the shared class binds. */
async function collect(subjects: readonly string[] | null = null): Promise<readonly LtCom03Facts[]> {
    const rows = await facts.query<LtCom03Facts>(COLLECT_SQL, [DATA_AS_OF, subjects]);
    return [...rows].sort((a, b) => a.pirkimoNumeris.localeCompare(b.pirkimoNumeris));
}

async function collectFor(fixture: ProcurementFixture): Promise<readonly LtCom03Facts[]> {
    await insertProcurement(fixture);
    return collect();
}

beforeAll(async () => {
    await ensurePublicTestSchema();
});

beforeEach(async () => {
    await truncateTestPublicTables();
});

afterAll(async () => {
    await riskDb.end();
});

describe("LT-COM-03 collect.sql", () => {
    // Every fixture states the fact row it must produce, column for column.
    // These are the assertions that keep fixtures.ts honest, and with it the
    // unit tests that judge those same rows.
    it.each([
        ["one supplier", oneSupplier],
        ["two suppliers", twoSuppliers],
        ["five suppliers", fiveSuppliers],
        ["an unmatched procurement", unmatchedProcurement],
        ["the same supplier across two lots", sameSupplierAcrossTwoLots],
        ["different suppliers across two lots", differentSuppliersAcrossTwoLots],
        ["duplicate supplier rows", duplicateSupplierRows],
        ["a report recorded after the cutoff", lateReport],
    ])("collects the declared facts for %s", async (_name, fixture) => {
        expect(await collectFor(fixture)).toEqual(fixture.facts);
    });

    it("returns exactly one row per procurement, not per lot", async () => {
        await insertProcurement(sameSupplierAcrossTwoLots);
        await insertProcurement(differentSuppliersAcrossTwoLots);
        const rows = await collect();
        expect(new Set(rows.map((row) => row.pirkimoNumeris)).size).toBe(rows.length);
        expect(rows).toHaveLength(2);
    });

    it("scopes a run to the subjects passed as $2", async () => {
        await insertProcurement(oneSupplier);
        await insertProcurement(fiveSuppliers);
        const rows = await collect(["900201"]);
        expect(rows.map((row) => row.pirkimoNumeris)).toEqual(["900201"]);
    });

    it("hides a report recorded after the cutoff, and shows it at a later one", async () => {
        await insertProcurement(lateReport);
        expect(await collect()).toEqual([]);

        const later = await facts.query<LtCom03Facts>(COLLECT_SQL, ["2026-10-01T00:00:00.000Z", null]);
        expect(later.map((row) => row.pirkimoNumeris)).toEqual(["900208"]);
    });

    it("makes no time comparison outside the $1 cutoff", () => {
        const withoutComments = COLLECT_SQL.replace(/--.*$/gm, "");
        expect(withoutComments).not.toMatch(/\bnow\s*\(|current_date|current_timestamp|localtimestamp/i);
    });

    it("decides nothing: no state, no identity, no threshold in the statement", () => {
        const withoutComments = COLLECT_SQL.replace(/--.*$/gm, "");
        expect(withoutComments).not.toMatch(/triggered|not_applicable|insufficient_data|LT-COM-03/);
    });
});

describe("LT-COM-03 end to end", () => {
    // The same call the run job makes: the Procurement Reader loads the
    // subject universe, then the indicator prefetches, resolves its own
    // effective parameters, judges and validates. Only the data source
    // differs — here the local Docker Postgres instead of the real database.
    async function evaluateInsertedFixture(dataAsOf = DATA_AS_OF): Promise<readonly RiskSignal[]> {
        const { procurementSubjects } = await loadProcurements(facts, null);
        return ltCom03v1.evaluate({ runId: 1, dataAsOf, subjects: null }, procurementSubjects, facts);
    }

    it("assembles a complete observation from a fact row and a decision", async () => {
        await insertProcurement(oneSupplier);
        const [observation] = await evaluateInsertedFixture();

        expect(observation).toEqual({
            indicatorId: "LT-COM-03",
            indicatorVersion: 1,
            subjectType: "procurement",
            subjectKey: "cvpis:900201",
            procurementSource: "cvpis",
            procurementId: "900201",
            state: "triggered",
            rawValue: { totalSuppliers: 1 },
            threshold: { minimumSuppliers: 2 },
            appliedParameters: { minimumSuppliers: 2 },
            evidence: {
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: oneSupplier.facts[0].reportedAt,
                source: "ATN-1 ataskaita",
            },
            missingData: [],
            dataAsOf: DATA_AS_OF,
        });
    });

    // Since the v2 port, LT-COM-03's subject universe is exactly what the
    // Procurement Reader loads from v_pirkimas_v2 — a pirkimoNumeris with no
    // viesiejiPirkimai row is not a ProcurementSubject at all, so it produces
    // no signal (not even insufficient_data). This is a documented,
    // deliberate coverage change from the old collect.sql, which discovered
    // such procurements itself via a LEFT JOIN — see
    // modules/risk/indicators/LT-COM-03/README.md's "v2 architecture note".
    // (LT-COM-01/LT-COM-02 differ: their LotSubjects still exist via
    // v_pirkimo_dalis's participation-observed side, with procurement: null,
    // so they still resolve to insufficient_data — see their own
    // collect.it.ts.)
    it("produces no ProcurementSubject, and so no signal, for an unregistered procurement", async () => {
        await insertProcurement(unmatchedProcurement);
        const { procurementSubjects } = await loadProcurements(facts, null);

        expect(procurementSubjects.find((s) => s.procurementId === "900204")).toBeUndefined();

        const observations = await evaluateInsertedFixture();
        expect(observations.find((o) => o.procurementId === "900204")).toBeUndefined();
    });

    // The report is collected — it predates the cutoff — but no reviewed
    // threshold covers it, and the shared class refuses to judge without one.
    it("reports not_applicable with no applied parameters before the timeline starts", async () => {
        await insertProcurement(reportedBeforeParameters);
        const [observation] = await evaluateInsertedFixture("2025-12-01T00:00:00.000Z");

        expect(observation.subjectKey).toBe("cvpis:900209");
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
    });

    it("writes the same observations for an unchanged cutoff and unchanged rows", async () => {
        await insertProcurement(differentSuppliersAcrossTwoLots);
        expect(await evaluateInsertedFixture()).toEqual(await evaluateInsertedFixture());
    });
});

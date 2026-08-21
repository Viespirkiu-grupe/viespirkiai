// Integration test for LT-COM-01's collect.sql. Runs the real statement
// against fixture rows in the local risk-dev Postgres's test-only `public`
// schema, and asserts the *facts* it returns — the decisions derived from them
// are rules.test.ts's job, and need no database
// (docs/indicators-story/risk-service-architecture-v2.md). The "end to end"
// describe block below additionally proves the Procurement Reader +
// isEligible()/assessRisk() wiring, which collect.sql alone no longer covers
// since it dropped its join to v_pirkimo_dalis.
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
import { insertAtaskaita, insertAtmestasPasiulymas, insertDalyvis, insertPasiulymas } from "../../test/xlsxPPAFixtures.ts";
import { PostgresRiskDataSource } from "../../../riskDataSource.ts";
import type { RiskObservationV1 } from "../../../contracts.ts";
import { loadProcurements } from "../../../procurementReader.ts";
import { ltCom01v1 } from "../definition.ts";
import type { LtCom01Facts } from "../rules.ts";
import {
    duplicateBidderRows,
    lateReport,
    oneOfTwoRejected,
    reportedBeforeParameters,
    singleBidder,
    twoLotsDifferentOutcomes,
    twoValidBidders,
    unmatchedProcurement,
    type BidderFixture,
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

    for (const lot of fixture.lots) {
        for (const bidder of lot.bidders as readonly BidderFixture[]) {
            await insertDalyvis({ ataskaitaId, kodas: bidder.kodas });
            if (bidder.valid) {
                await insertPasiulymas({ ataskaitaId, daliesNumeris: lot.daliesNumeris, dalyvioKodas: bidder.kodas });
            } else {
                await insertAtmestasPasiulymas({
                    ataskaitaId,
                    daliesNumeris: lot.daliesNumeris,
                    dalyvioKodas: bidder.kodas,
                });
            }
        }
    }
}

function sortKey(row: LtCom01Facts): string {
    return `${row.pirkimoNumeris}:${row.daliesNumeris}`;
}

/** collect.sql on its own, with the two arguments the shared class binds. */
async function collect(subjects: readonly string[] | null = null): Promise<readonly LtCom01Facts[]> {
    const rows = await facts.query<LtCom01Facts>(COLLECT_SQL, [DATA_AS_OF, subjects]);
    return [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

async function collectFor(fixture: ProcurementFixture): Promise<readonly LtCom01Facts[]> {
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

describe("LT-COM-01 collect.sql", () => {
    // Every fixture states the fact rows it must produce, column for column.
    // These are the assertions that keep fixtures.ts honest, and with it the
    // unit tests that judge those same rows.
    it.each([
        ["a single unrejected bidder", singleBidder],
        ["one of two bidders rejected", oneOfTwoRejected],
        ["two valid bidders", twoValidBidders],
        ["an unmatched procurement", unmatchedProcurement],
        ["a multi-lot procurement", twoLotsDifferentOutcomes],
        ["duplicate bidder rows", duplicateBidderRows],
        ["a report recorded after the cutoff", lateReport],
    ])("collects the declared facts for %s", async (_name, fixture) => {
        expect(await collectFor(fixture)).toEqual(fixture.facts);
    });

    it("returns exactly one row per lot", async () => {
        await insertProcurement(twoLotsDifferentOutcomes);
        await insertProcurement(duplicateBidderRows);
        const rows = await collect();
        expect(new Set(rows.map(sortKey)).size).toBe(rows.length);
        expect(rows).toHaveLength(3);
    });

    it("scopes a run to the subjects passed as $2", async () => {
        await insertProcurement(singleBidder);
        await insertProcurement(twoValidBidders);
        const rows = await collect(["900001"]);
        expect(rows.map((row) => row.pirkimoNumeris)).toEqual(["900001"]);
    });

    it("hides a report recorded after the cutoff, and shows it at a later one", async () => {
        await insertProcurement(lateReport);
        expect(await collect()).toEqual([]);

        const later = await facts.query<LtCom01Facts>(COLLECT_SQL, ["2026-10-01T00:00:00.000Z", null]);
        expect(later.map((row) => row.pirkimoNumeris)).toEqual(["900007"]);
    });

    it("makes no time comparison outside the $1 cutoff", () => {
        const withoutComments = COLLECT_SQL.replace(/--.*$/gm, "");
        expect(withoutComments).not.toMatch(/\bnow\s*\(|current_date|current_timestamp|localtimestamp/i);
    });

    it("decides nothing: no state, no identity, no threshold in the statement", () => {
        const withoutComments = COLLECT_SQL.replace(/--.*$/gm, "");
        expect(withoutComments).not.toMatch(/triggered|not_applicable|insufficient_data|LT-COM-01/);
    });
});

describe("LT-COM-01 end to end", () => {
    // The same call the run job makes: the Procurement Reader loads the
    // subject universe, then the indicator prefetches, resolves its own
    // effective parameters, judges and validates. Only the data source
    // differs — here the local Docker Postgres instead of the real database.
    async function evaluateInsertedFixture(dataAsOf = DATA_AS_OF): Promise<readonly RiskObservationV1[]> {
        const { lotSubjects } = await loadProcurements(facts, null);
        return ltCom01v1.evaluate({ runId: 1, dataAsOf, subjects: null }, lotSubjects, facts);
    }

    it("assembles a complete observation from a fact row and a decision", async () => {
        await insertProcurement(singleBidder);
        const [observation] = await evaluateInsertedFixture();

        expect(observation).toEqual({
            indicatorId: "LT-COM-01",
            indicatorVersion: 1,
            subjectType: "lot",
            subjectKey: "cvpis:900001:0",
            procurementSource: "cvpis",
            procurementId: "900001",
            state: "triggered",
            rawValue: { totalBids: 1, validBids: 1 },
            threshold: { maximumValidBids: 1 },
            appliedParameters: { maximumValidBids: 1 },
            evidence: {
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: singleBidder.facts[0].reportedAt,
                source: "ATN-1 ataskaita",
            },
            missingData: [],
            dataAsOf: DATA_AS_OF,
        });
    });

    // No viesiejiPirkimai row exists for this pirkimoNumeris, so the
    // Procurement Reader's LotSubject.procurement is null and the shared
    // eligibility gate — not ltCom01Decide — reports insufficient_data.
    it("reports insufficient_data via the shared eligibility gate for an unregistered procurement", async () => {
        await insertProcurement(unmatchedProcurement);
        const [observation] = await evaluateInsertedFixture();

        expect(observation.subjectKey).toBe("unknown:900004:0");
        expect(observation.state).toBe("insufficient_data");
        expect(observation.missingData).toEqual(["procurementSource"]);
        expect(observation.rawValue).toBeNull();
    });

    // The report is collected — it predates the cutoff — but no reviewed
    // threshold covers it, and the shared class refuses to judge without one.
    it("reports not_applicable with no applied parameters before the timeline starts", async () => {
        await insertProcurement(reportedBeforeParameters);
        const [observation] = await evaluateInsertedFixture("2025-12-01T00:00:00.000Z");

        expect(observation.subjectKey).toBe("cvpis:900008:0");
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
    });

    it("writes the same observations for an unchanged cutoff and unchanged rows", async () => {
        await insertProcurement(twoLotsDifferentOutcomes);
        expect(await evaluateInsertedFixture()).toEqual(await evaluateInsertedFixture());
    });
});

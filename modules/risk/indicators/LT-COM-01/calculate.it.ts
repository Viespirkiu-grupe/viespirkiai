// Integration test for LT-COM-01's calculate.sql. Runs the real SQL — via
// the same EvaluationContext shape the run job supplies — against fixture
// rows in the local risk-dev Postgres's test-only `public` schema. Named
// `.it.ts` (not the architecture doc's `calculate.test.ts`) to match this
// repo's integration-test convention (vitest.integration.config.ts); run via
// `npm run test:integration`, which requires the local Docker Postgres from
// docker/risk/compose.yml to be up.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { riskDb } from "../../../../postgres/riskDb.js";
import { ensurePublicTestSchema, truncateTestPublicTables } from "../../../../test/risk/testPublicDb.ts";
import { PostgresRiskDataSource } from "../../riskDataSource.ts";
import type { RiskObservationV1 } from "../../contracts.ts";
import { ltCom01v1 } from "./definition.ts";
import type { BidderFixture, ProcurementFixture } from "./fixtures.ts";
import {
    oneOfTwoRejected,
    singleBidder,
    twoLotsDifferentOutcomes,
    twoValidBidders,
    unmatchedProcurement,
} from "./fixtures.ts";

const DATA_AS_OF = "2026-08-12T00:00:00.000Z";

async function insertProcurement(fixture: ProcurementFixture): Promise<void> {
    const pirkimoNumeris = String(fixture.pirkimoId);

    if (fixture.registerProcurement) {
        await riskDb.query(
            `INSERT INTO public."viesiejiPirkimai" ("pirkimoId", "pavadinimas", "pirkimoBudas")
             VALUES ($1, $2, $3)`,
            [fixture.pirkimoId, `Fixture ${fixture.pirkimoId}`, fixture.pirkimoBudas],
        );
    }

    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO public."atn1ataskaitos" ("pirkimoNumeris", "pirkimoBudas", "daliuSkaicius")
         VALUES ($1, $2, $3)
         RETURNING id`,
        [pirkimoNumeris, fixture.pirkimoBudas, fixture.lots.length],
    );
    const ataskaitaId = rows[0].id;

    for (const lot of fixture.lots) {
        for (const bidder of lot.bidders as readonly BidderFixture[]) {
            await riskDb.query(
                `INSERT INTO public."atn1dalyviai" ("ataskaitaId", "kodas") VALUES ($1, $2)`,
                [ataskaitaId, bidder.kodas],
            );
            if (bidder.valid) {
                await riskDb.query(
                    `INSERT INTO public."atn1pasiulymuEile" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "kaina")
                     VALUES ($1, $2, $3, '1000')`,
                    [ataskaitaId, lot.daliesNumeris, bidder.kodas],
                );
            } else {
                await riskDb.query(
                    `INSERT INTO public."atn1atmestiPasiulymai" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "statusas")
                     VALUES ($1, $2, $3, 'Atmestas')`,
                    [ataskaitaId, lot.daliesNumeris, bidder.kodas],
                );
            }
        }
    }
}

// The same call the run job makes: the indicator resolves its own effective
// parameters, calculates and validates. Only the data source differs — here
// the local Docker Postgres instead of the real database.
const testFacts = new PostgresRiskDataSource(riskDb);

function runCalculation(subjects: readonly string[] | null = null): Promise<readonly RiskObservationV1[]> {
    return ltCom01v1.evaluate({ runId: 1, dataAsOf: DATA_AS_OF, subjects }, testFacts);
}

function bySubjectKey(rows: readonly RiskObservationV1[], subjectKey: string) {
    const row = rows.find((r) => r.subjectKey === subjectKey);
    if (!row) throw new Error(`No observation for subject ${subjectKey}`);
    return row;
}

describe("LT-COM-01 calculate.sql", () => {
    beforeAll(async () => {
        await ensurePublicTestSchema();
    });

    beforeEach(async () => {
        await truncateTestPublicTables();
    });

    afterAll(async () => {
        await riskDb.end();
    });

    it("triggers when exactly one bidder submitted and it was not rejected", async () => {
        await insertProcurement(singleBidder);
        const rows = await runCalculation();
        const row = bySubjectKey(rows, "cvpis:900001:0");
        expect(row.state).toBe("triggered");
        expect(row.rawValue).toEqual({ totalBids: 1, validBids: 1 });
    });

    it("triggers when one of two bidders was rejected, leaving one valid bid", async () => {
        await insertProcurement(oneOfTwoRejected);
        const rows = await runCalculation();
        const row = bySubjectKey(rows, "cvpis:900002:0");
        expect(row.state).toBe("triggered");
        expect(row.rawValue).toEqual({ totalBids: 2, validBids: 1 });
    });

    it("does not trigger when two bidders both remain valid", async () => {
        await insertProcurement(twoValidBidders);
        const rows = await runCalculation();
        const row = bySubjectKey(rows, "cvpis:900003:0");
        expect(row.state).toBe("not_triggered");
        expect(row.rawValue).toEqual({ totalBids: 2, validBids: 2 });
    });

    it("reports insufficient_data when the procurement source can't be resolved", async () => {
        await insertProcurement(unmatchedProcurement);
        const rows = await runCalculation();
        const row = bySubjectKey(rows, "unknown:900004:0");
        expect(row.state).toBe("insufficient_data");
        expect(row.rawValue).toBeNull();
        expect(row.threshold).toBeNull();
        expect(row.missingData).toEqual(["procurementSource"]);
    });

    it("evaluates each lot of a multi-lot procurement independently", async () => {
        await insertProcurement(twoLotsDifferentOutcomes);
        const rows = await runCalculation();
        expect(bySubjectKey(rows, "cvpis:900005:1").state).toBe("triggered");
        expect(bySubjectKey(rows, "cvpis:900005:2").state).toBe("not_triggered");
    });

    it("scopes a run to the subjects passed as $4", async () => {
        await insertProcurement(singleBidder);
        await insertProcurement(twoValidBidders);
        const rows = await runCalculation(["900001"]);
        expect(rows).toHaveLength(1);
        expect(rows[0].subjectKey).toBe("cvpis:900001:0");
    });

    it("resolves the effective-dated parameter entry for a cutoff inside its range", () => {
        const entries = ltCom01v1.parametersAsOf("2026-06-01");
        expect(entries).toHaveLength(1);
        expect(entries[0].values).toEqual({ requireCompetitiveMethod: false });
    });

    it("resolves no parameter entry for a cutoff before the timeline starts", () => {
        const entries = ltCom01v1.parametersAsOf("2020-01-01");
        expect(entries).toHaveLength(0);
    });
});

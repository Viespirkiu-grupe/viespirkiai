import { describe, expect, it } from "vitest";
import { LtCom01Decision } from "../decision.ts";
import type { Lot, LotParticipation, LotSubject, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { emptyReport, oneOfTwoRejected, REPORTED_AT, singleBidder, twoValidBidders } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-01: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated participation query actually produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// LotSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltCom01v1 = new LtCom01Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900001",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: null,
        paskelbimoData: null,
        pasiulymuPateikimoTerminas: null,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
        participation: null,
        ...overrides,
    };
}

function testLot(participation: LotParticipation | null): Lot {
    return {
        subjektoRaktas: "cvpis:900001:0",
        saltinis: "cvpis",
        pirkimoNumeris: "900001",
        daliesNumeris: "0",
        daliesPavadinimas: null,
        deklaruota: false,
        stebeta: true,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation,
    };
}

function lotSubject(participation: LotParticipation, procurementOverrides: Partial<Procurement> = {}): LotSubject {
    const procurement = testProcurement(procurementOverrides);
    return {
        subjectType: "lot",
        subjectKey: "cvpis:900001:0",
        procurementSource: "cvpis",
        procurementId: "900001",
        procurement,
        lot: testLot(participation),
    };
}

function assessRiskFor(participation: LotParticipation) {
    return ltCom01v1.assessRisk(lotSubject(participation), CONTEXT);
}

describe("LtCom01Decision.assessRisk", () => {
    it("triggers when exactly one bidder submitted and it was not rejected", () => {
        const signal = assessRiskFor(singleBidder);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalBids: 1, validBids: 1 });
        expect(signal.threshold).toEqual({ maximumValidBids: 1 });
    });

    it("triggers when one of two bidders was rejected, leaving one valid bid", () => {
        const signal = assessRiskFor(oneOfTwoRejected);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalBids: 2, validBids: 1 });
    });

    it("does not trigger when two bidders both remain valid — the boundary at maximumValidBids: 1", () => {
        const signal = assessRiskFor(twoValidBidders);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalBids: 2, validBids: 2 });
    });

    it("reports insufficient_data for a report that lists no usable participants", () => {
        const signal = assessRiskFor(emptyReport);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("is total: every participation shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 7]) {
            for (const validBids of [0, 1, 2, 7]) {
                const signal = assessRiskFor({ totalBids, validBids, reportedAt: REPORTED_AT });
                expect(states).toContain(signal.state);
            }
        }
    });

    it("is pure: the same participation shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(oneOfTwoRejected)).toEqual(assessRiskFor(oneOfTwoRejected));
    });

});

describe("LtCom01Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom01v1]);

    it("assembles a complete signal from a Procurement carrying a merged-participation lot", () => {
        const procurement = testProcurement({ lots: [testLot(singleBidder)] });
        const [signal] = engine.evaluateAll([procurement]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-01",
            subjectType: "lot",
            state: "triggered",
            rawValue: { totalBids: 1, validBids: 1 },
        });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const procurement = testProcurement({ lots: [testLot(null)] });
        const [signal] = engine.evaluateAll([procurement]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing participation", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null, lots: [testLot(null)] });
        const [signal] = engine.evaluateAll([procurement]);
        expect(signal.state).toBe("not_applicable");
    });
});

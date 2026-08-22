import { describe, expect, it } from "vitest";
import { LtCom02Decision } from "../decision.ts";
import type { Lot, LotParticipation, LotSubject, Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { emptyReport, fiveBidders, REPORTED_AT, threeBidders, twoBidders } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-02: plain objects in, plain
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
const ltCom02v1 = new LtCom02Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900101",
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
        subjektoRaktas: "cvpis:900101:0",
        saltinis: "cvpis",
        pirkimoNumeris: "900101",
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
        subjectKey: "cvpis:900101:0",
        procurementSource: "cvpis",
        procurementId: "900101",
        procurement,
        lot: testLot(participation),
    };
}

function assessRiskFor(participation: LotParticipation) {
    return ltCom02v1.assessRisk(lotSubject(participation), CONTEXT);
}

describe("LtCom02Decision.assessRisk", () => {
    it("triggers when only two participants are recorded", () => {
        const signal = assessRiskFor(twoBidders);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalBids: 2 });
        expect(signal.threshold).toEqual({ minimumBidders: 3 });
    });

    it("does not trigger at exactly the minimum number of bidders — the boundary at minimumBidders: 3", () => {
        const signal = assessRiskFor(threeBidders);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalBids: 3 });
    });

    it("does not trigger with plenty of participants", () => {
        const signal = assessRiskFor(fiveBidders);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalBids: 5 });
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const signal = assessRiskFor(emptyReport);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence, sourced from the parent procurement's pirkimoBudas", () => {
        for (const participation of [twoBidders, fiveBidders, threeBidders]) {
            expect(assessRiskFor(participation).evidence).toEqual({
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: participation.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("is total: every participation shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 3, 7]) {
            const signal = assessRiskFor({ totalBids, validBids: totalBids, reportedAt: REPORTED_AT });
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same participation shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(fiveBidders)).toEqual(assessRiskFor(fiveBidders));
    });

    it("throws when given a procurement subject instead of a lot subject", () => {
        const procurementSubject: ProcurementSubject = {
            subjectType: "procurement",
            subjectKey: "cvpis:1",
            procurementSource: "cvpis",
            procurementId: "1",
            procurement: testProcurement(),
        };
        expect(() => ltCom02v1.assessRisk(procurementSubject, CONTEXT)).toThrow(/expected a lot subject/);
    });
});

describe("LtCom02Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom02v1]);

    it("assembles a complete signal from a Procurement carrying a merged-participation lot", () => {
        const procurement = testProcurement({ lots: [testLot(twoBidders)] });
        const [signal] = engine.evaluateAll([procurement]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-02",
            subjectType: "lot",
            state: "triggered",
            rawValue: { totalBids: 2 },
        });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const procurement = testProcurement({ lots: [testLot(null)] });
        const [signal] = engine.evaluateAll([procurement]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });
});

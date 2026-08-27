import { describe, expect, it } from "vitest";
import { LtTra06Decision } from "../decision.ts";
import type { Procurement, ProcurementProcedureOutcome, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    oneLotBlankReason,
    oneLotConcludedButUndocumented,
    oneLotDocumented,
    oneLotUndocumented,
    twoLotsBothDocumented,
    twoLotsOneUndocumented,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-TRA-06: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Procedure-outcome
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated procurement-grain outcome query actually carries
// sprendimoPriezastys through.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// ProcurementSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltTra06v1 = new LtTra06Decision(CONTEXT);

function testProcurement(procedureOutcome: ProcurementProcedureOutcome | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900601",
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
        procedureOutcome,
        contractSignatureDates: null,
        ...overrides,
    };
}

function procurementSubject(procedureOutcome: ProcurementProcedureOutcome, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(procedureOutcome, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900601",
        procurementSource: "cvpis",
        procurementId: "900601",
        procurement,
    };
}

function assessRiskFor(procedureOutcome: ProcurementProcedureOutcome) {
    return ltTra06v1.assessRisk(procurementSubject(procedureOutcome));
}

describe("LtTra06Decision.assessRisk", () => {
    it("does not trigger when the single lot's decision carries a stated reason", () => {
        const signal = assessRiskFor(oneLotDocumented);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ undocumentedLots: [] });
    });

    it("triggers when the single lot's decision has no stated reason", () => {
        const signal = assessRiskFor(oneLotUndocumented);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ undocumentedLots: ["0"] });
    });

    it("triggers on an undocumented 'concluded' (successful) outcome too — not collinear with the outcome label", () => {
        const signal = assessRiskFor(oneLotConcludedButUndocumented);
        expect(signal.state).toBe("triggered");
    });

    it("treats a whitespace-only reason the same as a missing one", () => {
        const signal = assessRiskFor(oneLotBlankReason);
        expect(signal.state).toBe("triggered");
    });

    it("does not trigger when every lot of a multi-lot procurement is documented", () => {
        const signal = assessRiskFor(twoLotsBothDocumented);
        expect(signal.state).toBe("not_triggered");
    });

    it("triggers when only one lot of a multi-lot procurement lacks a reason — not offset by the other lot", () => {
        const signal = assessRiskFor(twoLotsOneUndocumented);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ undocumentedLots: ["1"] });
    });

    it("is total: every procedure-outcome shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const outcome of [oneLotDocumented, oneLotUndocumented, twoLotsBothDocumented, twoLotsOneUndocumented]) {
            const signal = assessRiskFor(outcome);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same procedure-outcome shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(oneLotUndocumented)).toEqual(assessRiskFor(oneLotUndocumented));
    });
});

describe("LtTra06Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltTra06v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying merged procedure-outcome data", () => {
        const procurement = testProcurement(oneLotUndocumented);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-TRA-06",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { undocumentedLots: ["0"] },
        });
    });

    it("reports insufficient_data when no procedure-ending decision was observed for the procurement", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["proceduruPabaiga"]);
    });
});

import { describe, expect, it } from "vitest";
import { LtOth05Decision } from "../decision.ts";
import type { Procurement, ProcurementProcedureOutcome, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    mixedLotsOneConcluded,
    oneLotAllRejected,
    oneLotConcluded,
    oneLotConcludedVariant,
    oneLotNoBids,
    twoLotsBothUnsuccessful,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-OTH-05: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Procedure-outcome
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated procurement-grain outcome query actually produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// ProcurementSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltOth05v1 = new LtOth05Decision(CONTEXT);

function testProcurement(procedureOutcome: ProcurementProcedureOutcome | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
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
        ...overrides,
    };
}

function procurementSubject(procedureOutcome: ProcurementProcedureOutcome, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(procedureOutcome, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900301",
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
    };
}

function assessRiskFor(procedureOutcome: ProcurementProcedureOutcome) {
    return ltOth05v1.assessRisk(procurementSubject(procedureOutcome));
}

describe("LtOth05Decision.assessRisk", () => {
    it("does not trigger when the single lot concluded in a contract", () => {
        const signal = assessRiskFor(oneLotConcluded);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ lotOutcomes: oneLotConcluded.lotOutcomes });
    });

    it("recognizes the near-duplicate 'concluded' phrasing as not_triggered too", () => {
        const signal = assessRiskFor(oneLotConcludedVariant);
        expect(signal.state).toBe("not_triggered");
    });

    it("triggers when no bids were received at all within the deadline", () => {
        const signal = assessRiskFor(oneLotNoBids);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ lotOutcomes: oneLotNoBids.lotOutcomes });
    });

    it("triggers when every submitted tender was rejected", () => {
        const signal = assessRiskFor(oneLotAllRejected);
        expect(signal.state).toBe("triggered");
    });

    it("triggers when both lots of a multi-lot procurement ended unsuccessfully", () => {
        const signal = assessRiskFor(twoLotsBothUnsuccessful);
        expect(signal.state).toBe("triggered");
    });

    it("does not trigger when at least one lot of a multi-lot procurement concluded — the ALL-lots-failed formula", () => {
        const signal = assessRiskFor(mixedLotsOneConcluded);
        expect(signal.state).toBe("not_triggered");
    });

    it("is total: every procedure-outcome shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const outcome of [oneLotConcluded, oneLotNoBids, oneLotAllRejected, mixedLotsOneConcluded, twoLotsBothUnsuccessful]) {
            const signal = assessRiskFor(outcome);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same procedure-outcome shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(oneLotNoBids)).toEqual(assessRiskFor(oneLotNoBids));
    });
});

describe("LtOth05Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltOth05v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying merged procedure-outcome data", () => {
        const procurement = testProcurement(oneLotNoBids);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-OTH-05",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { lotOutcomes: oneLotNoBids.lotOutcomes },
        });
    });

    it("reports insufficient_data when no procedure-ending decision was observed for the procurement", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["proceduruPabaiga"]);
    });
});

import { describe, expect, it } from "vitest";
import { LtCom21Decision } from "../decision.ts";
import type { Bid, BidSubject, Lot, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    citationInProseBid,
    disqualifiedFreeTextGroundBid,
    disqualifiedWithoutLegalBasisBid,
    NON_CONFORMING_BASIS,
    nonConformingBid,
    noOutcomeBid,
    priceRejectedBid,
    priceRejectedNoTrailingStopBid,
    rankedBid,
    spelledOutLawBid,
    UNCLARIFIED_BASIS,
    unclarifiedBid,
    UNQUALIFIED_BASIS,
    unqualifiedBid,
    UTILITIES_NON_CONFORMING_BASIS,
    utilitiesNonConformingBid,
    utilitiesPriceRejectedBid,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-21: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture.md). Bid scenarios come
// from fixtures.ts; procurementReader.it.ts proves the bid-grain query
// itself produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// BidSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltCom21v1 = new LtCom21Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
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
        procedureOutcome: null,
        contractSignatureDates: null,
        ...overrides,
    };
}

function testLot(bids: readonly Bid[]): Lot {
    return {
        subjektoRaktas: "cvpis:900301:1",
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
        daliesNumeris: "1",
        daliesPavadinimas: null,
        deklaruota: false,
        stebeta: true,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation: null,
        bids,
    };
}

function bidSubject(bid: Bid, procurementOverrides: Partial<Procurement> = {}): BidSubject {
    const procurement = testProcurement(procurementOverrides);
    const lot = testLot([bid]);
    return {
        subjectType: "bid",
        subjectKey: `cvpis:900301:1:${bid.tiekejoKodas}`,
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
        lot,
        bid,
    };
}

function assessRiskFor(bid: Bid) {
    return ltCom21v1.assessRisk(bidSubject(bid));
}

describe("LtCom21Decision.assessRisk", () => {
    it("triggers when the bid was disqualified as non-conforming to the tender documents", () => {
        const signal = assessRiskFor(nonConformingBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            atmetimoPriezastis: nonConformingBid.atmetimoPriezastis,
            atmetimoTeisinisPagrindas: NON_CONFORMING_BASIS,
            matchedLegalBasis: { law: "VPĮ", straipsnis: 45, dalis: 1, punktas: 1 },
        });
        expect(signal.threshold).toEqual({
            nonGenuineIncompleteIncapableLegalBases: [
                NON_CONFORMING_BASIS,
                UNQUALIFIED_BASIS,
                UNCLARIFIED_BASIS,
                UTILITIES_NON_CONFORMING_BASIS,
                "KSPĮ 58 str. 1 d. 3 p.",
                "KSPĮ 58 str. 1 d. 4 p.",
            ],
        });
    });

    it("triggers when the bidder did not meet the qualification requirements", () => {
        const signal = assessRiskFor(unqualifiedBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            atmetimoPriezastis: unqualifiedBid.atmetimoPriezastis,
            atmetimoTeisinisPagrindas: UNQUALIFIED_BASIS,
            matchedLegalBasis: { law: "VPĮ", straipsnis: 45, dalis: 1, punktas: 3 },
        });
    });

    it("triggers when the bidder failed to clarify or supplement requested documents", () => {
        const signal = assessRiskFor(unclarifiedBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            atmetimoPriezastis: unclarifiedBid.atmetimoPriezastis,
            atmetimoTeisinisPagrindas: UNCLARIFIED_BASIS,
            matchedLegalBasis: { law: "VPĮ", straipsnis: 45, dalis: 1, punktas: 4 },
        });
    });

    it("triggers on the utilities-sector law's twin of the same ground", () => {
        const signal = assessRiskFor(utilitiesNonConformingBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({
            matchedLegalBasis: { law: "KSPĮ", straipsnis: 58, dalis: 1, punktas: 1 },
        });
    });

    it("does not trigger on the utilities-sector law's price ground, exactly as for its VPĮ twin", () => {
        expect(assessRiskFor(utilitiesPriceRejectedBid).state).toBe("not_triggered");
    });

    it("triggers when the law's name is spelled out and the trailing full stop is missing", () => {
        const signal = assessRiskFor(spelledOutLawBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({
            matchedLegalBasis: { law: "VPĮ", straipsnis: 45, dalis: 1, punktas: 1 },
        });
    });

    it("triggers on a citation embedded in the buyer's own prose, ignoring the tender-conditions clause beside it", () => {
        const signal = assessRiskFor(citationInProseBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({
            matchedLegalBasis: { law: "VPĮ", straipsnis: 45, dalis: 1, punktas: 1 },
        });
    });

    it("still excludes the price ground when it is written without its trailing full stop", () => {
        const signal = assessRiskFor(priceRejectedNoTrailingStopBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ matchedLegalBasis: null });
    });

    it("does not trigger on a free-text ground that cites no norm at all — LT-AWD-03's concept", () => {
        const signal = assessRiskFor(disqualifiedFreeTextGroundBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ matchedLegalBasis: null });
    });

    it("does not trigger for a bid that was ranked and never rejected", () => {
        const signal = assessRiskFor(rankedBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({
            atmetimoPriezastis: null,
            atmetimoTeisinisPagrindas: null,
            matchedLegalBasis: null,
        });
    });

    it("does not trigger for a bid disqualified on a price ground — the boundary against a similar but out-of-scope legal basis", () => {
        const signal = assessRiskFor(priceRejectedBid);
        expect(signal.state).toBe("not_triggered");
    });

    it("does not trigger for a disqualified bid whose structured legal basis was left empty (a poorly-supported disqualification, not this indicator's concept)", () => {
        const signal = assessRiskFor(disqualifiedWithoutLegalBasisBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({
            atmetimoPriezastis: disqualifiedWithoutLegalBasisBid.atmetimoPriezastis,
            atmetimoTeisinisPagrindas: null,
            matchedLegalBasis: null,
        });
    });

    it("is total: every known bid shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bid of [nonConformingBid, unqualifiedBid, unclarifiedBid, rankedBid, priceRejectedBid, disqualifiedWithoutLegalBasisBid]) {
            expect(states).toContain(assessRiskFor(bid).state);
        }
    });

    it("is pure: the same bid shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(nonConformingBid)).toEqual(assessRiskFor(nonConformingBid));
    });
});

describe("LtCom21Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom21v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a lot with a non-conforming bid", () => {
        const procurement = testProcurement({ lots: [testLot([nonConformingBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-21",
            subjectType: "bid",
            subjectKey: "cvpis:900301:1:B1",
            state: "triggered",
        });
    });

    it("reports insufficient_data when the bid carries no ranking and no rejection outcome", () => {
        const procurement = testProcurement({ lots: [testLot([noOutcomeBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["eileNumeris", "atmetimoStatusas"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing bid data", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null, lots: [testLot([nonConformingBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });

    it("emits one signal per bid when a lot has several bidders", () => {
        const procurement = testProcurement({ lots: [testLot([nonConformingBid, rankedBid, priceRejectedBid])] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(3);
        expect(signals.map((s) => s.state).sort()).toEqual(["not_triggered", "not_triggered", "triggered"]);
    });

    it("never evaluates a lot with no observed bids", () => {
        const procurement = testProcurement({ lots: [testLot([])] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(0);
    });
});

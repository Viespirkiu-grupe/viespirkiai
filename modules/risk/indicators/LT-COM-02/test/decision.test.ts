import { describe, expect, it } from "vitest";
import { LtCom02Decision, ltCom02v1 } from "../decision.ts";
import { ltCom02Parameters } from "../parameters.ts";
import type { LotParticipation, LotSubject, Procurement, ProcurementSubject } from "../../../types.ts";
import { emptyReport, fiveBidders, REPORTED_AT, threeBidders, twoBidders } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-02: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated participation query actually produces them.

const PARAMETERS = ltCom02Parameters[0].values;

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

function lotSubject(participation: LotParticipation | null, procurementOverrides: Partial<Procurement> = {}): LotSubject {
    const procurement = testProcurement(procurementOverrides);
    return {
        subjectType: "lot",
        subjectKey: "cvpis:900101:0",
        procurementSource: "cvpis",
        procurementId: "900101",
        procurement,
        lot: {
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
        },
    };
}

function decisionFor(participation: LotParticipation) {
    return LtCom02Decision.decide(lotSubject(participation), PARAMETERS);
}

describe("LtCom02Decision.decide", () => {
    it("triggers when only two participants are recorded", () => {
        const decision = decisionFor(twoBidders);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2 });
        expect(decision.threshold).toEqual({ minimumBidders: 3 });
    });

    it("does not trigger at exactly the minimum number of bidders", () => {
        const decision = decisionFor(threeBidders);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 3 });
    });

    it("does not trigger with plenty of participants", () => {
        const decision = decisionFor(fiveBidders);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 5 });
    });

    it("judges the exact threshold boundary", () => {
        expect(LtCom02Decision.decide(lotSubject(threeBidders), { minimumBidders: 3 }).state).toBe("not_triggered");
        expect(LtCom02Decision.decide(lotSubject(threeBidders), { minimumBidders: 4 }).state).toBe("triggered");
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const decision = decisionFor(emptyReport);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence, sourced from the parent procurement's pirkimoBudas", () => {
        for (const participation of [twoBidders, fiveBidders, threeBidders]) {
            expect(decisionFor(participation).evidence).toEqual({
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: participation.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 3, 7]) {
            const decision = decisionFor({ totalBids, validBids: totalBids, reportedAt: REPORTED_AT });
            expect(states).toContain(decision.state);
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        expect(decisionFor(fiveBidders)).toEqual(decisionFor(fiveBidders));
    });

    it("throws when given a procurement subject instead of a lot subject", () => {
        const procurementSubject: ProcurementSubject = {
            subjectType: "procurement",
            subjectKey: "cvpis:1",
            procurementSource: "cvpis",
            procurementId: "1",
            procurement: testProcurement(),
        };
        expect(() => LtCom02Decision.decide(procurementSubject, PARAMETERS)).toThrow(/expected a lot subject/);
    });
});

describe("LtCom02Decision end to end (no database)", () => {
    const RUN = { runId: 1, dataAsOf: "2026-08-01", subjects: null } as const;

    it("assembles a complete signal from a Subject carrying merged participation", () => {
        const [signal] = ltCom02v1.evaluate(RUN, [lotSubject(twoBidders)]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-02",
            subjectType: "lot",
            state: "triggered",
            rawValue: { totalBids: 2 },
        });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const [signal] = ltCom02v1.evaluate(RUN, [lotSubject(null)]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });
});

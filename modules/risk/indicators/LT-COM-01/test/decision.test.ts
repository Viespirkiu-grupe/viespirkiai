import { describe, expect, it } from "vitest";
import { LtCom01Decision, ltCom01v1 } from "../decision.ts";
import { ltCom01Parameters } from "../parameters.ts";
import type { LotParticipation, LotSubject, Procurement, ProcurementSubject } from "../../../types.ts";
import { emptyReport, oneOfTwoRejected, REPORTED_AT, singleBidder, twoValidBidders } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-01: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated participation query actually produces them.

const PARAMETERS = ltCom01Parameters[0].values;

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

function lotSubject(participation: LotParticipation | null, procurementOverrides: Partial<Procurement> = {}): LotSubject {
    const procurement = testProcurement(procurementOverrides);
    return {
        subjectType: "lot",
        subjectKey: "cvpis:900001:0",
        procurementSource: "cvpis",
        procurementId: "900001",
        procurement,
        lot: {
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
        },
    };
}

function decisionFor(participation: LotParticipation) {
    return LtCom01Decision.decide(lotSubject(participation), PARAMETERS);
}

describe("LtCom01Decision.decide", () => {
    it("triggers when exactly one bidder submitted and it was not rejected", () => {
        const decision = decisionFor(singleBidder);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 1, validBids: 1 });
        expect(decision.threshold).toEqual({ maximumValidBids: 1 });
    });

    it("triggers when one of two bidders was rejected, leaving one valid bid", () => {
        const decision = decisionFor(oneOfTwoRejected);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2, validBids: 1 });
    });

    it("does not trigger when two bidders both remain valid", () => {
        const decision = decisionFor(twoValidBidders);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2, validBids: 2 });
    });

    it("judges the exact threshold boundary", () => {
        expect(LtCom01Decision.decide(lotSubject(twoValidBidders), { maximumValidBids: 2 }).state).toBe("triggered");
        expect(LtCom01Decision.decide(lotSubject(twoValidBidders), { maximumValidBids: 1 }).state).toBe("not_triggered");
    });

    it("reports insufficient_data for a report that lists no usable participants", () => {
        const decision = decisionFor(emptyReport);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence, sourced from the parent procurement's pirkimoBudas", () => {
        for (const participation of [singleBidder, twoValidBidders, oneOfTwoRejected]) {
            expect(decisionFor(participation).evidence).toEqual({
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: participation.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 7]) {
            for (const validBids of [0, 1, 2, 7]) {
                const decision = decisionFor({ totalBids, validBids, reportedAt: REPORTED_AT });
                expect(states).toContain(decision.state);
            }
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        expect(decisionFor(oneOfTwoRejected)).toEqual(decisionFor(oneOfTwoRejected));
    });

    it("throws when given a procurement subject instead of a lot subject", () => {
        const procurementSubject: ProcurementSubject = {
            subjectType: "procurement",
            subjectKey: "cvpis:1",
            procurementSource: "cvpis",
            procurementId: "1",
            procurement: testProcurement(),
        };
        expect(() => LtCom01Decision.decide(procurementSubject, PARAMETERS)).toThrow(/expected a lot subject/);
    });
});

describe("LtCom01Decision end to end (no database)", () => {
    const RUN = { runId: 1, dataAsOf: "2026-08-01", subjects: null } as const;

    it("assembles a complete signal from a Subject carrying merged participation", () => {
        const [signal] = ltCom01v1.evaluate(RUN, [lotSubject(singleBidder)]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-01",
            subjectType: "lot",
            state: "triggered",
            rawValue: { totalBids: 1, validBids: 1 },
        });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const [signal] = ltCom01v1.evaluate(RUN, [lotSubject(null)]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing participation", () => {
        const [signal] = ltCom01v1.evaluate(RUN, [lotSubject(null, { saltinis: "cvpp", pirkimoBudas: null })]);
        expect(signal.state).toBe("not_applicable");
    });
});

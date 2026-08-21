import { describe, expect, it } from "vitest";
import { LtCom03Decision, ltCom03v1 } from "../decision.ts";
import { ltCom03Parameters } from "../parameters.ts";
import type { LotSubject, Procurement, ProcurementParticipation, ProcurementSubject } from "../../../types.ts";
import { emptyReport, fiveSuppliers, oneSupplier, REPORTED_AT, twoSuppliers } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-03: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated procurement-grain participation query (including its
// cross-lot union) actually produces them.

const PARAMETERS = ltCom03Parameters[0].values;

function testProcurement(participation: ProcurementParticipation | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900201",
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
        participation,
        ...overrides,
    };
}

function procurementSubject(participation: ProcurementParticipation | null, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(participation, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900201",
        procurementSource: "cvpis",
        procurementId: "900201",
        procurement,
    };
}

function decisionFor(participation: ProcurementParticipation) {
    return LtCom03Decision.decide(procurementSubject(participation), PARAMETERS);
}

describe("LtCom03Decision.decide", () => {
    it("triggers when only one supplier is recorded for the whole procurement", () => {
        const decision = decisionFor(oneSupplier);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 1 });
        expect(decision.threshold).toEqual({ minimumSuppliers: 2 });
    });

    it("does not trigger at exactly the minimum number of suppliers", () => {
        const decision = decisionFor(twoSuppliers);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 2 });
    });

    it("does not trigger with plenty of suppliers", () => {
        const decision = decisionFor(fiveSuppliers);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 5 });
    });

    it("judges the exact threshold boundary", () => {
        expect(LtCom03Decision.decide(procurementSubject(twoSuppliers), { minimumSuppliers: 2 }).state).toBe("not_triggered");
        expect(LtCom03Decision.decide(procurementSubject(twoSuppliers), { minimumSuppliers: 3 }).state).toBe("triggered");
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const decision = decisionFor(emptyReport);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence, sourced from the procurement's own pirkimoBudas", () => {
        for (const participation of [oneSupplier, fiveSuppliers, twoSuppliers]) {
            expect(decisionFor(participation).evidence).toEqual({
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: participation.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalSuppliers of [0, 1, 2, 3, 7]) {
            const decision = decisionFor({ totalSuppliers, reportedAt: REPORTED_AT });
            expect(states).toContain(decision.state);
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        expect(decisionFor(twoSuppliers)).toEqual(decisionFor(twoSuppliers));
    });

    it("throws when given a lot subject instead of a procurement subject", () => {
        const lotSubject: LotSubject = {
            subjectType: "lot",
            subjectKey: "cvpis:1:1",
            procurementSource: "cvpis",
            procurementId: "1",
            procurement: testProcurement(null, { pirkimoNumeris: "1" }),
            lot: {
                subjektoRaktas: "cvpis:1:1",
                saltinis: "cvpis",
                pirkimoNumeris: "1",
                daliesNumeris: "1",
                daliesPavadinimas: null,
                deklaruota: true,
                stebeta: false,
                dalyviuSkaicius: null,
                kainuSkaicius: null,
                atmestuSkaicius: null,
                participation: null,
            },
        };
        expect(() => LtCom03Decision.decide(lotSubject, PARAMETERS)).toThrow(/expected a procurement subject/);
    });
});

describe("LtCom03Decision end to end (no database)", () => {
    const RUN = { runId: 1, dataAsOf: "2026-08-01", subjects: null } as const;

    it("assembles a complete signal from a Subject carrying merged participation", () => {
        const [signal] = ltCom03v1.evaluate(RUN, [procurementSubject(oneSupplier)]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-03",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { totalSuppliers: 1 },
        });
    });

    it("reports insufficient_data when no participation was observed for the procurement", () => {
        const [signal] = ltCom03v1.evaluate(RUN, [procurementSubject(null)]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });
});

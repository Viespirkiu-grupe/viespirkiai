import { describe, expect, it } from "vitest";
import type { Lot, Procurement } from "./types.ts";
import { lotEligibility, procurementEligibility } from "./procurementEligibility.ts";

function procurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "1",
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
        ...overrides,
    };
}

function lot(overrides: Partial<Lot> = {}): Lot {
    return {
        subjektoRaktas: "cvpis:1:1",
        saltinis: "cvpis",
        pirkimoNumeris: "1",
        daliesNumeris: "1",
        daliesPavadinimas: null,
        deklaruota: true,
        stebeta: true,
        dalyviuSkaicius: 1,
        kainuSkaicius: 1,
        atmestuSkaicius: 0,
        participation: null,
        bids: [],
        ...overrides,
    };
}

describe("procurementEligibility", () => {
    it("is eligible when saltinis is cvpis and pirkimoBudas is present", () => {
        expect(procurementEligibility(procurement())).toEqual({ eligible: true });
    });

    it("is not_applicable for a cvpp procurement (never carries pirkimoBudas)", () => {
        expect(procurementEligibility(procurement({ saltinis: "cvpp", pirkimoBudas: null }))).toEqual({
            eligible: false,
            decision: { state: "not_applicable" },
        });
    });

    it("is not_applicable when pirkimoBudas is missing even for a cvpis-sourced row", () => {
        expect(procurementEligibility(procurement({ pirkimoBudas: null }))).toEqual({
            eligible: false,
            decision: { state: "not_applicable" },
        });
    });
});

describe("lotEligibility", () => {
    it("delegates entirely to its parent procurement's gate", () => {
        expect(lotEligibility(lot(), procurement())).toEqual({ eligible: true });
        expect(lotEligibility(lot(), procurement({ saltinis: "cvpp", pirkimoBudas: null }))).toEqual({
            eligible: false,
            decision: { state: "not_applicable" },
        });
    });
});

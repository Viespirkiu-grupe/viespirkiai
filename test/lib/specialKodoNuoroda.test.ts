import { describe, expect, it } from "vitest";
import {
    arSpecialusKodas,
    specialKodoPaieskosNuoroda,
} from "../../src/lib/specialKodoNuoroda.ts";

describe("specialKodoPaieskosNuoroda", () => {
    it("atpažįsta bendrinius CVP IS kodus", () => {
        expect(arSpecialusKodas("809")).toBe(true);
        expect(arSpecialusKodas(801)).toBe(true);
        expect(arSpecialusKodas("110053842")).toBe(false);
        expect(arSpecialusKodas(null)).toBe(false);
        expect(arSpecialusKodas("")).toBe(false);
    });

    it("veda į sutarčių paiešką pagal pavadinimą", () => {
        expect(specialKodoPaieskosNuoroda("809", "ŽYDRŪNAS BUTKUS")).toBe(
            "/?search=%C5%BDYDR%C5%AANAS+BUTKUS&tiekejoKodas=809",
        );
    });

    it("grąžina null, kai kodas realus arba pavadinimo nėra", () => {
        expect(specialKodoPaieskosNuoroda("110053842", "Vilniaus miestas")).toBe(null);
        expect(specialKodoPaieskosNuoroda("809", "  ")).toBe(null);
        expect(specialKodoPaieskosNuoroda("809", null)).toBe(null);
    });
});

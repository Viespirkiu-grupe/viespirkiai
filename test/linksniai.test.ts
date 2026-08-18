import { describe, expect, it } from "vitest";
import {
    linksniuoti,
    linksniuotiK,
    linksniuotiKOnly,
    linksniuotiOnly,
} from "../utils/linksniai.js";

const REZ = ["rezultatas", "rezultatai", "rezultatų", "rezultato"] as const;

describe("linksniuoti", () => {
    it("vienaskaita – 1, 21, 101 (bet ne 11)", () => {
        expect(linksniuoti(1, [...REZ])).toBe("1 rezultatas");
        expect(linksniuoti(21, [...REZ])).toBe("21 rezultatas");
        expect(linksniuoti(101, [...REZ])).toBe("101 rezultatas");
    });

    it("daugiskaita 2–9 galūnėms", () => {
        expect(linksniuoti(2, [...REZ])).toBe("2 rezultatai");
        expect(linksniuoti(9, [...REZ])).toBe("9 rezultatai");
        expect(linksniuoti(22, [...REZ])).toBe("22 rezultatai");
        expect(linksniuoti(103, [...REZ])).toBe("103 rezultatai");
    });

    it("kilmininkas 0, 10–20 ir šimtų dešimtukams", () => {
        expect(linksniuoti(0, [...REZ])).toBe("0 rezultatų");
        expect(linksniuoti(10, [...REZ])).toBe("10 rezultatų");
        expect(linksniuoti(11, [...REZ])).toBe("11 rezultatų");
        expect(linksniuoti(19, [...REZ])).toBe("19 rezultatų");
        expect(linksniuoti(111, [...REZ])).toBe("111 rezultatų");
        expect(linksniuoti(20, [...REZ])).toBe("20 rezultatų");
    });

    it("trupmenoms naudoja ketvirtą formą", () => {
        expect(linksniuoti(1.5, [...REZ])).toBe("1,5 rezultato");
        expect(linksniuoti(2.25, [...REZ])).toBe("2,25 rezultato");
    });
});

describe("linksniuotiOnly", () => {
    it("grąžina tik žodį, be skaičiaus", () => {
        expect(linksniuotiOnly(1, [...REZ])).toBe("rezultatas");
        expect(linksniuotiOnly(3, [...REZ])).toBe("rezultatai");
        expect(linksniuotiOnly(11, [...REZ])).toBe("rezultatų");
    });
});

describe("linksniuotiK", () => {
    it("kilmininkas po „iš“ / „iki“ / „apie“", () => {
        expect(linksniuotiK(1, ["rezultato", "rezultatų"])).toBe("1 rezultato");
        expect(linksniuotiK(21, ["rezultato", "rezultatų"])).toBe("21 rezultato");
        expect(linksniuotiK(2, ["rezultato", "rezultatų"])).toBe("2 rezultatų");
        expect(linksniuotiK(11, ["rezultato", "rezultatų"])).toBe("11 rezultatų");
    });
});

describe("linksniuotiKOnly", () => {
    it("kaip linksniuotiK, tik be skaičiaus", () => {
        expect(linksniuotiKOnly(1, ["sutarties", "sutarčių"])).toBe("sutarties");
        expect(linksniuotiKOnly(11, ["sutarties", "sutarčių"])).toBe("sutarčių");
        expect(linksniuotiKOnly(101, ["sutarties", "sutarčių"])).toBe("sutarties");
        expect(linksniuotiKOnly(5, ["sutarties", "sutarčių"])).toBe("sutarčių");
    });
});

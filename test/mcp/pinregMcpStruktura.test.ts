import { describe, it, expect } from "vitest";
import { pertvarkytiPinregAsmenims } from "../../modules/pinreg/pinregMcpStruktura.js";

describe("pertvarkytiPinregAsmenims", () => {
    it("handles a fully empty result", () => {
        const result = pertvarkytiPinregAsmenims({});
        expect(result).toEqual({
            asmenys: [],
            rysiaiSuJa: [],
            counts: { asmenys: 0, rysiaiSuJa: 0 },
            limit: null,
        });
    });

    it("groups repeated darbovietes rows for the same person into one asmuo", () => {
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "ALGIRDAS",
                    pavarde: "LUKOŠEVIČIUS",
                    pavadinimas: "Savivaldybė",
                    pareigos: "Seniūnas",
                    darbovietesTipas: "STANDARTINE",
                    rysioPradzia: "2000-04-25",
                    rysioPabaiga: null,
                    registruotaLietuvoje: true,
                    uzpildytaAutomatiskai: true,
                    pateikimoData: "2026-03-12 15:06:39",
                },
                {
                    id: "2",
                    deklaracija: "uuid-1",
                    vardas: "ALGIRDAS",
                    pavarde: "LUKOŠEVIČIUS",
                    pavadinimas: "Savivaldybė",
                    darbovietesTipas: "EKSPERTO",
                    rysioPradzia: "2025-05-14",
                    rysioPabaiga: null,
                    registruotaLietuvoje: null,
                    uzpildytaAutomatiskai: false,
                    pateikimoData: "2026-03-12 15:06:39",
                },
            ],
        });

        expect(result.asmenys).toHaveLength(1);
        const asmuo = result.asmenys[0];
        expect(asmuo.asmuo).toBe("Algirdas Lukoševičius");
        expect(asmuo.rysys).toBe("tiesioginis");
        expect(asmuo.deklaracijos).toHaveLength(1);
        expect(asmuo.deklaracijos[0].uuid).toBe("uuid-1");
        expect(asmuo.deklaracijos[0].irasos).toHaveLength(2);
    });

    it("groups multiple declarations for the same person separately", () => {
        const baseRow = {
            vardas: "JURGITA",
            pavarde: "NUTAUTIENĖ",
            pavadinimas: "Savivaldybė",
            rysioPradzia: "2025-11-11",
            pateikimoData: "2026-06-05 13:19:20",
        };
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                { ...baseRow, id: "1", deklaracija: "uuid-a" },
                { ...baseRow, id: "2", deklaracija: "uuid-b", pateikimoData: "2025-01-01 00:00:00" },
            ],
        });

        expect(result.asmenys).toHaveLength(1);
        const asmuo = result.asmenys[0];
        expect(asmuo.deklaracijos).toHaveLength(2);
        expect(asmuo.deklaracijos.map((d: { uuid: string }) => d.uuid)).toEqual(["uuid-a", "uuid-b"]);
    });

    it("titlecases hyphenated surnames", () => {
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "ORNANDA",
                    pavarde: "VIRŽINTAITĖ-METRIKIENĖ",
                    pavadinimas: "Savivaldybė",
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
        });

        expect(result.asmenys[0].asmuo).toBe("Ornanda Viržintaitė-Metrikienė");
    });

    it("maps sutuoktinioDarbovietes to rysys=sutuoktinis with deklaruojantis", () => {
        const result = pertvarkytiPinregAsmenims({
            sutuoktinioDarbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "VINCAS",
                    pavarde: "METRIKIS",
                    susijusioAsmensVardas: "ORNANDA",
                    susijusioAsmensPavarde: "VIRŽINTAITĖ-METRIKIENĖ",
                    pavadinimas: "Savivaldybė",
                    pareigos: "Savivaldybės tarybos narys",
                    darbovietesTipas: "SUTUOKTINIO",
                    rysioPradzia: "2026-05-28",
                    pateikimoData: "2026-05-29 22:12:55",
                },
            ],
        });

        expect(result.asmenys).toHaveLength(1);
        const asmuo = result.asmenys[0];
        expect(asmuo.asmuo).toBe("Vincas Metrikis");
        expect(asmuo.rysys).toBe("sutuoktinis");
        expect(asmuo.deklaruojantis).toBe("Ornanda Viržintaitė-Metrikienė");
    });

    it("maps rysiaiSuJa to rysys=kiti", () => {
        const result = pertvarkytiPinregAsmenims({
            rysiaiSuJa: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "JONAS",
                    pavarde: "JONAITIS",
                    pavadinimas: "Savivaldybė",
                    rysioPobudzioPavadinimas: "Akcininkas",
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
        });

        expect(result.rysiaiSuJa).toHaveLength(1);
        expect(result.rysiaiSuJa[0].asmuo).toBe("Jonas Jonaitis");
        expect(result.rysiaiSuJa[0].rysys).toBe("kiti");
        expect(result.asmenys).toHaveLength(0);
    });

    it("drops censored/duplicate name fields and other identity fields from irasos", () => {
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    uuid: "uuid-1",
                    vardas: "JONAS",
                    pavarde: "JONAITIS",
                    asmuo: "J***s J*******s",
                    irasoTipas: "DEKLARUOJANCIO_DARBOVIETE",
                    jarKodas: "123",
                    pavadinimas: "Savivaldybė",
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
        });

        const iraso = result.asmenys[0].deklaracijos[0].irasos[0];
        expect(iraso.vardas).toBeUndefined();
        expect(iraso.pavarde).toBeUndefined();
        expect(iraso.asmuo).toBeUndefined();
        expect(iraso.irasoTipas).toBeUndefined();
        expect(iraso.jarKodas).toBeUndefined();
        expect(iraso.uuid).toBeUndefined();
        expect(iraso.deklaracija).toBeUndefined();
    });

    it("removes empty/null fields except the always-present core fields", () => {
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "JONAS",
                    pavarde: "JONAITIS",
                    pavadinimas: "Savivaldybė",
                    pareigos: null,
                    pastabos: "",
                    duomenuSaltinis: [],
                    rysioPradzia: "2025-01-01",
                    rysioPabaiga: null,
                    registruotaLietuvoje: null,
                    uzpildytaAutomatiskai: false,
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
        });

        const iraso = result.asmenys[0].deklaracijos[0].irasos[0];
        // Non-core null/empty fields are dropped entirely
        expect(iraso).not.toHaveProperty("pareigos");
        expect(iraso).not.toHaveProperty("pastabos");
        expect(iraso).not.toHaveProperty("duomenuSaltinis");
        // Core fields are always present, even when null/false
        expect(iraso).toHaveProperty("rysioPabaiga", null);
        expect(iraso).toHaveProperty("registruotaLietuvoje", null);
        expect(iraso).toHaveProperty("uzpildytaAutomatiskai", false);
        expect(iraso).toHaveProperty("rysioPradzia", "2025-01-01");
    });

    it("deduplicates identical irasos within the same declaration", () => {
        const row = {
            id: "1",
            deklaracija: "uuid-1",
            vardas: "JONAS",
            pavarde: "JONAITIS",
            pavadinimas: "Savivaldybė",
            pareigos: "Specialistas",
            rysioPradzia: "2025-01-01",
            pateikimoData: "2026-01-01 00:00:00",
        };
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [row, { ...row, id: "2" }],
        });

        expect(result.asmenys[0].deklaracijos[0].irasos).toHaveLength(1);
    });

    it("keeps distinct darbovietesTipas entries within the same declaration", () => {
        const base = {
            deklaracija: "uuid-1",
            vardas: "JONAS",
            pavarde: "JONAITIS",
            pavadinimas: "Savivaldybė",
            rysioPradzia: "2025-01-01",
            pateikimoData: "2026-01-01 00:00:00",
        };
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                { ...base, id: "1", darbovietesTipas: "STANDARTINE", pareigos: "Specialistas" },
                { ...base, id: "2", darbovietesTipas: "EKSPERTO" },
            ],
        });

        expect(result.asmenys[0].deklaracijos[0].irasos).toHaveLength(2);
    });

    it("counts reflect totals before limit is applied, limit caps asmenys/rysiaiSuJa arrays", () => {
        const darbovietes = Array.from({ length: 5 }, (_, i) => ({
            id: String(i),
            deklaracija: `uuid-${i}`,
            vardas: `VARDAS${i}`,
            pavarde: `PAVARDE${i}`,
            pavadinimas: "Savivaldybė",
            rysioPradzia: "2025-01-01",
            pateikimoData: "2026-01-01 00:00:00",
        }));

        const result = pertvarkytiPinregAsmenims({ darbovietes }, { limit: 2 });

        expect(result.counts.asmenys).toBe(5);
        expect(result.asmenys).toHaveLength(2);
        expect(result.limit).toBe(2);
    });

    it("merges direct and spousal entries for the same jarKodas into one asmenys list", () => {
        const result = pertvarkytiPinregAsmenims({
            darbovietes: [
                {
                    id: "1",
                    deklaracija: "uuid-1",
                    vardas: "ALGIRDAS",
                    pavarde: "LUKOŠEVIČIUS",
                    pavadinimas: "Savivaldybė",
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
            sutuoktinioDarbovietes: [
                {
                    id: "2",
                    deklaracija: "uuid-2",
                    vardas: "VINCAS",
                    pavarde: "METRIKIS",
                    susijusioAsmensVardas: "ORNANDA",
                    susijusioAsmensPavarde: "VIRŽINTAITĖ-METRIKIENĖ",
                    pavadinimas: "Savivaldybė",
                    pateikimoData: "2026-01-01 00:00:00",
                },
            ],
        });

        expect(result.asmenys).toHaveLength(2);
        expect(result.asmenys.map((a: { rysys: string }) => a.rysys)).toEqual([
            "tiesioginis",
            "sutuoktinis",
        ]);
    });
});

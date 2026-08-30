import { describe, expect, it, vi } from "vitest";
import {
    formuotiFinansuDuomenis,
    gautiFinansuDuomenis,
} from "../modules/finansai/finansuDuomenys.js";

const eilute = (lineName: string, reiksme: number, overrides = {}) => ({
    ataskaitosTipas: "PELNO_NUOSTOLIU",
    templateId: "FS001",
    templateName: "PELNO (NUOSTOLIŲ) ATASKAITA",
    standardId: "PLN001",
    standardName: "PELNO (NUOSTOLIŲ) ATASKAITOS DUOMENYS",
    lineTypeId: lineName,
    lineName,
    reiksme,
    laikotarpisNuo: "2025-01-01",
    laikotarpisIki: "2025-12-31",
    duomenuData: "2026-05-20",
    ...overrides,
});

describe("RC finansinių ataskaitų skaitymas", () => {
    it("sugrupuoja rodiklius ir apskaičiuoja pelningumą iš seno pavadinimo", () => {
        const result = formuotiFinansuDuomenis([
            eilute("Pardavimo pajamos", 200),
            eilute("Grynasis pelnas", 30),
        ]);

        expect(result.ataskaitos).toHaveLength(1);
        expect(result.lentele.metai).toEqual([2025]);
        expect(result.lentele.duomenys.Pelningumas).toEqual([15]);
    });

    it("apjungia skirtingų metų sinoniminius rodiklių pavadinimus", () => {
        const result = formuotiFinansuDuomenis([
            eilute("Mokėtinos sumos ir įsipareigojimai", 100, {
                laikotarpisNuo: "2024-01-01", laikotarpisIki: "2024-12-31",
            }),
            eilute("Įsipareigojimai", 120),
            eilute("Ataskaitinių metų pelnas (nuostoliai)", 20),
        ]);

        expect(result.lentele.duomenys.Įsipareigojimai).toEqual([100, 120]);
        expect(result.lentele.duomenys["Grynasis pelnas (nuostoliai)"]).toEqual([undefined, 20]);
        expect(result.lentele.duomenys["Mokėtinos sumos ir įsipareigojimai"]).toBeUndefined();
    });

    it("išlaiko SQL eiliškumą, kai ataskaitų ID yra skaitiniai", () => {
        const result = formuotiFinansuDuomenis([
            eilute("Pardavimo pajamos", 200, { ataskaitaId: 20 }),
            eilute("Pardavimo pajamos", 100, {
                ataskaitaId: 3,
                laikotarpisNuo: "2024-01-01",
                laikotarpisIki: "2024-12-31",
            }),
        ]);
        expect(result.ataskaitos.map((ataskaita: any) => ataskaita.ataskaitaId)).toEqual([20, 3]);
    });

    it("iki 2015 m. pasibaigusių laikotarpių litus perskaičiuoja į eurus", () => {
        const result = formuotiFinansuDuomenis([
            eilute("Pardavimo pajamos", 3_452_800, {
                laikotarpisNuo: "2014-01-01",
                laikotarpisIki: "2014-12-31",
            }),
        ]);
        expect(result.lentele.duomenys["Pardavimo pajamos"]).toEqual([1_000_000]);
    });

    it("tais pačiais metais lentelei palieka naujausią pateikimą", () => {
        const result = formuotiFinansuDuomenis([
            eilute("Pardavimo pajamos", 250, { duomenuData: "2026-06-01" }),
            eilute("Pardavimo pajamos", 100, { duomenuData: "2026-05-01" }),
        ]);

        expect(result.lentele.duomenys["Pardavimo pajamos"]).toEqual([250]);
    });

    it("užklausia normalizuotas lenteles pagal JAR kodą", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        await gautiFinansuDuomenis("110004884", db as any);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('"rcJar"."finansinesAtaskaitos"');
        expect(sql).toContain('"rcJar"."finansiniuAtaskaituRodikliuTipai"');
        expect(params).toEqual(["110004884"]);
    });
});

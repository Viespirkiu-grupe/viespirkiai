import { describe, expect, it, vi } from "vitest";
import {
    MINUTE_MS,
    normalizePlanRow,
    normalizeVykdytojoPavadinimas,
    parseCsvText,
    parseLocalMinute,
    parseResultCount,
    planExportIntervals,
    processPlanuojamiPirkimai,
    splitIntoMonths,
} from "../modules/viesiejiPirkimai/scrapePlanuojamiPirkimai.js";

describe("planuojamų pirkimų eksportas", () => {
    it("vykdytojo pavadinimą paruošia JAR paieškai kaip kiti VP scraperiai", () => {
        expect(normalizeVykdytojoPavadinimas("LTG Infra, AB (PV)")).toBe(
            "LTG Infra, AB",
        );
        expect(normalizeVykdytojoPavadinimas("VšĮ Testas pv")).toBe(
            "VšĮ Testas",
        );
    });

    it("atpažįsta visus EPPS rezultatų skaičiaus variantus", () => {
        expect(
            parseResultCount(
                "| Rodomi: <strong>1-100</strong> | <strong>101,086</strong> rezultatai iš viso.",
            ),
        ).toBe(101086);
        expect(parseResultCount("| Rodomos visos <strong>3</strong> atitiktys.")).toBe(3);
        expect(parseResultCount("| Rodomas <strong>1</strong> atitikimas.")).toBe(1);
        expect(parseResultCount("<div>Rezultatų nerasta</div>")).toBe(0);
    });

    it("parsina kabutes, kablelius ir kelių eilučių CSV laukus", () => {
        const header = [
            "Pirkimo vykdytojas",
            "Pirkimo pavadinimas",
            "Aprašymas",
            "Pirkimo tipas",
            "Direktyva",
            "Pirkimo būdas",
            "BVPŽ kodai",
            "Apskaičiuota kaina",
            "Kiekiai",
            "Pirkimo pradžios data",
            "Pasiūlymų teikimo pabaigos/pradžios data",
            "Numatomos pirkimo sutarties trukmė (mėnesiais)",
            "Ketinamos sudaryti pirkimo sutarties trukmė (matavimo vienetas)",
            "Preliminari pirkimo sukūrimo data",
        ];
        const csv =
            header.map((value) => `"${value}"`).join(",") +
            "\r\n" +
            '"UAB ""Testas""","Pavadinimas","eilutė 1\neilutė 2",' +
            Array(10).fill('""').join(",") +
            ',""\r\n';
        const rows = parseCsvText(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0]["Pirkimo vykdytojas"]).toBe('UAB "Testas"');
        expect(rows[0]["Aprašymas"]).toBe("eilutė 1\neilutė 2");
    });

    it("skaido į nesikertančius minučių intervalus ir nepraranda ribų", async () => {
        const start = parseLocalMinute("2026-07-31T00:00");
        const end = parseLocalMinute("2026-07-31T01:59");
        const intervals = await planExportIntervals({
            start,
            end,
            limit: 9_000,
            count: async ({ start: intervalStart, end: intervalEnd }) =>
                (intervalEnd - intervalStart) / MINUTE_MS + 1 > 60 ? 10_000 : 100,
        });
        expect(intervals).toEqual([
            { start, end: start + 59 * MINUTE_MS, count: 100 },
            {
                start: start + 60 * MINUTE_MS,
                end,
                count: 100,
            },
        ]);
    });

    it("bendras ribas pradžioje skaido kalendoriniais mėnesiais", () => {
        const start = parseLocalMinute("2026-07-30T12:30");
        const end = parseLocalMinute("2026-09-01T08:15");
        expect(splitIntoMonths({ start, end })).toEqual([
            {
                start,
                end: parseLocalMinute("2026-07-31T23:59"),
            },
            {
                start: parseLocalMinute("2026-08-01T00:00"),
                end: parseLocalMinute("2026-08-31T23:59"),
            },
            {
                start: parseLocalMinute("2026-09-01T00:00"),
                end,
            },
        ]);
    });

    it("per didelį mėnesį pirmiausia skaido dienomis", async () => {
        const start = parseLocalMinute("2026-06-01T00:00");
        const end = parseLocalMinute("2026-06-30T23:59");
        const calls: Array<{ start: number; end: number }> = [];
        const intervals = await planExportIntervals({
            start,
            end,
            limit: 9_000,
            count: async (interval) => {
                calls.push(interval);
                return interval.start === start && interval.end === end
                    ? 10_000
                    : 100;
            },
        });
        expect(calls[0]).toEqual({ start, end });
        expect(intervals).toHaveLength(30);
        expect(intervals[0]).toEqual({
            start,
            end: parseLocalMinute("2026-06-01T23:59"),
            count: 100,
        });
        expect(intervals.at(-1)).toEqual({
            start: parseLocalMinute("2026-06-30T00:00"),
            end,
            count: 100,
        });
    });

    it("sustoja, kai viena minutė viršija serverio limitą", async () => {
        const minute = parseLocalMinute("2026-07-31T15:31");
        await expect(
            planExportIntervals({
                start: minute,
                end: minute,
                limit: 9_000,
                count: async () => 9_001,
            }),
        ).rejects.toThrow("nepalaiko sekundžių filtro");
    });

    it("normalizuoja tipus, datas, null ir sukuria md5", () => {
        const row = Object.fromEntries(
            [
                "Pirkimo vykdytojas",
                "Pirkimo pavadinimas",
                "Aprašymas",
                "Pirkimo tipas",
                "Direktyva",
                "Pirkimo būdas",
                "BVPŽ kodai",
                "Apskaičiuota kaina",
                "Kiekiai",
                "Pirkimo pradžios data",
                "Pasiūlymų teikimo pabaigos/pradžios data",
                "Numatomos pirkimo sutarties trukmė (mėnesiais)",
                "Ketinamos sudaryti pirkimo sutarties trukmė (matavimo vienetas)",
                "Preliminari pirkimo sukūrimo data",
            ].map((key) => [key, ""]),
        );
        Object.assign(row, {
            "Pirkimo vykdytojas": "UAB Testas",
            "BVPŽ kodai": "12345678, 87654321-0",
            "Apskaičiuota kaina": "12,50",
            "Pirkimo pradžios data": "31/07/2026 10:15:00",
            "Preliminari pirkimo sukūrimo data": "null",
        });
        const normalized = normalizePlanRow(row);
        expect(normalized.bvpzKodai).toEqual(["12345678", "87654321-0"]);
        expect(normalized.apskaiciuotaKaina).toBe(12.5);
        expect(normalized.pirkimoPradziosData).toBe("2026-07-31T10:15:00");
        expect(normalized.preliminariPirkimoSukurimoData).toBeNull();
        expect(normalized).not.toHaveProperty("saltinis");
        expect(normalized).not.toHaveProperty("fingerprint");
        expect(normalized.md5).toMatch(/^[a-f0-9]{32}$/);

        row["Pirkimo pradžios data"] = "31/01/57373 00:00:00";
        const anomalous = normalizePlanRow(row);
        expect(anomalous.pirkimoPradziosData).toBeNull();
        expect(anomalous).not.toHaveProperty("pirkimoPradziosDataRaw");
    });

    it("bendrą procesorių galima naudoti be failo per onRecords callback", async () => {
        const rows = [{
            "Pirkimo vykdytojas": "UAB Testas",
            "Pirkimo pavadinimas": "Pirkimas",
            "Aprašymas": "",
            "Pirkimo tipas": "Paslaugos",
            "Direktyva": "",
            "Pirkimo būdas": "Atviras konkursas",
            "BVPŽ kodai": "12345678",
            "Apskaičiuota kaina": "100",
            "Kiekiai": "",
            "Pirkimo pradžios data": "",
            "Pasiūlymų teikimo pabaigos/pradžios data": "",
            "Numatomos pirkimo sutarties trukmė (mėnesiais)": "",
            "Ketinamos sudaryti pirkimo sutarties trukmė (matavimo vienetas)": "",
            "Preliminari pirkimo sukūrimo data": "",
        }];
        const client = {
            count: vi.fn().mockResolvedValue(1),
            export: vi.fn().mockResolvedValue(rows),
        };
        const received: Array<ReturnType<typeof normalizePlanRow>> = [];
        const result = await processPlanuojamiPirkimai({
            from: "2026-07-31T00:00",
            to: "2026-07-31T23:59",
            client,
            logger: { log: vi.fn() },
            onRecords: async (records) => { received.push(...records); },
        });
        expect(result).toEqual({ total: 1, intervals: 1 });
        expect(received).toHaveLength(1);
        expect(received[0].md5).toMatch(/^[a-f0-9]{32}$/);
    });
});

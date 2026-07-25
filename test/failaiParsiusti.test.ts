import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    getProxyBySite: vi.fn(),
}));

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query: mocks.query },
}));

vi.mock("../modules/scrapeProxies/getProxyBySite.js", () => ({
    getProxyBySite: mocks.getProxyBySite,
}));

vi.mock("../utils/log.js", () => ({
    Logger: class { log() {} },
}));

import { parsiustiFaila } from "../modules/failai/parsiusti.js";
import { pravalytiParsiuntimoRezervacijas } from "../modules/failai/pravalytiParsiuntimuRezervacijas.js";

describe("failų parsisiuntimo bandymai", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getProxyBySite.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("inkrementuoja bandymus atominiu būdu rezervuojant failą", async () => {
        // Užklausos atpažįstamos pagal SQL, ne pagal eiliškumą.
        mocks.query.mockImplementation(async (sql: string) => {
            if (String(sql).includes('"filesDownloadQueue" q')) {
                return { rows: [{ id: 42, pavadinimas: "sutartis.pdf", saltinis: "sutartys", sourceId0: "7", sourceId1: "8" }] };
            }
            if (String(sql).includes("FROM public.dezes")) {
                return {
                    rows: [{ id: 3, pavadinimas: "dėžė", url: "https://box.test", apiKey: "key" }],
                };
            }
            return { rows: [], rowCount: 1 };
        });

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue("download failed"),
        }));

        await expect(parsiustiFaila()).rejects.toThrow("Nepavyko parsisiųsti failo");

        const visos = mocks.query.mock.calls.map((args) => String(args[0]));

        // Bandymas užskaitomas rezervuojant, kartu apskaičiuojamas atidėjimas.
        const claimSql = visos.find((sql) => sql.includes('"filesDownloadQueue" q'))!;
        expect(claimSql).toContain("attempts = q.attempts + 1");
        expect(claimSql).toContain('"nextAttempt" = NOW() +');

        // Klaidos kelias bandymų nebeskaičiuoja — jie suskaičiuoti rezervuojant.
        const klaidosSql = visos.filter((sql) => /SET\s+"downloadStatus" = -1/.test(sql));
        expect(klaidosSql.length).toBeGreaterThan(0);
        for (const sql of klaidosSql) {
            expect(sql).not.toMatch(/attempts\s*=/);
        }
    });

    it("valant užstrigusią rezervaciją to paties bandymo antrąkart neskaičiuoja", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });

        await expect(pravalytiParsiuntimoRezervacijas()).resolves.toBe(true);

        const sql = String(mocks.query.mock.calls[0][0]);
        expect(sql).toContain('"filesDownloadQueue"');
        expect(sql).not.toMatch(/attempts\s*=/);
        expect(sql).toContain('"downloadStatus" = -1');
    });
});

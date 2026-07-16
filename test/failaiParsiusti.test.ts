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
        mocks.query
            .mockResolvedValueOnce({
                rows: [{ id: 42, pavadinimas: "sutartis.pdf", dokId: 7, fileId: 8 }],
            })
            .mockResolvedValueOnce({
                rows: [{ id: 3, pavadinimas: "dėžė", url: "https://box.test", apiKey: "key" }],
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue("download failed"),
        }));

        await expect(parsiustiFaila()).rejects.toThrow("Nepavyko parsisiųsti failo");

        const claimSql = String(mocks.query.mock.calls[0][0]);
        expect(claimSql).toContain("bandymai = COALESCE(q.bandymai, 0) + 1");
        expect(claimSql).toContain('"paskutinisBandymas" = NOW()');

        const failureSql = String(mocks.query.mock.calls[2][0]);
        expect(failureSql).not.toMatch(/bandymai\s*=/);
        expect(failureSql).toContain('"lockedBy" = NULL');
    });

    it("valant užstrigusią rezervaciją to paties bandymo antrąkart neskaičiuoja", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });

        await expect(pravalytiParsiuntimoRezervacijas()).resolves.toBe(true);

        const sql = String(mocks.query.mock.calls[0][0]);
        expect(sql).not.toMatch(/bandymai\s*=/);
        expect(sql).toContain("state                = -1");
    });
});

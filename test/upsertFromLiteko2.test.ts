import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/dokumentai/dokumentaiFs.js", () => ({
    saveDokumentasFs: vi.fn(),
}));

import { saveDokumentasFs } from "../modules/dokumentai/dokumentaiFs.js";
import { upsertLiteko2ToDokumentai } from "../modules/dokumentai/upsertFromLiteko2.js";

describe("LITEKO2 propagavimas į dokumentai", () => {
    beforeEach(() => vi.clearAllMocks());

    it("įrašo dokumentų sidecar ir paieškos eilutę", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
        const sprendimas = {
            md5: "abc123",
            liteko2Id: "09002713826d0048",
            sprendimoData: "2026-08-03T07:36:38Z",
        };
        const sidecar = {
            md5: "abc123",
            class: "teise",
            type: "teismoNuosprendis",
            source: "liteko2",
            saltinioId0: "1-01-1-32513-2022-3",
            saltinioId1: "T-1212-718/2026",
            saltinioId2: "09002713826d0048",
            title: "T-1212-718/2026 — Klaipėdos apylinkės teismas",
            extension: "html",
            wordCount: 42,
            characterCount: 300,
            text: "Sprendimo tekstas",
            metadata: { sprendimoData: "2026-08-03T07:36:38Z", busena: "decs_published" },
        };

        await upsertLiteko2ToDokumentai(sprendimas, sidecar, db);

        expect(saveDokumentasFs).toHaveBeenCalledWith("abc123", sidecar);
        expect(db.query).toHaveBeenCalledOnce();
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain("ON CONFLICT (md5) WHERE source = 'liteko2'");
        expect(params).toEqual([
            "abc123",
            "teise",
            "teismoNuosprendis",
            "liteko2",
            "https://liteko-api-pub.teismas.lt/v1/decisions/09002713826d0048",
            "1-01-1-32513-2022-3",
            "T-1212-718/2026",
            "09002713826d0048",
            "T-1212-718/2026 — Klaipėdos apylinkės teismas",
            "html",
            "text/html",
            "lt",
            42,
            300,
            "2026-08-03T07:36:38Z",
        ]);
    });

    it("atmeta nesutampantį sidecar raktą", async () => {
        const db = { query: vi.fn() };

        await expect(upsertLiteko2ToDokumentai(
            { md5: "vienas", liteko2Id: "id" },
            { md5: "kitas" },
            db,
        )).rejects.toThrow("sidecar md5 nesutampa");

        expect(saveDokumentasFs).not.toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });
});

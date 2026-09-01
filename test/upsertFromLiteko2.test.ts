import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/documents/documentsFs.js", () => ({
    saveDocumentFs: vi.fn(),
}));

import { saveDocumentFs } from "../modules/documents/documentsFs.js";
import { upsertLiteko2ToDocuments } from "../modules/documents/upsertFromLiteko2.js";

describe("LITEKO2 propagavimas į documents", () => {
    beforeEach(() => vi.clearAllMocks());

    it("įrašo dokumentų sidecar ir paieškos eilutę", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [{ documentId: 7 }] }) };
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

        await upsertLiteko2ToDocuments(sprendimas, sidecar, db);

        expect(saveDocumentFs).toHaveBeenCalledWith("abc123", sidecar);
        expect(db.query).toHaveBeenCalledOnce();
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('ON CONFLICT ("sourceId", md5) WHERE md5 IS NOT NULL');
        expect(params).toEqual([
            "teise",
            "teismoNuosprendis",
            "liteko2",
            "https",
            "liteko-api-pub.teismas.lt",
            null,
            "/v1/decisions/09002713826d0048",
            "abc123",
            "T-1212-718/2026 — Klaipėdos apylinkės teismas",
            "lt",
            "html",
            "text/html",
            null,
            42,
            300,
            "2026-08-03T07:36:38Z",
            null,
            null,
            null,
            "1-01-1-32513-2022-3",
            "T-1212-718/2026",
            "09002713826d0048",
            null,
            null,
            null,
        ]);
    });

    it("atmeta nesutampantį sidecar raktą", async () => {
        const db = { query: vi.fn() };

        await expect(upsertLiteko2ToDocuments(
            { md5: "vienas", liteko2Id: "id" },
            { md5: "kitas" },
            db,
        )).rejects.toThrow("sidecar md5 nesutampa");

        expect(saveDocumentFs).not.toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });
});

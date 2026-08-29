import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    readDocumentFs: vi.fn(),
}));

vi.mock("../../postgres/postgres.js", () => ({
    postgres: { query: mocks.query },
}));

vi.mock("../../modules/documents/documentsFs.js", () => ({
    readDocumentFs: mocks.readDocumentFs,
}));

import {
    handler,
    sliceDocumentText,
} from "../../modules/mcp/tools/getDokumentasTekstas.js";

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 42,
        md5: "0123456789abcdef0123456789abcdef",
        type: "teisesAktas",
        source: "etar",
        pavadinimas: "Dokumentas",
        url: "https://example.test/document",
        failasId: null,
        pasleptas: false,
        ...overrides,
    };
}

function payload(result: Awaited<ReturnType<typeof handler>>) {
    return JSON.parse(result.content[0].text);
}

describe("get_dokumentas_tekstas", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockResolvedValue({ rows: [row()] });
        mocks.readDocumentFs.mockResolvedValue({ text: "Pirmas antras trečias ketvirtas" });
    });

    it("grąžina paprastą tekstą dalimis ir tęsinio poziciją", async () => {
        const first = payload(await handler({ id: 42, pozicija: 0, kiekis: 20 }));

        expect(first.dokumentoId).toBe(42);
        expect(first.tipas).toBe("teisesAktas");
        expect(first.tekstas).toBe("Pirmas antras ");
        expect(first.meta.yraDaugiau).toBe(true);
        expect(first.meta.sekantiPozicija).toBe(14);

        const second = payload(
            await handler({ id: 42, pozicija: first.meta.sekantiPozicija, kiekis: 20 }),
        );
        expect(first.tekstas + second.tekstas).toBe("Pirmas antras trečias ketvirtas");
        expect(second.meta.yraDaugiau).toBe(false);
        expect(second.meta.sekantiPozicija).toBeNull();
    });

    it("normalizuoja failo JSON puslapių masyvą", async () => {
        mocks.query.mockResolvedValue({ rows: [row({ type: "failas", failasId: 77 })] });
        mocks.readDocumentFs.mockResolvedValue({ text: '["Pirmas puslapis","Antras puslapis"]' });

        const result = payload(await handler({ id: 42, pozicija: 0, kiekis: 100 }));

        expect(result.failoId).toBe(77);
        expect(result.tekstas).toBe("Pirmas puslapis Antras puslapis");
    });

    it("grąžina aiškią tuščio teksto būseną", async () => {
        mocks.readDocumentFs.mockResolvedValue({ text: null });

        const result = payload(await handler({ id: 42, pozicija: 0, kiekis: 100 }));

        expect(result.tekstas).toBe("");
        expect(result.meta.pastaba).toBe("Dokumentas teksto neturi.");
        expect(result.meta.yraDaugiau).toBe(false);
    });

    it.each([
        [[], "nerastas"],
        [[row({ pasleptas: true })], "nėra viešai pasiekiamas"],
        [[row({ md5: null })], "neturi teksto saugyklos rakto"],
    ])("atmeta nepasiekiamą dokumentą", async (rows, message) => {
        mocks.query.mockResolvedValue({ rows });

        const result = await handler({ id: 42, pozicija: 0, kiekis: 100 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(message);
        expect(mocks.readDocumentFs).not.toHaveBeenCalled();
    });

    it("atskiria nerastą sidecar ir poziciją už teksto pabaigos", async () => {
        mocks.readDocumentFs.mockResolvedValueOnce(null);
        const missing = await handler({ id: 42, pozicija: 0, kiekis: 100 });
        expect(missing.isError).toBe(true);
        expect(missing.content[0].text).toContain("saugykloje nerastas");

        mocks.readDocumentFs.mockResolvedValueOnce({ text: "trumpas" });
        const pastEnd = await handler({ id: 42, pozicija: 9, kiekis: 100 });
        expect(pastEnd.isError).toBe(true);
        expect(pastEnd.content[0].text).toContain("už dokumento teksto pabaigos");
    });
});

describe("sliceDocumentText", () => {
    it("nekerta UTF-16 poros", () => {
        expect(sliceDocumentText("abc😀def", 0, 4)).toEqual({ text: "abc😀", end: 5 });
        expect(sliceDocumentText("😀def", 0, 1)).toEqual({ text: "😀", end: 2 });
    });
});

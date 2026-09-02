import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    gautiNuosprendiPagalUuid: vi.fn(),
}));

vi.mock("../../modules/liteko/nuosprendisPagalUuid.js", () => ({
    gautiNuosprendiPagalUuid: mocks.gautiNuosprendiPagalUuid,
}));

import {
    handler,
    normalizuotiUuid,
} from "../../modules/mcp/tools/getTeismoNuosprendis.js";

const UUID = "df247241-d5d5-409c-b085-754cec5ac3f1";

function sprendimas(overrides: Record<string, unknown> = {}) {
    return {
        saltinis: "liteko",
        dokumentoId: 13909296,
        n: {
            id: 1,
            md5: "0123456789abcdef0123456789abcdef",
            litekoId: UUID,
            bylosNumeris: "e2YT-954-1138/2026",
            teisminisProcesoNr: "2-36-3-02203-2025-0",
            teismas: "Šiaulių apylinkės teismas",
            data: new Date("2026-01-15T00:00:00Z"),
        },
        dalyviai: [
            { pavadinimas: "UAB Pavyzdys", kodas: "123456789", bylojeKaip: "Atsakovas", isJar: true },
            { pavadinimas: "A. B.", kodas: null, bylojeKaip: "Ieškovas", isJar: false },
        ],
        kategorijos: [{ kodas: "2.4.2.8.", pavadinimas: "Daiktinė teisė" }],
        teisejai: ["Vaidas Kazlauskas"],
        vieta: "Šiauliai",
        tekstas: "Pirmas antras trečias ketvirtas",
        litekoUrl: `https://liteko.teismai.lt/viesasprendimupaieska/tekstas.aspx?id=${UUID}`,
        ...overrides,
    };
}

function payload(result: Awaited<ReturnType<typeof handler>>) {
    return JSON.parse(result.content[0].text);
}

// handler grąžina sąjungą (su isError ir be) — testui patogiau vienas tipas.
function klaida(result: Awaited<ReturnType<typeof handler>>) {
    return result as { isError?: boolean; content: { text: string }[] };
}

describe("get_teismo_nuosprendis", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.gautiNuosprendiPagalUuid.mockResolvedValue(sprendimas());
    });

    it("grąžina bylos duomenis, dalyvius ir tekstą dalimis", async () => {
        const first = payload(await handler({ uuid: UUID, pozicija: 0, kiekis: 20 }));

        expect(first.litekoId).toBe(UUID);
        expect(first.dokumentoId).toBe(13909296);
        expect(first.data).toBe("2026-01-15");
        expect(first.teisejai).toEqual(["Vaidas Kazlauskas"]);
        expect(first.kategorijos).toEqual(["Daiktinė teisė"]);
        expect(first.dalyviai[0]).toEqual({
            pavadinimas: "UAB Pavyzdys",
            kodas: "123456789",
            vaidmuo: "Atsakovas",
            jarKodas: "123456789",
        });
        expect(first.dalyviai[1].jarKodas).toBeNull();
        expect(first.viespirkiaiUrl).toBe(`https://viespirkiai.org/teismoNuosprendis/${UUID}`);
        expect(first.tekstas).toBe("Pirmas antras ");
        expect(first.meta.yraDaugiau).toBe(true);

        const second = payload(
            await handler({ uuid: UUID, pozicija: first.meta.sekantiPozicija, kiekis: 20 }),
        );
        expect(first.tekstas + second.tekstas).toBe("Pirmas antras trečias ketvirtas");
        expect(second.meta.sekantiPozicija).toBeNull();
    });

    it("nurodo, kai teksto dar nėra", async () => {
        mocks.gautiNuosprendiPagalUuid.mockResolvedValue(sprendimas({ tekstas: null }));

        const result = payload(await handler({ uuid: UUID }));
        expect(result.tekstas).toBe("");
        expect(result.meta.simboliuIsViso).toBe(0);
        expect(result.meta.pastaba).toBeTruthy();
    });

    it("praneša apie nerastą sprendimą", async () => {
        mocks.gautiNuosprendiPagalUuid.mockResolvedValue(null);

        const result = klaida(await handler({ uuid: "nera-tokio" }));
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("nerastas");
    });

    it("grąžina klaidą, kai pozicija už teksto pabaigos", async () => {
        const result = klaida(await handler({ uuid: UUID, pozicija: 9999 }));
        expect(result.isError).toBe(true);
    });

    it("išrenka identifikatorių iš adreso", () => {
        expect(normalizuotiUuid(UUID)).toBe(UUID);
        expect(normalizuotiUuid(`https://viespirkiai.org/teismoNuosprendis/${UUID}`)).toBe(UUID);
        expect(
            normalizuotiUuid(`https://liteko.teismai.lt/viesasprendimupaieska/tekstas.aspx?id=${UUID}`),
        ).toBe(UUID);
        expect(
            normalizuotiUuid("https://liteko-api-pub.teismas.lt/v1/decisions/09002711829c4977"),
        ).toBe("09002711829c4977");
    });
});

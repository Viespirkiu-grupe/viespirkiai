import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    readETarSidecar: vi.fn(),
    readESeimasSidecar: vi.fn(),
}));

vi.mock("../../postgres/postgres.js", () => ({
    postgres: { query: mocks.query },
}));

vi.mock("../../modules/eTar/eTarSidecar.js", () => ({
    readETarSidecar: mocks.readETarSidecar,
}));

vi.mock("../../modules/eSeimas/eSeimasSidecar.js", () => ({
    readESeimasSidecar: mocks.readESeimasSidecar,
}));

import { handler as textHandler } from "../../modules/mcp/tools/getTeisesAktoTekstas.js";
import { handler as excerptHandler } from "../../modules/mcp/tools/getTeisesAktoIstrauka.js";

function documentRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 42,
        md5: "0123456789abcdef0123456789abcdef",
        type: "teisesAktas",
        source: "etar",
        pavadinimas: "Teisės aktas",
        url: "https://example.test/act",
        failasId: null,
        pasleptas: false,
        ...overrides,
    };
}

function node(
    partId: string,
    label: string,
    text: string,
    children: unknown[] = [],
) {
    return { part_id: partId, label, text, children };
}

function parse(result: any) {
    return JSON.parse(result.content[0].text);
}

const ACT = { teisesAktoId: "TAR.TEST", versijosId: "version-1" };

describe("teisės akto MCP tekstas", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockResolvedValue({ rows: [documentRow()] });
    });

    it("trumpą aktą grąžina visą net kai jis turi struktūrą", async () => {
        mocks.readETarSidecar.mockResolvedValue({
            official_text: {
                text: "Trumpas teisės akto tekstas.",
                structure: [node("part_root", "Pagrindinė dalis", "Trumpas tekstas")],
            },
        });

        const result = parse(await textHandler(ACT));

        expect(result.rezimas).toBe("visas_tekstas");
        expect(result.tekstas).toBe("Trumpas teisės akto tekstas.");
        expect(result.dalys).toBeUndefined();
    });

    it("ilgam struktūriniam aktui grąžina turinį ir leidžia išskleisti šaką", async () => {
        const chapter = node("part_chapter", "I SKYRIUS", "Skyriaus antraštė", [
            node("part_1", "1 straipsnis", "Pirmo straipsnio tekstas"),
            node("part_2", "2 straipsnis", "Antro straipsnio tekstas"),
        ]);
        mocks.readETarSidecar.mockResolvedValue({
            official_text: {
                text: "A ".repeat(16_000),
                structure: [node("part_root", "Pagrindinė dalis", "Akto pradžia", [chapter])],
            },
        });

        const root = parse(await textHandler(ACT));
        expect(root.rezimas).toBe("turinys");
        expect(root.dalys).toHaveLength(1);
        expect(root.dalys[0]).toMatchObject({ partId: "part_chapter", vaikuKiekis: 2 });

        const children = parse(await textHandler({ ...ACT, parentId: "part_chapter" }));
        expect(children.dalys.map((part: any) => part.partId)).toEqual(["part_1", "part_2"]);
    });

    it("ilgą aktą be struktūros grąžina nuosekliomis dalimis", async () => {
        mocks.readETarSidecar.mockResolvedValue({
            official_text: { text: "Žodis ".repeat(6_000), structure: [] },
        });

        const result = parse(await textHandler({ ...ACT, kiekis: 100 }));

        expect(result.rezimas).toBe("teksto_dalis");
        expect(result.tekstas.length).toBeLessThanOrEqual(100);
        expect(result.meta.turiStruktura).toBe(false);
        expect(result.meta.sekantiPozicija).toBeGreaterThan(0);
    });

    it("atmeta ne teisės aktą", async () => {
        mocks.query.mockResolvedValue({ rows: [documentRow({ type: "teismoNuosprendis" })] });

        const result = await textHandler(ACT);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("nėra teisės aktas");
        expect(mocks.readETarSidecar).not.toHaveBeenCalled();
    });
});

describe("teisės akto MCP ištrauka", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockResolvedValue({ rows: [documentRow()] });
        mocks.readETarSidecar.mockResolvedValue({
            official_text: {
                text: "Visas tekstas",
                structure: [
                    node("part_chapter", "I SKYRIUS", "Skyriaus antraštė", [
                        node("part_1", "1 straipsnis", "Pirmo straipsnio tekstas"),
                        node("part_2", "2 straipsnis", "Antro straipsnio tekstas"),
                    ]),
                ],
            },
        });
    });

    it("grąžina pasirinktą dalį su poskyriais ir nedubliuoja pasirinkto vaiko", async () => {
        const result = parse(await excerptHandler({
            ...ACT,
            dalys: ["part_chapter", "part_1"],
            kiekis: 1_000,
        }));

        expect(result.pasirinktosDalys).toHaveLength(1);
        expect(result.pasirinktosDalys[0].partId).toBe("part_chapter");
        expect(result.tekstas).toContain("Skyriaus antraštė");
        expect(result.tekstas).toContain("Pirmo straipsnio tekstas");
        expect(result.tekstas).toContain("Antro straipsnio tekstas");
    });

    it("aktui be struktūros nurodo naudoti teksto įrankį", async () => {
        mocks.readETarSidecar.mockResolvedValue({
            official_text: { text: "Tekstas", structure: [] },
        });

        const result = await excerptHandler({ ...ACT, dalys: ["part_1"] });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("get_teises_akto_tekstas");
    });

    it("e-Seimo aktui naudoja e-Seimo sidecar", async () => {
        mocks.query.mockResolvedValue({ rows: [documentRow({ source: "eSeimas" })] });
        mocks.readESeimasSidecar.mockResolvedValue({
            official_text: { text: "Tekstas", structure: [node("part_1", "Dalis", "Tekstas")] },
        });

        const result = parse(await excerptHandler({ ...ACT, dalys: ["part_1"] }));

        expect(result.tekstas).toContain("Tekstas");
        expect(mocks.readESeimasSidecar).toHaveBeenCalledOnce();
        expect(mocks.readETarSidecar).not.toHaveBeenCalled();
    });

    it("teisės aktą ir versiją DB išrenka tiesiai pagal viešus identifikatorius", async () => {
        const result = parse(await excerptHandler({ ...ACT, dalys: ["part_1"] }));

        expect(result.teisesAktoId).toBe("TAR.TEST");
        expect(result.versijosId).toBe("version-1");
        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toContain('d."saltinioId0" = $1');
        expect(sql).toContain('d."saltinioId3" = $2 OR d."saltinioId1" = $2');
        expect(params).toEqual(["TAR.TEST", "version-1"]);
    });
});

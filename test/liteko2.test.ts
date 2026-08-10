import { describe, expect, it } from "vitest";
import { failoUrl } from "../modules/liteko2/api.js";
import { liteko2Md5 } from "../modules/liteko2/sidecar.js";
import {
    skaidytiTeiseja,
    sudarytiSidecar,
    tekstasIsHtml,
} from "../modules/liteko2/scrapeContent.js";

const detail = {
    id: "1056",
    liteko2Id: "09002713826d0048",
    court: "Klaipėdos apylinkės teismas",
    courtId: "KLDCP",
    chamber: "Klaipėdos apylinkės teismo Klaipėdos rūmai",
    chamberId: "KLCDC",
    caseType: "Baudžiamoji byla",
    caseTypeId: "ct_crimc",
    caseNumber: "T-1212-718/2026",
    caseSeqNumber: "1212",
    processNumber: "1-01-1-32513-2022-3",
    dateReceived: "2026-06-22",
    caseDesc: "Dėl priverčiamosios medicinos priemonės taikymo",
    decisionDate: "2026-08-03T07:36:38Z",
    decisionType: "Nuasmeninta nutartis",
    decisionTypeId: "cdt_017",
    decisionStatus: "decs_published",
    decisionJudges: [{ id: "110027118000be18", codeName: "718 Laimutė Venckuvienė" }],
    decisionCategories: [{ liteko2Id: "cc_51246", categoryName: "BAUDŽIAMOJI TEISĖ\r\n" }],
    caseParties: [
        {
            id: "1979",
            liteko2Id: "0800271382473c3e",
            partyType: "Pareiškėjas",
            partyName: "Klaipėdos psichikos sveikatos centras",
            partyCode: "141879453",
        },
    ],
    decisionFiles: [],
};

describe("liteko2 identitetas", () => {
    it("md5 priklauso tik nuo liteko2Id", () => {
        expect(liteko2Md5("abc")).toBe(liteko2Md5("abc"));
        expect(liteko2Md5("abc")).not.toBe(liteko2Md5("abd"));
    });

    it("failo URL atkuriamas iš id ir vardo (DB jo nesaugom)", () => {
        expect(failoUrl("09002713826d0048", "2026-08-03_Nuasmeninta+nutartis_T-1212-718_2026.html"))
            .toBe("/v1/decisions/09002713826d0048/files/2026-08-03_Nuasmeninta%2Bnutartis_T-1212-718_2026.html");
    });

    it("teisėjo kodą atskiria nuo vardo", () => {
        expect(skaidytiTeiseja("718 Laimutė Venckuvienė"))
            .toEqual({ kodas: "718", vardas: "Laimutė Venckuvienė" });
        expect(skaidytiTeiseja("Vardenis Pavardenis"))
            .toEqual({ kodas: null, vardas: "Vardenis Pavardenis" });
    });
});

describe("liteko2 teksto ištraukimas", () => {
    it("neįtraukia LibreOffice <style> turinio į tekstą", () => {
        const html = `<!DOCTYPE html><html><head><title>Byla</title>
            <style>p { margin-bottom: 0in }</style></head>
            <body><p>NUTARTIS</p><p>Teismas nutaria.</p></body></html>`;
        const tekstas = tekstasIsHtml(html);

        expect(tekstas).toContain("NUTARTIS");
        expect(tekstas).toContain("Teismas nutaria.");
        expect(tekstas).not.toContain("margin-bottom");
        expect(tekstas).not.toContain("Byla");
    });
});

describe("liteko2 sidecar", () => {
    const sidecar = sudarytiSidecar(
        { liteko2Id: detail.liteko2Id, md5: liteko2Md5(detail.liteko2Id) },
        detail,
        { tekstas: "Byla dėl UAB, kodas 302913434, sprendimo.", html: "<p>x</p>" },
    );

    it("išsaugo dokumentų paieškai reikalingus identifikatorius", () => {
        expect(sidecar.source).toBe("liteko2");
        expect(sidecar.saltinioId0).toBe("1-01-1-32513-2022-3");
        expect(sidecar.saltinioId1).toBe("T-1212-718/2026");
        expect(sidecar.saltinioId2).toBe("09002713826d0048");
        expect(sidecar.title).toBe("T-1212-718/2026 — Klaipėdos apylinkės teismas");
    });

    it("surenka JAR kodus ir iš šalių, ir iš teksto", () => {
        expect(sidecar.jarKodai).toEqual(expect.arrayContaining([141879453, 302913434]));
    });

    it("nukerpa klasifikatorių pavadinimų „\\r\\n“ uodegas", () => {
        expect(sidecar.metadata.kategorijos).toEqual(["BAUDŽIAMOJI TEISĖ"]);
        expect(sidecar.metadata.kategorijuKodai).toEqual(["cc_51246"]);
        expect(sidecar.metadata.teisejai).toEqual(["Laimutė Venckuvienė"]);
    });
});

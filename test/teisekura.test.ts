import { describe, expect, it } from "vitest";
import { cleanEseimasUrl, parseProjectResults } from "../modules/eseimas/scrape.js";
import { cleanEseimasText, parseProjectPage } from "../modules/eseimas/scrapeContent.js";
import { contentHash, stableMd5 } from "../modules/teisekura/upsertDokumentas.js";

describe("teisekura identity", () => {
    it("keeps stable md5 independent of document contents", () => {
        expect(stableMd5("eseimas", "abc")).toBe(stableMd5("eseimas", "abc"));
        expect(stableMd5("eseimas", "abc")).not.toBe(stableMd5("eseimas", "def"));
        expect(contentHash({ text: "a" })).not.toBe(contentHash({ text: "b" }));
    });
});

describe("e-Seimas parsing", () => {
    it("removes placeholder emails without leaving broken punctuation", () => {
        expect(cleanEseimasText(
            "Ministerija, Viktorija Sankauskaitė, [email protected], +370 660 53101",
        )).toBe("Ministerija, Viktorija Sankauskaitė, +370 660 53101");
        expect(cleanEseimasText(
            "tel. +370 706 64 845, el. p. [email protected], http://eimin.lrv.lt.",
        )).toBe("tel. +370 706 64 845, http://eimin.lrv.lt.");
    });

    it("removes transient search navigation parameters from URLs", () => {
        expect(cleanEseimasUrl(
            "/portal/legalAct/lt/TAP/xyz?positionInSearchResults=212&searchModelUUID=uuid&lang=lt",
        )).toBe("https://e-seimas.lrs.lt/portal/legalAct/lt/TAP/xyz?lang=lt");
    });

    it("parses project result rows", () => {
        const rows = parseProjectResults(`
          <table>
            <thead><tr><th></th><th>Eil. Nr.</th><th>Rūšis</th><th>Pavadinimas</th>
              <th>Dok. Nr.</th><th>Reg. data</th><th>Būsena</th></tr></thead>
            <tbody><tr data-ri="0"><td></td><td>1</td><td>Projektas</td>
              <td><a href="/portal/legalAct/lt/TAP/xyz?positionInSearchResults=1&searchModelUUID=uuid">Pavadinimas</a></td>
              <td>XIVP-1</td><td>2026-01-01</td><td>Registruotas</td></tr></tbody>
          </table>
        `);
        expect(rows[0].sourceId).toBe("xyz");
        expect(rows[0].url).toBe("https://e-seimas.lrs.lt/portal/legalAct/lt/TAP/xyz");
        expect(rows[0].registracijosNr).toBe("XIVP-1");
        expect(rows[0].registravimoData).toBe("2026-01-01");
        expect(rows[0].busena).toBe("Registruotas");
    });

    it("rejects a project status parsed as its registration date", () => {
        expect(() => parseProjectResults(`
          <table><tr data-ri="0"><td></td><td>1</td><td>Projektas</td>
          <td><a href="/portal/legalAct/lt/TAP/xyz">Pavadinimas</a></td>
          <td>XIVP-1</td><td>Derinama</td><td>Registruotas</td></tr></table>
        `)).toThrow("registravimo data: Derinama");
    });

    it("parses project metadata and links", () => {
        const parsed = parseProjectPage(`
          <h1>Projektas</h1><table>
            <tr><td>Būsena:</td><td>Priimtas</td></tr>
            <tr><td>Parengė:</td><td>Ministerija, [email protected], +370 600 00000</td></tr>
          </table>
          <a href="https://e-tar.lt/portal/lt/legalAct/abc">Aktas</a>
        `, "https://e-seimas.lrs.lt/portal/legalActProject/xyz/lt");
        expect((parsed.metadata as Record<string, string>).Būsena).toBe("Priimtas");
        expect((parsed.metadata as Record<string, string>).Parengė).toBe("Ministerija, +370 600 00000");
        expect(parsed.links[0].url).toContain("e-tar.lt");
    });
});

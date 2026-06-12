import { describe, expect, it } from "vitest";
import { cleanEseimasUrl, parseProjectResults } from "../modules/eseimas/scrape.js";
import { cleanEseimasText, parseProjectPage } from "../modules/eseimas/scrapeContent.js";
import { buildSearchBody, buildSearchRangeBody, parseResultsHtml, parseSearchForm } from "../modules/etar/scrape.js";
import { parseActPage } from "../modules/etar/scrapeContent.js";
import { contentHash, stableMd5 } from "../modules/teisekura/upsertDokumentas.js";
import { editionSourceIdFromUrl } from "../modules/etar/ids.js";

describe("teisekura identity", () => {
    it("keeps stable md5 independent of document contents", () => {
        expect(stableMd5("etar", "abc")).toBe(stableMd5("etar", "abc"));
        expect(stableMd5("etar", "abc")).not.toBe(stableMd5("etar", "def"));
        expect(contentHash({ text: "a" })).not.toBe(contentHash({ text: "b" }));
    });

    it("distinguishes editions that share the root act URL", () => {
        expect(editionSourceIdFromUrl("https://e-tar.lt/portal/lt/legalAct/abc?editionId=red-1"))
            .toBe("abc:edition:red-1");
    });
});

describe("e-TAR parsing", () => {
    it("discovers dynamic search form action and adoption date fields", () => {
        const form = parseSearchForm(`
          <form id="contentForm" action="/portal/lt/legalActSearch?buildNumber=abc">
            <input name="contentForm_SUBMIT" value="1">
            <input name="javax.faces.ViewState" value="state">
            <input type="checkbox" name="contentForm:searchParamPane:paramToggleButton_input" checked>
            <label for="dynamic-from">Priėmimo data</label>
            <input id="dynamic-from" name="dynamic-from">
            <label for="dynamic-to">Priėmimo data iki</label>
            <input id="dynamic-to" name="dynamic-to">
            <select name="contentForm:searchParamPane:paramSortBy_input">
              <option value="registrationDate" selected>Priėmimo data</option>
            </select>
          </form>
        `);
        const body = buildSearchBody(form, "1918-01-01", true);
        expect(form.action).toContain("buildNumber=abc");
        expect(body.get("dynamic-from")).toBe("1918-01-01");
        expect(body.get("dynamic-to")).toBe("");
        expect(body.get("contentForm:searchParamPane:sortOrderOptionSelect_input")).toBe("on");
        expect(body.get("contentForm:searchParamPane:paramToggleButton_input")).toBe("on");

        const descending = buildSearchRangeBody(form, { to: "2026-05-11" });
        expect(descending.get("dynamic-from")).toBe("");
        expect(descending.get("dynamic-to")).toBe("2026-05-11");
        expect(descending.has("contentForm:searchParamPane:sortOrderOptionSelect_input")).toBe(false);
    });

    it("parses search rows and stable legal act URL", () => {
        const rows: any[] = parseResultsHtml(`
          <table><tr data-ri="0"><td></td><td>1</td><td>Įsakymas</td>
          <td><a href="/portal/lt/legalAct/abc">Aktas</a></td><td>V-1</td>
          <td>2026-01-02</td><td><span class="dateColumn">2026-01-03</span></td><td></td></tr></table>
        `);
        expect(rows[0].href).toContain("/legalAct/abc");
        expect(rows[0].pavadinimas).toBe("Aktas");
    });

    it("keeps rich metadata outside postgres-ready inventory", () => {
        const parsed = parseActPage(`
          <span id="mainForm:laTitle">Testas</span>
          <table class="legalActHeaderTable">
            <tr><td>Rūšis:</td><td>Įsakymas</td></tr>
            <tr><td>Priėmė:</td><td>Šilalės rajono savivaldybės taryba
              <script>PrimeFaces.cw("OverlayPanel")</script>
            </td></tr>
          </table>
          <iframe id="legalActFrame" src="/rs/legalact/abc/"></iframe>
          <a href="/portal/lt/legalAct/edition-1?editionId=edition-1">Redakcija</a>
        `, "https://e-tar.lt/portal/lt/legalAct/abc");
        expect(parsed.metadata.rusis).toBe("Įsakymas");
        expect(parsed.metadata.prieme).toBe("Šilalės rajono savivaldybės taryba");
        expect((parsed.editions[0] as any).sourceId).toBe("abc:edition:edition-1");
    });

    it("ignores raw-source download links masquerading as editions", () => {
        const parsed = parseActPage(`
          <span id="mainForm:laTitle">Testas</span>
          <iframe id="legalActFrame" src="/rs/legalact/abc/"></iframe>
          <a href="https://e-tar.lt/rs/actualedition/abc/doYQlgHucm/format/MSO2010_DOCX/">DOCX</a>
          <a href="https://e-tar.lt/rs/actualedition/abc/doYQlgHucm/format/OO3_ODT/">ODT</a>
          <a href="/portal/lt/legalAct/abc?editionId=red-1">Redakcija</a>
        `, "https://e-tar.lt/portal/lt/legalAct/abc");
        expect(parsed.editions.map((e: any) => e.sourceId)).toEqual(["abc:edition:red-1"]);
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

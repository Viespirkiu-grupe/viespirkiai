import { describe, expect, it, vi } from "vitest";
import {
    fetchKotisHtml,
    kotisDetailUrl,
    kotisListUrl,
    prepareKotisSession,
} from "../modules/kotis/api.js";
import { parseAmount, parseDate, parseDetailPage, parseListPage } from "../modules/kotis/parse.js";
import { initialAmountRanges, parseDiscoverArgs, splitRange } from "../modules/kotis/discover.js";
import { parseDetailArgs } from "../modules/kotis/processDetails.js";

const LIST_HTML = `
<main>
  <h5 class="text-icon">Viso pagalbų: 26</h5>
  <div class="table-responsive"><table class="table table-bordered table-hover"><tbody>
    <tr>
      <td>UAB Gavėjas</td><td>Ministerija</td>
      <td><a href="/paraiskos/view_item/id.2542040">31.08.2026</a></td>
      <td>51.609,60 EUR</td><td>Reglamentas</td><td>De minimis</td><td>Registruota</td>
      <td><a title="Peržiūrėti paraišką" href="/paraiskos/view_item/id.2542040">žiūrėti</a></td>
    </tr>
  </tbody></table></div>
  <ul class="pagination"><a class="page_next page-link" href="?page=2">Pirmyn</a></ul>
</main>`;

const DETAIL_HTML = `
<main>
  <h1>UAB „Gavėjas“ - 301674503</h1>
  <div class="link-group link-group-sm">
    <h5>Pagalbos gavėjo tipas: Juridinis asmuo</h5>
    <h5>Pagalbos gavėjo kodas: 301674503</h5>
    <h5>ID: 2542040</h5>
    <h5>Registracijos kodas: REG-1</h5>
    <h5>Duomenų pildytojas: Ministerija - 188600752</h5>
    <h5>Būsena: Registruota</h5>
    <h5>Versija: 2</h5>
    <h5>Būsenos suteikimo data: 31.08.2026</h5>
    <h5>Pagalbos pateikimo data: 30.08.2026</h5>
  </div>
  <table class="table table-bordered table-hover table-form-data">
    <tr><td data-code="aid_type">Pagalbos tipas</td><td>Nereikšminga (de minimis) pagalba</td></tr>
    <tr><td data-code="aid_kind">Pagalbos rūšis</td><td>Individuali</td></tr>
    <tr><td data-code="aid_provider">Pagalbos teikėjas</td><td>Ministerija - 188600752</td></tr>
    <tr><td data-code="aid_date">Pagalbos suteikimo data</td><td>2026-08-31</td></tr>
    <tr><td data-code="aid_amount">Pagalbos suma</td><td>51.609,60 EUR</td></tr>
    <tr><td data-code="aid_form">Pagalbos forma</td><td>Garantija</td></tr>
    <tr><td data-code="approved_expenses">Garantuojama suma</td><td>40.000,00 EUR</td></tr>
    <tr><td data-code="has_related_subjects">Susiję subjektai</td><td>Taip</td></tr>
    <tr><td data-code="special_rules">Taikomos taisyklės</td><td>Laikinoji sistema</td></tr>
    <tr><td data-code="special_rules">Taikomos taisyklės</td><td>Kita sistema</td></tr>
    <tr><td data-code="legal_basis_1">Norminis aktas</td><td>Įstatymas Nr. 1</td></tr>
  </table>
  <h5 class="my-20 text-icon">Susiję asmenys/subjektai:</h5>
  <ul class="list-group">
    <li class="list-group-item"><span><strong>1.</strong> UAB Susijusi (306984324)</span><span>Susijęs subjektas</span></li>
  </ul>
</main>`;

describe("KOTIS parseriai", () => {
    it("skaito lietuviškas sumas ir datas", () => {
        expect(parseAmount("98.850.000,00 EUR")).toBe(98_850_000);
        expect(parseAmount("51609.60 EUR")).toBe(51_609.6);
        expect(parseAmount("98.850.000")).toBe(98_850_000);
        expect(parseAmount("1.234")).toBe(1_234);
        expect(parseAmount(51_609.6)).toBe(51_609.6);
        expect(parseDate("31.08.2026")).toBe("2026-08-31");
        expect(parseDate("2026-08-31 12:00")).toBe("2026-08-31");
    });

    it("sąraše ID ima iš nuorodos ir seka puslapiavimą", () => {
        const result = parseListPage(LIST_HTML, kotisListUrl("2026-08-31"));
        expect(result.total).toBe(26);
        expect(result.rows).toEqual([expect.objectContaining({
            id: 2_542_040,
            gavejas: "UAB Gavėjas",
            suteikimoData: "2026-08-31",
            suma: 51_609.6,
        })]);
        expect(result.nextUrl).toContain("page=2");
    });

    it("absoliučias KOTIS nuorodas nukreipia per naudojamą proxy hostą", () => {
        const html = LIST_HTML
            .replaceAll('href="/paraiskos/view_item/id.2542040"',
                'href="https://kotis.kt.gov.lt/paraiskos/view_item/id.2542040"')
            .replace('href="?page=2"',
                'href="https://kotis.kt.gov.lt/paraiskos?page=2"');
        const result = parseListPage(html, "http://10.1.10.1:9205/paraiskos");

        expect(result.rows[0].url).toBe("http://10.1.10.1:9205/paraiskos/view_item/id.2542040");
        expect(result.nextUrl).toBe("http://10.1.10.1:9205/paraiskos?page=2");
    });

    it("sudaro kelių dienų sąrašo URL", () => {
        const url = new URL(kotisListUrl("2026-08-01", 3, "2026-08-31", {
            amountFrom: "100.01",
            amountTo: "1000.00",
            ordering: "id.desc",
        }));
        expect(url.searchParams.get("aid_date[from]")).toBe("2026-08-01");
        expect(url.searchParams.get("aid_date[to]")).toBe("2026-08-31");
        expect(url.searchParams.get("page")).toBe("3");
        expect(url.searchParams.get("aid_amount[from]")).toBe("100.01");
        expect(url.searchParams.get("aid_amount[to]")).toBe("1000.00");
        expect(url.searchParams.get("ordering")).toBe("id.desc");
    });

    it("kortelę sieja pagal data-code ir išskiria susijusį subjektą", () => {
        const result = parseDetailPage(DETAIL_HTML, kotisDetailUrl(2_542_040));
        expect(result).toEqual(expect.objectContaining({
            id: 2_542_040,
            gavejas: { pavadinimas: "UAB „Gavėjas“", kodas: "301674503" },
            suteikimoData: "2026-08-31",
            pagalbosPateikimoData: "2026-08-30",
            suma: 51_609.6,
            versija: 2,
            taisykles: ["Laikinoji sistema", "Kita sistema"],
        }));
        expect(result.finansinesDetales.garantuojamaPaskolosDaliesSuma).toBe(40_000);
        expect(result.susijeSubjektai).toEqual([{
            pavadinimas: "UAB Susijusi",
            kodas: "306984324",
            rysioTipas: "Susijęs subjektas",
            eilesNumeris: 1,
        }]);
    });

    it("atmeta puslapį be rezultatų lentelės ir be aiškaus tuščio rezultato", () => {
        expect(() => parseListPage("<main>Prisijunkite</main>", "https://kotis.kt.gov.lt/paraiskos"))
            .toThrow("nerasta rezultatų lentelė");
        expect(() => parseListPage(
            '<main><div class="alert alert-info my-3">Duomenų šiuo metu nėra dėl klaidos</div></main>',
            "https://kotis.kt.gov.lt/paraiskos",
        )).toThrow("nerasta rezultatų lentelė");
        expect(parseListPage(
            '<main><div class="alert alert-info my-3">Pagalbų nerasta</div></main>',
            "https://kotis.kt.gov.lt/paraiskos",
        )).toEqual({ rows: [], total: 0, nextUrl: null, pageSize: null });
    });
});

describe("KOTIS HTTP", () => {
    it("nustato 1000 įrašų puslapį KOTIS sesijoje", async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(
                "<form method='post' class='form pager_value'><input value='csrf' name='_token'></form>",
                { status: 200, headers: { "Set-Cookie": "PHPSESSID=session; Path=/" } },
            ))
            .mockResolvedValueOnce(new Response("", { status: 302 }));

        await prepareKotisSession({ fetchImpl });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(String(fetchImpl.mock.calls[0][0])).toContain("ff=1");
        expect(fetchImpl.mock.calls[1][0]).toContain("/general/setwrap");
        expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe("PHPSESSID=session");
        expect(fetchImpl.mock.calls[1][1].body.get("wrap")).toBe("1000");
    });

    it("kartoja 429 ir grąžina vėlesnį sėkmingą atsakymą", async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response("limit", { status: 429 }))
            .mockResolvedValueOnce(new Response("ok", { status: 200 }));
        const wait = vi.fn().mockResolvedValue(undefined);
        await expect(fetchKotisHtml("https://example.test", { fetchImpl, wait })).resolves.toBe("ok");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledOnce();
    });

    it("nekartoja netinkamos 4xx užklausos", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
        await expect(fetchKotisHtml("https://example.test", { fetchImpl }))
            .rejects.toThrow("HTTP 400");
        expect(fetchImpl).toHaveBeenCalledOnce();
    });
});

describe("KOTIS CLI", () => {
    it("dalija per didelį datos intervalą į dvi nepersidengiančias dalis", () => {
        expect(splitRange("2026-08-01", "2026-08-04")).toEqual([
            { from: "2026-08-01", to: "2026-08-02" },
            { from: "2026-08-03", to: "2026-08-04" },
        ]);
        expect(splitRange("2026-08-01", "2026-08-01")).toBeNull();
    });

    it("sumos intervalus sudaro centų tikslumu be tarpų ir persidengimų", () => {
        const ranges = initialAmountRanges();
        expect(ranges[0]).toEqual({ amountFrom: 0n, amountTo: 10_000n });
        for (let index = 1; index < ranges.length; index++) {
            expect(ranges[index].amountFrom).toBe(ranges[index - 1].amountTo + 1n);
        }
        expect(ranges.at(-1)?.amountTo).toBe(10n ** 20n - 1n);
    });

    it("be parametrų atranda visą registrą", () => {
        expect(parseDiscoverArgs([])).toEqual(expect.objectContaining({
            mode: "fullReconcile",
            from: "2016-01-01",
        }));
    });

    it("full režimui ima visą KOTIS laikotarpį", () => {
        expect(parseDiscoverArgs(["--mode", "fullReconcile", "--to", "2026-08-31"]))
            .toEqual(expect.objectContaining({ from: "2016-01-01", to: "2026-08-31" }));
    });

    it("griežtai validuoja argumentus", () => {
        expect(() => parseDiscoverArgs(["--from", "2026-02-30"])).toThrow("kalendorinė data");
        expect(() => parseDiscoverArgs(["--wat"])).toThrow("Nežinomas argumentas");
        expect(() => parseDiscoverArgs(["--from"])).toThrow("trūksta reikšmės");
        expect(() => parseDetailArgs(["--concurrency", "0"])).toThrow("teigiamas");
    });

    it("atskirai skaito kortelių workerio parametrus", () => {
        expect(parseDetailArgs(["--concurrency", "4", "--limit", "20"]))
            .toEqual({ help: false, concurrency: 4, maxAttempts: 10, limit: 20 });
    });
});

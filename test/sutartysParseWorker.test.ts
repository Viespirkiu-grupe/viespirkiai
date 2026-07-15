import { describe, expect, it } from "vitest";
import { parseSutartysHtml } from "../modules/sutartys/parsePage.js";
import { parseSutartysHtmlInWorker } from "../modules/sutartys/parsePageInWorker.js";

const contractsHtml = `
<!doctype html>
<html><body>
  <table id="lenetele_table">
    <tr id="topRow"><th>Antraštė</th></tr>
    <tr id="vptpublic_main_7">
      <td></td>
      <td><a>Sutarties pavadinimas</a><span class="ProcurementType">Paslaugos</span></td>
      <td><a>Organizacija</a><a>123456789</a></td>
      <td><a>Tiekėjas</a><a>987654321</a><a>Kitas tiekėjas</a><a>111111111</a></td>
      <td>1.234,56 €</td>
      <td>2026-01-01</td>
      <td>2027-01-01</td>
      <td>500,25 €</td>
      <td>2026-06-01</td>
      <td>Pirkimo sutartis</td>
    </tr>
    <tr id="vptpublic_extra_7"><td><table>
      <tr><td><b>Paskelbimo data</b></td><td><span title="Paskutinio atnaujinimo data 2026-06-03">2026-06-02</span> atnaujinimo data</td></tr>
      <tr><td><b>BVPŽ kodas</b></td><td>Pagrindinis pavadinimas <a>12345678</a> Papildomas pavadinimas <a>87654321</a></td></tr>
      <tr><td><b>Paskutinio redagavimo data</b></td><td>2026-06-04</td></tr>
      <tr><td><b>Sutarties unikalus ID</b></td><td>7001</td></tr>
      <tr><td><b>Sutarties numeris</b></td><td>SUT-7</td></tr>
      <tr><td><b>Pirkimo numeris</b></td><td>PIRK-7</td></tr>
      <tr><td><b>Dokumentai</b></td><td>
        <a href="/download?dok_id=7&amp;file_id=8">sutartis.pdf</a>
        <a href="/Politika.pdf">politika.pdf</a>
      </td></tr>
    </table></td></tr>
  </table>
  <div class="counter">Puslapis 1 iš 2 (51)</div>
</body></html>`;

describe("sutartys HTML parser worker", () => {
    it("returns the same cloneable JSON as the local parser", async () => {
        const local = parseSutartysHtml(contractsHtml);
        const offThread = await parseSutartysHtmlInWorker(contractsHtml);

        const localComparable: any = structuredClone(local);
        const workerComparable: any = structuredClone(offThread);
        delete localComparable.sutartys[0].paskutiniKartaMatyta;
        delete workerComparable.sutartys[0].paskutiniKartaMatyta;
        expect(workerComparable).toEqual(localComparable);
        expect(offThread.status).toBe("ok");
        expect(offThread.total).toBe("51");
        expect(offThread.sutartys).toHaveLength(1);
        expect(offThread.sutartys[0]).toMatchObject({
            pavadinimas: "Sutarties pavadinimas",
            kategorija: "Paslaugos",
            verte: "1234.56 ",
            faktineIvykdimoVerte: "500.25",
            sutartiesUnikalusID: "7001",
            paskelbimoData: "2026-06-02",
            paskutinioAtnaujinimoData: "2026-06-03",
            paskutinioRedagavimoData: "2026-06-04",
            sutartiesNumeris: "SUT-7",
            pirkimoNumeris: "PIRK-7",
            bvpzKodas: "12345678",
            bvpzPavadinimas: "Pagrindinis pavadinimas",
            papildomiBvpzKodai: ["87654321"],
            papildomiBvpzPavadinimai: ["Papildomas pavadinimas"],
            papildomiTiekejai: ["Kitas tiekėjas"],
            papildomiTiekejaiKodai: ["111111111"],
            dokumentuKiekis: 1,
            dokumentai: [{
                pavadinimas: "sutartis.pdf",
                url: "https://eviesiejipirkimai.lt/download?dok_id=7&file_id=8",
            }],
        });
    });

    it("transfers raw response bytes and decodes HTML inside the worker", async () => {
        const bytes = new TextEncoder().encode(contractsHtml);
        const buffer = bytes.buffer;
        const result = await parseSutartysHtmlInWorker(buffer);

        expect(buffer.byteLength).toBe(0);
        expect(result.status).toBe("ok");
        expect(result.sutartys[0].pavadinimas).toBe("Sutarties pavadinimas");
    });

    it("reports maintenance and missing-table pages without main-thread DOM work", async () => {
        await expect(
            parseSutartysHtmlInWorker("<h2>Vyksta sistemos atnaujinimo darbai</h2>"),
        ).resolves.toEqual({ status: "maintenance", sutartys: [], total: null });
        await expect(
            parseSutartysHtmlInWorker("<html><body>Prisijungimas</body></html>"),
        ).resolves.toEqual({ status: "missing-table", sutartys: [], total: null });
    });

    it("decodes the real site's named euro entity before numeric import", () => {
        const html = `<table id="lenetele_table">
          <tr id="topRow"><th>H</th></tr>
          <tr id="vptpublic_main_1675305860">
            <td></td>
            <td><a>Įvairūs dekoratyviniai daiktai</a><span class="ProcurementType">Prekės</span></td>
            <td><a>Kretingos ligoninė</a><a>190300571</a></td>
            <td><a>Kaya home, MB</a><a>306021253</a></td>
            <td>&euro;29,00</td><td>2025-10-16</td><td>2025-10-16</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>MVPŽ</td>
          </tr>
          <tr id="vptpublic_extra_1675305860"><td></td><td><table>
            <tr><td><i><b>BVPŽ kodas:</b></i></td><td>Įvairūs dekoratyviniai daiktai <a>39298900-6</a></td></tr>
            <tr><td><i><b>Paskelbimo data:</b></td><td><span title="Paskutinio atnaujinimo data 2025-10-28 17:42:49">2025-10-28 17:42:49</span></i></td></tr>
            <tr><td><i><b>Paskutinio redagavimo data: </b></td><td>2025-10-28 17:42:49</i></td></tr>
            <tr><td><b>Sutarties numeris:</b></td><td>KA 4720</td></tr>
            <tr><td><i><b>Sutarties unikalus ID:</b></td><td>1675305860</i></td></tr>
          </table></td></tr>
        </table>`;

        const result = parseSutartysHtml(html);
        expect(result.sutartys[0]).toMatchObject({
            sutartiesUnikalusID: "1675305860",
            verte: "29.00",
            faktineIvykdimoVerte: "",
            faktineIvykdimoData: "",
            bvpzKodas: "39298900-6",
            bvpzPavadinimas: "Įvairūs dekoratyviniai daiktai",
        });
    });
});

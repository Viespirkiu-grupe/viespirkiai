import { describe, expect, it } from "vitest";
import { parseDokPuslapi } from "../modules/rcJarDokumentai/parse.js";
import { INSERT_SQL } from "../modules/rcJarDokumentai/irasymas.js";

/** Minimalus dok.php karkasas – tik tai, ką parseris tikrai skaito. */
const puslapis = (turinys: string) => `<html><body><main class="rca">
<table><tr><td>Juridinis asmuo: <b>UAB InnoForce</b>, kodas <b>302676496</b></td></tr></table>
${turinys}
</main></body></html>`;

const lentele = (eilutes: string) => puslapis(`<div class="rc_table"><table id="dokumentai_tbl">
<thead><tr><th>Dokumentas / aprašymas</th><th>Dokumento data</th><th>Gavimo data</th>
<th>Registravimo data</th><th>Lapų sk.</th></tr></thead>
<tbody>${eilutes}</tbody></table></div>`);

const eilute = (id: string, langeliai: string[]) =>
    `<tr bgcolor="#ffffff"${id}>${langeliai.map((l) => `<td>${l}</td>`).join("")}</tr>`;

describe("rcJarDokumentai dok.php parsinimas", () => {
    it("nuskaito antraštę", () => {
        const r = parseDokPuslapi(lentele(""));
        expect(r.pavadinimas).toBe("UAB InnoForce");
        expect(r.jarKodas).toBe(302676496);
        expect(r.irasuNerasta).toBe(false);
    });

    it("skiria dokumento tipą nuo aprašymo per pirmą „ / “", () => {
        const r = parseDokPuslapi(lentele(eilute("", [
            "Finansinės atskaitomybės dokumentai / 2025 m. finansinė atskaitomybė, aiškinamasis raštas",
            "2026-05-04", "2026-05-13", "2026-05-13", "",
        ])));
        expect(r.eilutes).toEqual([{
            rcId: null,
            tipas: "Finansinės atskaitomybės dokumentai",
            aprasymas: "2025 m. finansinė atskaitomybė, aiškinamasis raštas",
            dokumentoData: "2026-05-04",
            gavimoData: "2026-05-13",
            registravimoData: "2026-05-13",
            lapuSkaicius: null,
        }]);
    });

    it("eilutę be „ / “ palieka be aprašymo ir paima RC dokumento ID", () => {
        const r = parseDokPuslapi(lentele(eilute(' id="tr_13286314"', [
            "Prašymas registruoti Juridinių asmenų registre JAR-1-E",
            "2024-11-25", "2024-11-25", "2024-11-25", "1",
        ])));
        expect(r.eilutes[0]).toEqual({
            rcId: 13286314,
            tipas: "Prašymas registruoti Juridinių asmenų registre JAR-1-E",
            aprasymas: null,
            dokumentoData: "2024-11-25",
            gavimoData: "2024-11-25",
            registravimoData: "2024-11-25",
            lapuSkaicius: 1,
        });
    });

    it("sunormina dvigubus tarpus, naujas eilutes ir uodegas", () => {
        // RC realiai taip ir rašo: dvigubas tarpas viduje, tarpas pabaigoje.
        const r = parseDokPuslapi(lentele(eilute(' id="tr_5679342"', [
            "Prašymas registruoti Juridinių asmenų\n registre / Dėl vadovo duomenų  įregistravimo ",
            "2013-11-11", "2013-11-11", "2013-11-14", "6",
        ])));
        expect(r.eilutes[0].tipas).toBe("Prašymas registruoti Juridinių asmenų registre");
        expect(r.eilutes[0].aprasymas).toBe("Dėl vadovo duomenų įregistravimo");
    });

    it("skelia tik per pirmą „ / “ – likę lieka aprašyme", () => {
        const r = parseDokPuslapi(lentele(eilute("", [
            "Įsakymas / Dėl įgaliojimų / papildymas", "2013-03-18", "2013-03-27", "2013-03-28", "1",
        ])));
        expect(r.eilutes[0].tipas).toBe("Įsakymas");
        expect(r.eilutes[0].aprasymas).toBe("Dėl įgaliojimų / papildymas");
    });

    it("netvarkingas datas ir lapų skaičių paverčia į null", () => {
        const r = parseDokPuslapi(lentele(eilute("", [
            "Įgaliojimas", "–", "", "2020-03-09", "n/d",
        ])));
        expect(r.eilutes[0].dokumentoData).toBeNull();
        expect(r.eilutes[0].gavimoData).toBeNull();
        expect(r.eilutes[0].registravimoData).toBe("2020-03-09");
        expect(r.eilutes[0].lapuSkaicius).toBeNull();
    });

    it("nežinomą kodą atpažįsta kaip „Įrašų nerasta“, o ne klaidą", () => {
        // Tokiame puslapyje RC nerodo nė antraštės su pavadinimu ir kodu.
        const r = parseDokPuslapi(
            '<html><body><main class="rca"><div class="klaida">Įrašų nerasta</div></main></body></html>',
        );
        expect(r.irasuNerasta).toBe(true);
        expect(r.eilutes).toEqual([]);
        expect(r.jarKodas).toBeNull();
        expect(r.pavadinimas).toBeNull();
    });
});

describe("rcJarDokumentai įrašymo SQL", () => {
    it("turi po atskirą ON CONFLICT abiem dalinėms unikalioms rūšims", () => {
        expect(INSERT_SQL).toContain('ON CONFLICT ("rcId") WHERE "rcId" IS NOT NULL');
        expect(INSERT_SQL).toContain('WHERE "rcId" IS NULL\n        DO UPDATE SET');
    });

    it("žodyno id ima „esama UNION ALL ką tik įterpta“ šablonu", () => {
        expect(INSERT_SQL).toContain('UNION ALL SELECT "id" FROM ins_tipai');
        expect(INSERT_SQL).toContain('UNION ALL SELECT "id" FROM ins_aprasymai');
    });
});

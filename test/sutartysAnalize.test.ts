import { describe, expect, it } from "vitest";
// adm-zip does not publish TypeScript declarations.
// @ts-expect-error
import AdmZip from "adm-zip";
import { buildAnalize, buildAnalizeXlsx } from "@/modules/sutartys/analize.js";

const rows = [
    {
        tipas: "K",
        tipoPavadinimas: "Sutartis",
        pavadinimas: "Testas & patikra",
        verte: 100,
        faktineIvykdimoVerte: 120,
        perkanciojiOrganizacija: "Pirkėjas",
        perkanciosiosOrganizacijosKodas: "1",
        tiekejai: ["Tiekėjas"],
        tiekejaiKodai: ["2"],
        bvpzKodai: ["45000000"],
        bvpzPavadinimai: ["Statybos darbai"],
        sudarymoData: "2025-01-02",
        sutartiesUnikalusId: 3,
    },
];

describe("sutarčių analizės eksportas", () => {
    it("grupuoja pagal tiekėjus, pirkėjus, BVPŽ ir metus", () => {
        const analysis = buildAnalize(rows);
        expect(analysis.tiekejai[0]).toMatchObject({ kodas: "2", suma: 120, kiekis: 1 });
        expect(analysis.pirkejai[0]).toMatchObject({ kodas: "1", suma: 120, kiekis: 1 });
        expect(analysis.bvpz[0]).toMatchObject({ kodas: "45000000", suma: 120, kiekis: 1 });
        expect(analysis.metai[0]).toMatchObject({ kodas: "2025", suma: 120, kiekis: 1 });
    });

    it("sukuria XLSX be XLSX bibliotekos", () => {
        const zip = new AdmZip(buildAnalizeXlsx(rows));
        const workbook = zip.readAsText("xl/workbook.xml");
        expect(workbook).toContain('name="Sutartys"');
        expect(workbook).toContain('name="BVPŽ"');
        expect(zip.readAsText("xl/worksheets/sheet2.xml")).toContain("Testas &amp; patikra");
        expect(zip.getEntry("xl/charts/chart1.xml")).toBeTruthy();
    });

    it("neįtraukia SP pakeitimų į analizės sumas", () => {
        const analysis = buildAnalize([
            ...rows,
            {
                ...rows[0],
                tipas: "SP",
                sutartiesUnikalusId: 4,
                faktineIvykdimoVerte: 999,
            },
        ]);

        expect(analysis.santrauka[0].reiksme).toBe(2);
        expect(analysis.santrauka[1].reiksme).toBe(120);
        expect(analysis.tiekejai[0].suma).toBe(120);
    });
});

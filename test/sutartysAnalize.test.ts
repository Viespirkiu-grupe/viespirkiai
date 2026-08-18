import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import {
    buildAnalize,
    buildAnalizeXlsx,
    canExportAnalizeXlsx,
    XLSX_EXPORT_LIMIT,
} from "@/modules/sutartys/analize.js";

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
    it("leidžia eksportuoti iki 100 000 sutarčių imtinai", () => {
        expect(XLSX_EXPORT_LIMIT).toBe(100_000);
        expect(canExportAnalizeXlsx(100_000)).toBe(true);
        expect(canExportAnalizeXlsx(100_001)).toBe(false);
        expect(canExportAnalizeXlsx(20_001)).toBe(true);
        expect(canExportAnalizeXlsx(-1)).toBe(false);
    });

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
        // Diagramos pašalintos — jokių chart/drawing dalių ar nuorodų į jas.
        expect(zip.getEntry("xl/charts/chart1.xml")).toBeFalsy();
        expect(zip.getEntry("xl/drawings/drawing1.xml")).toBeFalsy();
        expect(zip.readAsText("[Content_Types].xml")).not.toMatch(/chart|drawing/i);
        expect(zip.readAsText("xl/worksheets/sheet1.xml")).not.toContain("<drawing");
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

import { describe, expect, it } from "vitest";
import { toBaseCompanyName } from "../modules/juridiniai/pavadinimas.js";
import {
    buildDoc,
    splitBatch,
} from "../modules/juridiniai/typesenseProcessIndexQueue.js";

describe("toBaseCompanyName", () => {
    it("nuima teisinę formą, kabutes ir diakritikus", () => {
        expect(toBaseCompanyName('UAB „Būsto“')).toBe("busto");
        expect(toBaseCompanyName("Akcinė bendrovė Šiaulių bankas")).toBe("siauliu bankas");
        expect(toBaseCompanyName("MB Vėjas, filial.")).toBe("vejas filialas");
    });

    it("išmeta skliaustuose esančius paaiškinimus", () => {
        expect(toBaseCompanyName("VšĮ Centras (buvęs Fondas)")).toBe("centras");
    });

    it("išplečia trumpinius, kad sutaptų su registro pavadinimu", () => {
        expect(toBaseCompanyName("Muitinės departamentas prie LR finansų ministerijos"))
            .toBe(
                "muitines departamentas prie lietuvos respublikos finansu ministerijos",
            );
    });

    it("tuščią įvestį grąžina kaip tuščią eilutę", () => {
        expect(toBaseCompanyName("")).toBe("");
        expect(toBaseCompanyName(null as unknown as string)).toBe("");
    });

    it("kartotiniai kvietimai duoda tą patį rezultatą (RegExp lastIndex)", () => {
        const name = 'UAB „Būsto“';
        expect(toBaseCompanyName(name)).toBe(toBaseCompanyName(name));
    });
});

describe("buildDoc", () => {
    it("prideda pavadinimasBase ir jarKodas paverčia tekstu", () => {
        const doc = buildDoc({
            jarKodas: 123456789,
            pavadinimas: 'UAB „Būsto“',
            adresas: "Vilnius, Gedimino pr. 1",
            registravimoData: "2020-01-15",
            isregistruotas: false,
            formosPavadinimas: "Uždaroji akcinė bendrovė",
            statusoPavadinimas: "Teisinis statusas neįregistruotas",
        });

        expect(doc.jarKodas).toBe("123456789");
        expect(doc.pavadinimasBase).toBe("busto");
        expect(doc.isregistruotas).toBe(false);
    });
});

describe("splitBatch", () => {
    const rows = [
        { jarKodas: "1", pavadinimas: "UAB Alfa", isregistruotas: true },
        { jarKodas: "2", pavadinimas: "UAB Beta", isregistruotas: true },
    ];

    it("dingusius įrašus paverčia trynimais", () => {
        const claimed = [
            { id: 1, jarKodas: "1" },
            { id: 2, jarKodas: "3" },
        ];
        const { toIndex, toDelete } = splitBatch(claimed, rows.slice(0, 1));

        expect(toIndex.map((d) => d.jarKodas)).toEqual(["1"]);
        expect(toDelete).toEqual(["3"]);
    });

    it("to paties kodo pasikartojimus sujungia į vieną dokumentą", () => {
        const claimed = [
            { id: 1, jarKodas: "1" },
            { id: 2, jarKodas: "1" },
            { id: 3, jarKodas: "2" },
        ];
        const { toIndex, toDelete } = splitBatch(claimed, rows);

        expect(toIndex).toHaveLength(2);
        expect(toDelete).toEqual([]);
    });
});

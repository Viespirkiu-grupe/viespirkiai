import { describe, expect, it } from "vitest";
import {
    atrinktiVelesnius,
    tinkamasProcesoNr,
} from "../modules/liteko/nuosprendisPagalUuid.js";

describe("tinkamasProcesoNr", () => {
    it("priima tikrą teisminio proceso numerį", () => {
        expect(tinkamasProcesoNr("2-70-3-15052-2026-5")).toBe(true);
        expect(tinkamasProcesoNr("1-01-0-00003-2017-5")).toBe(true);
    });

    it("atmeta senojo LITEKO užpildus", () => {
        // Pagal šiuos „numerius" susirištų šimtai visiškai nesusijusių bylų.
        for (const nr of ["-", "1-", "1-01", "1-01-1-", "0-00-0-00000-0000-0", "", null, undefined]) {
            expect(tinkamasProcesoNr(nr)).toBe(false);
        }
    });
});

describe("atrinktiVelesnius", () => {
    const data = new Date("2021-06-18T00:00:00Z");

    it("palieka tik vėlesnius už duotą sprendimą", () => {
        const velesni = atrinktiVelesnius(
            [
                { litekoId: "a", data: new Date("2022-03-28T00:00:00Z") },
                { litekoId: "b", data: new Date("2021-06-18T00:00:00Z") },
                { litekoId: "c", data: new Date("2020-02-03T00:00:00Z") },
                { litekoId: "d", data: null },
            ],
            data,
        );
        expect(velesni.map((s) => s.litekoId)).toEqual(["a"]);
    });

    it("be einamojo sprendimo datos vėlesnių nežymi", () => {
        expect(atrinktiVelesnius([{ litekoId: "a", data: new Date() }], null)).toEqual([]);
    });
});

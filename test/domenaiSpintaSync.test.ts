import { describe, expect, it } from "vitest";
import { buildPatch, diffRows } from "@/modules/domenai/spintaSync.js";

describe("domenų Spintos diff", () => {
    it("patchina tik pasikeitusius laukus", () => {
        expect(buildPatch(
            { domain: "example.lt", status: "registered", savininkas: "A" },
            { domain: "example.lt", status: "registered", savininkas: "B" },
            ["domain"],
        )).toEqual({ savininkas: "B" });
    });

    it("NS įrašams sukuria tik realų skirtumą", () => {
        const diff = diffRows(
            [
                { _id: "a", _revision: "ra", ns: "ns1.example.lt" },
                { _id: "b", _revision: "rb", ns: "old.example.lt" },
            ],
            [
                { ns: "ns1.example.lt" },
                { ns: "ns2.example.lt" },
            ],
            "ns",
            "domain",
            "parent",
        );
        expect(diff.inserts).toEqual([{
            _op: "insert",
            domain: { _id: "parent" },
            ns: "ns2.example.lt",
        }]);
        expect(diff.patches).toEqual([]);
        expect(diff.deletes).toEqual([{
            _op: "delete",
            _id: "b",
            _revision: "rb",
        }]);
    });

    it("istorijos įrašą patchina pagal scrapeId", () => {
        const diff = diffRows(
            [{ _id: "h", _revision: "rh", scrapeId: 10, status: "old" }],
            [{ scrapeId: 10, status: "new" }],
            "scrapeId",
            "domain",
            "parent",
        );
        expect(diff.patches).toEqual([{
            _op: "patch",
            _id: "h",
            _revision: "rh",
            status: "new",
        }]);
    });
});

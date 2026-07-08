import { describe, expect, it } from "vitest";
import { buildPatch, diffChildren, syncSutartisToSpinta } from "@/modules/sutartys/spintaSync.js";

describe("sutarčių Spintos diff", () => {
    it("nekuria patch, kai reikšmės sutampa", () => {
        expect(buildPatch(
            { id: 1, pavadinimas: "A", pirkejas: { kodas: "2" } },
            { id: 1, pavadinimas: "A", pirkejas: { kodas: "2" } },
            ["id"],
        )).toEqual({});
    });

    it("patchina tik realiai pasikeitusius laukus, įskaitant null", () => {
        expect(buildPatch(
            { id: 1, pavadinimas: "A", tipas: "K" },
            { id: 1, pavadinimas: null, tipas: "K" },
            ["id"],
        )).toEqual({ pavadinimas: null });
    });

    it("vaikams sukuria tik realius insert, patch ir delete", () => {
        const diff = diffChildren(
            [
                { _id: "a", _revision: "ra", kodas: "1", pavadinimas: "Tas pats" },
                { _id: "b", _revision: "rb", kodas: "2", pavadinimas: "Senas" },
                { _id: "c", _revision: "rc", kodas: "3", pavadinimas: "Trinti" },
            ],
            [
                { kodas: "1", pavadinimas: "Tas pats" },
                { kodas: "2", pavadinimas: "Naujas" },
                { kodas: "4", pavadinimas: "Pridėti" },
            ],
            "kodas",
            "parent",
        );

        expect(diff.inserts).toEqual([{
            _op: "insert",
            sutartis: { _id: "parent" },
            kodas: "4",
            pavadinimas: "Pridėti",
        }]);
        expect(diff.patches).toEqual([{
            _op: "patch",
            _id: "b",
            _revision: "rb",
            pavadinimas: "Naujas",
        }]);
        expect(diff.deletes).toEqual([{
            _op: "delete",
            _id: "c",
            _revision: "rc",
        }]);
    });

    it("pašalina dubliuotus nuotolinius natūralius raktus", () => {
        const diff = diffChildren(
            [
                { _id: "a", kodas: "1", pavadinimas: "A" },
                { _id: "b", kodas: "1", pavadinimas: "A" },
            ],
            [{ kodas: "1", pavadinimas: "A" }],
            "kodas",
            "parent",
        );
        expect(diff.deletes).toEqual([{ _op: "delete", _id: "b" }]);
        expect(diff.patches).toEqual([]);
        expect(diff.inserts).toEqual([]);
    });

    it("po parent insert randa _id pagal sutarties id, jei batch atsakyme jo nėra", async () => {
        const calls: Array<{ model: string; params: unknown }> = [];
        const spinta = {
            async getAll(model: string, params: unknown) {
                calls.push({ model, params });
                if (model === "Sutartis" && calls.filter((call) => call.model === "Sutartis").length === 2) {
                    return { _data: [{ _id: "parent-1", id: 1676067013 }] };
                }
                return { _data: [] };
            },
            async batch(model: string, ops: unknown[]) {
                expect(model).toBe("Sutartis");
                expect(ops).toHaveLength(1);
                return { _data: [{}] };
            },
        };

        const stats = await syncSutartisToSpinta({
            id: 1676067013,
            row: { sutartiesUnikalusId: 1676067013 },
            spinta,
        });

        expect(stats.insert).toBe(1);
        expect(calls).toEqual([
            { model: "Sutartis", params: { id: 1676067013 } },
            { model: "Sutartis", params: { id: 1676067013 } },
        ]);
    });
});

import { describe, expect, it, vi } from "vitest";
import { gautiJarPapildomusDuomenis } from "../modules/juridiniai/jarPapildomiDuomenys.js";

describe("papildomi RC duomenys juridinio asmens puslapiui", () => {
    it("grąžina sujungtus žodynų pavadinimus ir perduoda dokumentų limitą", async () => {
        const expected = {
            zymos: [], savanoryste: [], jangis: null,
            finansiniuAtaskaituAnuliavimai: [],
            finansiniuAtaskaituVelavimas: null,
            finansiniuAtaskaituNepateikimai: [],
            dokumentai: { count: 0, rows: [] },
        };
        const db = { query: vi.fn().mockResolvedValue({ rows: [expected] }) };

        const result = await gautiJarPapildomusDuomenis(
            "110004884",
            { dokumentaiLimit: 7 },
            db as any,
        );

        const [sql, params] = db.query.mock.calls[0];
        expect(result).toBe(expected);
        expect(sql).toContain('"rcJar"."zymuTipai"');
        expect(sql).toContain('"rcJar"."jangisBusenos"');
        expect(sql).toContain('"rcJar"."dokumentuPotipiai"');
        expect(params).toEqual(["110004884", 7]);
    });

    it("neribotą dokumentų rodymą paverčia saugiu SQL limitu", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [{}] }) };
        await gautiJarPapildomusDuomenis("110004884", { dokumentaiLimit: null }, db as any);
        expect(db.query.mock.calls[0][1]).toEqual(["110004884", 1_000_000]);
    });
});

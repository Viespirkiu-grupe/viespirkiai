import { describe, expect, it, vi } from "vitest";
import { UPSERT_SQL } from "../modules/sutartys/upsertVpmSutartis.js";
import { main, parseArgs } from "../modules/sutartys/perskaiciuotiSkirtumus.js";

describe("pakeitimų skirtumų santrauka", () => {
    it("įrašo skirtumus tame pačiame CTE, kur dar matomi abu dokumentai", () => {
        expect(UPSERT_SQL).toContain(
            '"unikalusId", sutartis, "sutartisHash", "pakeitimoData", "skirtumai"',
        );
        expect(UPSERT_SQL).toMatch(
            /"vpmSutartys"\."diffJsonb"\(old\.doc, i\.doc\)/,
        );
    });

    it("parses rebuild options", () => {
        expect(parseArgs(["--visus", "-q"]))
            .toEqual({ visus: true, quiet: true, help: false });
        expect(parseArgs([]))
            .toEqual({ visus: false, quiet: false, help: false });
        expect(() => parseArgs(["--kazkas"])).toThrow(/Nežinomas/);
    });

    it("perduoda --visus DB funkcijai ir praneša apie likusius tuščius", async () => {
        const query = vi.fn()
            .mockResolvedValueOnce({ rows: [{ kiek: "7" }] })
            .mockResolvedValueOnce({ rows: [{ tusti: 0, tustiSuSutartimi: 0 }] });

        await main(["--visus", "--quiet"], { query } as never);

        expect(query.mock.calls[0][0]).toContain('"perskaiciuotiSkirtumus"($1)');
        expect(query.mock.calls[0][1]).toEqual([true]);
        expect(process.exitCode).not.toBe(1);
    });
});

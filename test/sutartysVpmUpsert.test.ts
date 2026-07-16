import { describe, expect, it, vi } from "vitest";
import {
    UPSERT_SQL,
    upsertVpmSutartis,
} from "../modules/sutartys/upsertVpmSutartis.js";

describe("VPM sutartis upsert", () => {
    it("writes only on hash change, archives only an old changed version, and always tracks now", async () => {
        const query = vi.fn().mockResolvedValue({
            rows: [{ existed: true, written: true, archived: true, tracked: true }],
        });
        const prepared = {
            json: '{"unikalusId":1}',
            md5: "c4ca4238a0b923820dcc509a6f75849b",
        };

        await expect(upsertVpmSutartis(prepared, { query })).resolves.toEqual({
            existed: true,
            written: true,
            archived: true,
            tracked: true,
        });
        expect(query).toHaveBeenCalledWith(
            UPSERT_SQL,
            [prepared.json, prepared.md5],
        );
        expect(UPSERT_SQL).toContain(
            'WHERE "vpmSutartys".hash IS DISTINCT FROM EXCLUDED.hash',
        );
        expect(UPSERT_SQL).toMatch(
            /JOIN old_document old ON old\.hash IS DISTINCT FROM i\.hash/,
        );
        expect(UPSERT_SQL).toMatch(/matyta = now\(\),\s+atnaujinta = now\(\)/);
        expect(UPSERT_SQL).toContain("FROM main_upsert changed");
    });
});

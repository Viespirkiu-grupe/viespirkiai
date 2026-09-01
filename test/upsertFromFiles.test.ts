import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn(),
    },
}));

import { postgres } from "../postgres/postgres.js";
import { fetchFailaiByIds } from "../modules/documents/upsertFromFiles.js";

describe("fetchFailaiByIds", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("casts a numeric cvpIs source ID without evaluating invalid source IDs", async () => {
        vi.mocked(postgres.query).mockResolvedValue({ rows: [] } as never);

        await fetchFailaiByIds([123]);

        const [sql, params] = vi.mocked(postgres.query).mock.calls[0];
        expect(sql).toContain("FROM public.files f");
        // Šaltinio ID jau išskaidytas stulpeliuose — split_part nebereikia,
        // bet skaitinis castas vis tiek turi būti apsaugotas regexp'u.
        expect(sql).toContain('vp."pirkimoId" = CASE');
        expect(sql).toContain(`f."sourceId0" ~ '^[0-9]+$'`);
        expect(sql).toContain(`THEN f."sourceId0"::integer`);
        expect(sql).not.toContain("split_part");
        expect(sql).not.toContain("public.failai");
        expect(params).toEqual([[123]]);
    });
});

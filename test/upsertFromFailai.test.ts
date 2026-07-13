import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn(),
    },
}));

import { postgres } from "../postgres/postgres.js";
import { fetchFailaiByIds } from "../modules/dokumentai/upsertFromFailai.js";

describe("fetchFailaiByIds", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("compares the numeric pirkimoId with a cast source ID", async () => {
        vi.mocked(postgres.query).mockResolvedValue({ rows: [] } as never);

        await fetchFailaiByIds([123]);

        const [sql, params] = vi.mocked(postgres.query).mock.calls[0];
        expect(sql).toContain(
            'vp."pirkimoId" = split_part(f."saltinioId", \'/\', 1)::integer',
        );
        expect(sql).not.toContain('f."metaduomenysHash"');
        expect(sql).not.toContain('f."tekstasHash"');
        expect(params).toEqual([[123]]);
    });
});

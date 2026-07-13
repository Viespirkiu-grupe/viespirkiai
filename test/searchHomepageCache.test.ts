import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlPromiseCache } from "../utils/ttlPromiseCache.js";

const pgQuery = vi.fn();

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: pgQuery,
        connect: vi.fn(),
    },
}));

vi.mock("../quickwit/quickwit.js", () => ({
    search: vi.fn(),
    searchAll: vi.fn(),
    countDocs: vi.fn(),
    getDeadRatio: vi.fn(),
}));

describe("unfiltered homepage search cache", () => {
    beforeEach(() => {
        pgQuery.mockReset();
        pgQuery.mockResolvedValue({ rows: [] });
    });

    it("reloads cached data after five seconds", async () => {
        const now = vi.spyOn(Date, "now");
        const load = vi.fn().mockResolvedValue("data");
        const cached = createTtlPromiseCache(5_000);

        try {
            now.mockReturnValue(1_000);
            await cached("homepage", load);
            now.mockReturnValue(5_999);
            await cached("homepage", load);
            now.mockReturnValue(6_001);
            await cached("homepage", load);
        } finally {
            now.mockRestore();
        }

        expect(load).toHaveBeenCalledTimes(2);
    });

    it("caches the first page of sutartys for five seconds", async () => {
        const { searchSutartys } = await import(
            "../modules/sutartys/searchSutartys.js"
        );
        const options = { limit: 50, page: 1, engine: "postgres" } as const;

        await Promise.all([
            searchSutartys({}, options),
            searchSutartys({}, options),
        ]);
        await searchSutartys({}, options);

        expect(pgQuery).toHaveBeenCalledTimes(1);
    });

    it("does not cache filtered sutartys searches", async () => {
        const { searchSutartys } = await import(
            "../modules/sutartys/searchSutartys.js"
        );
        const options = { limit: 50, page: 1, engine: "postgres" } as const;

        await searchSutartys({ search: "energija" }, options);
        await searchSutartys({ search: "energija" }, options);

        expect(pgQuery).toHaveBeenCalledTimes(2);
    });

    it("keeps differently sorted unfiltered searches in separate entries", async () => {
        const { searchSutartys } = await import(
            "../modules/sutartys/searchSutartys.js"
        );
        const options = { limit: 49, page: 1, engine: "postgres" } as const;

        await searchSutartys({}, options);
        await searchSutartys({ sort: "verte", sortDir: "asc" }, options);

        expect(pgQuery).toHaveBeenCalledTimes(2);
    });

    it("caches the first page of viesiejiPirkimai for five seconds", async () => {
        const { searchViesiejiPirkimai } = await import(
            "../modules/viesiejiPirkimai/searchViesiejiPirkimai.js"
        );
        const options = { limit: 50, page: 1, engine: "postgres" } as const;

        await Promise.all([
            searchViesiejiPirkimai({}, options),
            searchViesiejiPirkimai({}, options),
        ]);
        await searchViesiejiPirkimai({}, options);

        expect(pgQuery).toHaveBeenCalledTimes(1);
    });

    it("does not cache filtered viesiejiPirkimai searches", async () => {
        const { searchViesiejiPirkimai } = await import(
            "../modules/viesiejiPirkimai/searchViesiejiPirkimai.js"
        );
        const options = { limit: 50, page: 1, engine: "postgres" } as const;

        await searchViesiejiPirkimai({ search: "energija" }, options);
        await searchViesiejiPirkimai({ search: "energija" }, options);

        expect(pgQuery).toHaveBeenCalledTimes(2);
    });
});

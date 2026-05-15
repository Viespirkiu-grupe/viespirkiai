import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/mcp/analyst/pool.js", () => ({
    analystPool: {
        connect: vi.fn(),
    },
}));

vi.mock("../../modules/mcp/mcpLogger.js", () => ({
    logToolCall: vi.fn(),
}));

// columnFixer calls postgres to load table column names; return empty in unit tests
// so the map only contains view columns (sufficient for these tests).
vi.mock("../../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
    },
}));

import { analystPool } from "../../modules/mcp/analyst/pool.js";
import config from "../../utils/config.js";
import { handler } from "../../modules/mcp/tools/executeQuery.js";

const VALID_QUERY = "SELECT id FROM sutartys LIMIT 1";
const VALID_PURPOSE = "unit test";

function makeClient(rows: object[] = []) {
    return {
        query: vi.fn().mockResolvedValue({ rows }),
        release: vi.fn(),
    };
}

describe("executeQuery handler — statement_timeout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("sets statement_timeout using numeric mcpQueryTimeout", async () => {
        const client = makeClient();
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        const timeoutCall = client.query.mock.calls.find((args) =>
            String(args[0]).startsWith("SET LOCAL statement_timeout"),
        );
        expect(timeoutCall).toBeDefined();
        const expected = `SET LOCAL statement_timeout = '${Number(config.mcpQueryTimeout)}s'`;
        expect(timeoutCall![0]).toBe(expected);
    });

    it("timeout value is a finite number (not NaN or Infinity)", async () => {
        const timeout = Number(config.mcpQueryTimeout);
        expect(Number.isFinite(timeout)).toBe(true);
    });
});

describe("executeQuery handler — column-not-found hint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("appends get_schema HINT when DB returns undefined_column error (code 42703)", async () => {
        const err = Object.assign(new Error(`column "neegzistuojantisStulpelis" does not exist`), { code: "42703" });
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
                .mockRejectedValueOnce(err),
            release: vi.fn(),
        };
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("HINT");
        expect(result.content[0].text).toContain("get_schema");
    });

    it("appends get_schema HINT when error message contains 'does not exist' but no code", async () => {
        const err = new Error(`column "foo" does not exist`);
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(err),
            release: vi.fn(),
        };
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("HINT");
        expect(result.content[0].text).toContain("get_schema");
    });

    it("does not append HINT for unrelated DB errors", async () => {
        const err = Object.assign(new Error("permission denied for table sutartys"), { code: "42501" });
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(err),
            release: vi.fn(),
        };
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).not.toContain("HINT");
    });
});

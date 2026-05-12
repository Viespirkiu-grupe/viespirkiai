import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/mcp/analyst/pool.js", () => ({
    analystPool: {
        connect: vi.fn(),
    },
}));

vi.mock("../../modules/mcp/mcpLogger.js", () => ({
    logToolCall: vi.fn(),
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

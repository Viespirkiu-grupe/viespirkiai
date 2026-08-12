import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/mcp/analyst/pool.js", () => ({
    analystPool: {
        connect: vi.fn(),
    },
}));

vi.mock("../../modules/mcp/mcpLogger.js", () => ({
    logToolCall: vi.fn(),
}));

// ensureAnalystViews eina per postgres.connect() (žemiau mock'inamas tik .query),
// o be jo handler'is nutrūktų dar nepasiekęs _runQuery.
vi.mock("../../modules/mcp/analyst/ensureViews.js", () => ({
    ensureAnalystViews: vi.fn().mockResolvedValue(undefined),
}));

// columnFixer calls postgres to load table column names; return empty in unit tests
// so the map only contains view columns (sufficient for these tests).
vi.mock("../../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
    },
}));

// Mock only validateSql; spread all other exports (TABLE_WHITELIST etc.) from the real module.
vi.mock(import("../../modules/mcp/analyst/validateSql.js"), async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, validateSql: vi.fn().mockReturnValue(null) };
});

import { analystPool } from "../../modules/mcp/analyst/pool.js";
import { validateSql } from "../../modules/mcp/analyst/validateSql.js";
import { handler, QUERY_TIMEOUT_SECONDS } from "../../modules/mcp/tools/executeQuery.js";

const VALID_QUERY = "SELECT id FROM vpmSutartys LIMIT 1";
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
        vi.mocked(validateSql).mockReturnValue(null);
    });

    it("sets statement_timeout using numeric mcpQueryTimeout", async () => {
        const client = makeClient();
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        const timeoutCall = client.query.mock.calls.find((args) =>
            String(args[0]).startsWith("SET LOCAL statement_timeout"),
        );
        expect(timeoutCall).toBeDefined();
        const expected = `SET LOCAL statement_timeout = '${QUERY_TIMEOUT_SECONDS}s'`;
        expect(timeoutCall![0]).toBe(expected);
    });

    it("timeout value is a finite number (not NaN or Infinity)", async () => {
        expect(Number.isFinite(QUERY_TIMEOUT_SECONDS)).toBe(true);
    });
});

describe("executeQuery handler — column-not-found hint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(validateSql).mockReturnValue(null);
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
        const err = Object.assign(new Error("permission denied for table vpmSutartys"), { code: "42501" });
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

describe("executeQuery handler — SQL normalization (whitespace + IS DISTINCT FROM)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(validateSql).mockReturnValue(null);
    });

    it("normalises a multi-line query and passes the single-line form to the pool", async () => {
        const client = makeClient([{ id: 1 }]);
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const multiLineQuery = `SELECT id
FROM vpmSutartys
LIMIT 1`;
        const result = await handler({ query: multiLineQuery, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBeUndefined();
        // The pool should receive the collapsed single-line SQL (wrapped in pagination subquery)
        const executedSql: string = client.query.mock.calls
            .map((args) => String(args[0]))
            .find((s) => s.includes("SELECT id FROM vpmSutartys")) ?? "";
        expect(executedSql).toContain("SELECT id FROM vpmSutartys LIMIT 1");
    });

    it("rewrites IS DISTINCT FROM true → IS NOT TRUE before executing", async () => {
        const client = makeClient([{ id: 1 }]);
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const result = await handler({
            query: "SELECT id FROM vpmSutartys WHERE istrinta IS DISTINCT FROM true LIMIT 1",
            purpose: VALID_PURPOSE,
            page: 1,
        });

        expect(result.isError).toBeUndefined();
        const executedSql: string = client.query.mock.calls
            .map((args) => String(args[0]))
            .find((s) => s.includes("IS NOT TRUE")) ?? "";
        expect(executedSql).toContain("IS NOT TRUE");
    });

    it("rewrites IS DISTINCT FROM false → IS NOT FALSE before executing", async () => {
        const client = makeClient([]);
        vi.mocked(analystPool.connect).mockResolvedValue(client as never);

        const result = await handler({
            query: "SELECT id FROM vpmSutartys WHERE istrinta IS DISTINCT FROM false LIMIT 1",
            purpose: VALID_PURPOSE,
            page: 1,
        });

        expect(result.isError).toBeUndefined();
        const executedSql: string = client.query.mock.calls
            .map((args) => String(args[0]))
            .find((s) => s.includes("IS NOT FALSE")) ?? "";
        expect(executedSql).toContain("IS NOT FALSE");
    });
});

describe("executeQuery handler — SQL parse error hint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(validateSql).mockReturnValue(null);
    });

    it("appends HINT when validation returns a SQL parse error", async () => {
        vi.mocked(validateSql).mockReturnValueOnce("SQL parse error: Expected [A-Za-z0-9] but '::' found.");

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/SQL parse error/);
        expect(result.content[0].text).toContain("HINT");
        expect(result.content[0].text).toContain("CAST");
    });

    it("does not append HINT for non-parse validation errors (table not whitelisted)", async () => {
        vi.mocked(validateSql).mockReturnValueOnce("Table 'pg_class' is not in the allowed table list");

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).not.toContain("HINT:");
    });

    it("does not append HINT for function not on allow list errors", async () => {
        vi.mocked(validateSql).mockReturnValueOnce("Function 'pg_sleep' is not on the allow list.");

        const result = await handler({ query: VALID_QUERY, purpose: VALID_PURPOSE, page: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).not.toContain("HINT:");
    });
});

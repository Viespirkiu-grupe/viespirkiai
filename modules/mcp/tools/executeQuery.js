import {z} from "zod";
import {analystPool} from "../analyst/pool.js";
import {MAX_QUERY_LENGTH, validateSql} from "../analyst/validateSql.js";
import config from "../../../utils/config.js";

const PAGE_SIZE = 50;

export const name = "execute_query";
export const description =
    "Executes a read-only SQL SELECT against the procurement database. " +
    "The query is validated through a multi-layer guardrail stack (AST parse, table whitelist, " +
    "function whitelist, complexity limits) before execution. " +
    "Results are paginated — " + PAGE_SIZE + " rows per page. Include a 'purpose' describing your investigation hypothesis. " +
    "Primary views that you should consider using first: v_company, v_sutartys, v_pirkimas, v_person_links, v_dalyviai, v_bylos. " +
    "Call get_schema first to understand the available views and additional tables, and their columns.";

export const schema = {
    query: z
        .string()
        .min(10)
        .max(MAX_QUERY_LENGTH)
        .describe("SQL SELECT statement to execute"),
    purpose: z
        .string()
        .min(5)
        .max(500)
        .describe("Human-readable description of what this query is testing — written to the audit log"),
    page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Page number (1-based). Page size is fixed at 50 rows."),
};

export async function handler({query, purpose, page}) {
    const error = validateSql(query);
    if (error) {
        return {
            content: [{type: "text", text: error}],
            isError: true,
        };
    }

    const offset = (page - 1) * PAGE_SIZE;
    // Fetch one extra row to detect whether more pages exist — avoids a full-scan COUNT(*) OVER ()
    const wrappedSql = `SELECT q.*
                        FROM (${query}) AS q
                        LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;

    const start = Date.now();
    const client = await analystPool.connect();

    try {
        await client.query(`SET LOCAL statement_timeout = '${config.mcpQueryTimeout}s'`);
        const result = await client.query(wrappedSql);

        const durationMs = Date.now() - start;
        const hasMore = result.rows.length > PAGE_SIZE;
        const rows = hasMore ? result.rows.slice(0, PAGE_SIZE) : result.rows;

        const payload = {
            rows,
            page,
            pageSize: PAGE_SIZE,
            rowCount: rows.length,
            hasMore,
            durationMs,
        };

        return {
            content: [{type: "text", text: JSON.stringify(payload)}],
        };
    } catch (err) {
        return {
            content: [{type: "text", text: err.message}],
            isError: true,
        };
    } finally {
        client.release();
    }
}

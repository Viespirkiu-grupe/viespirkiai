import { z } from "zod";
import { analystPool } from "../analyst/pool.js";
import { validateSql } from "../analyst/validateSql.js";

const PAGE_SIZE = 50;

export const name = "execute_investigation_query";
export const description =
    "Executes a read-only SQL SELECT against the procurement database. " +
    "The query is validated through a multi-layer guardrail stack (AST parse, table whitelist, " +
    "function whitelist, complexity limits) before execution. " +
    "Results are paginated — 50 rows per page. Include a 'purpose' describing your investigation hypothesis. " +
    "Session-scoped views v_company, v_sutartys, v_pirkimas, v_person_links, v_dalyviai, v_bylos are available. " +
    "Call get_schema first to understand the available tables and their columns.";

export const schema = {
    query: z
        .string()
        .min(10)
        .max(8000)
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

export async function handler({ query, purpose, page }) {
    // Layer 1–4 validation
    const validation = validateSql(query);
    if (!validation.ok) {
        return {
            content: [
                {
                    type: "text",
                    text: `Layer ${validation.layer}: ${validation.message}`,
                },
            ],
            isError: true,
        };
    }

    const offset = (page - 1) * PAGE_SIZE;
    const wrappedSql = `SELECT q.*, COUNT(*) OVER () AS __total__\nFROM (\n${query}\n) AS q\nLIMIT ${PAGE_SIZE} OFFSET ${offset}`;

    const start = Date.now();
    const client = await analystPool.connect();

    try {
        await client.query("SET LOCAL statement_timeout = '20s'");
        const result = await client.query(wrappedSql);

        const durationMs = Date.now() - start;
        let totalRows;

        if (result.rows.length > 0) {
            totalRows = Number(result.rows[0].__total__);
        } else {
            // Empty result — run a separate COUNT to report totalRows correctly
            const countResult = await client.query(
                `SELECT COUNT(*) AS n FROM (\n${query}\n) AS q`
            );
            totalRows = Number(countResult.rows[0].n);
        }

        // Strip __total__ from every row
        const rows = result.rows.map(({ __total__, ...rest }) => rest);

        const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / PAGE_SIZE);

        const payload = {
            rows,
            page,
            pageSize: PAGE_SIZE,
            rowCount: rows.length,
            totalRows,
            totalPages,
            hasMore: page < totalPages,
            durationMs,
        };

        return {
            content: [{ type: "text", text: JSON.stringify(payload) }],
        };
    } catch (err) {
        return {
            content: [{ type: "text", text: err.message }],
            isError: true,
        };
    } finally {
        client.release();
    }
}

import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { TABLE_WHITELIST, VIEW_NAMES } from "../analyst/validateSql.js";
import { VIEW_DEFINITIONS } from "../analyst/tempViews.js";

const TABLE_LIST = [...TABLE_WHITELIST];
const VIEW_LIST = [...VIEW_NAMES];

export const name = "get_schema";
export const description =
    "Returns schema information for the procurement database. " +
    "Without arguments: lists all available tables and views with row counts. " +
    "With a table name: returns columns, data types, and 3 sample rows. " +
    "With a view name: returns columns and the view SQL. " +
    "Call this at the start of an investigation to understand what data is available.";

export const schema = {
    table: z
        .enum([...TABLE_LIST, ...VIEW_LIST])
        .optional()
        .describe(
            "Table or view name. Omit to list all available tables and views with row counts."
        ),
};

export async function handler({ table } = {}) {
    if (!table) {
        return listAll();
    }
    if (VIEW_NAMES.has(table)) {
        return describeView(table);
    }
    return describeTable(table);
}

async function listAll() {
    const { rows } = await postgres.query(`
        SELECT tablename, n_live_tup AS row_count_estimate
        FROM pg_stat_user_tables
        WHERE tablename = ANY($1::text[])
        ORDER BY tablename
    `, [TABLE_LIST]);

    const rowCountMap = Object.fromEntries(rows.map((r) => [r.tablename, r.row_count_estimate]));

    const tables = TABLE_LIST.map((t) => ({
        name: t,
        type: "table",
        rowCountEstimate: rowCountMap[t] ?? null,
    }));

    const views = VIEW_LIST.map((v) => ({ name: v, type: "view" }));

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ tables, views }, null, 2),
            },
        ],
    };
}

async function describeTable(tableName) {
    const [colResult, sampleResult] = await Promise.all([
        postgres.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
            ORDER BY ordinal_position
        `, [tableName]),
        postgres.query(`SELECT * FROM "${tableName}" LIMIT 3`),
    ]);

    if (colResult.rows.length === 0) {
        return {
            content: [{ type: "text", text: `Table '${tableName}' not found. Call get_schema without arguments to see the full table list.` }],
            isError: true,
        };
    }

    const result = {
        name: tableName,
        type: "table",
        columns: colResult.rows.map((r) => ({
            name: r.column_name,
            dataType: r.data_type,
            nullable: r.is_nullable === "YES",
        })),
        sampleRows: sampleResult.rows,
    };

    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
}

async function describeView(viewName) {
    const sql = VIEW_DEFINITIONS[viewName];
    // Extract column list from the view SQL by parsing the SELECT clause.
    // Since these are our own hardcoded views, we return the source SQL directly.
    const result = {
        name: viewName,
        type: "view",
        note: "This is a session-scoped TEMP view available in execute_investigation_query.",
        sourceSQL: sql,
    };

    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
}

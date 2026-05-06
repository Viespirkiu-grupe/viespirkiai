import pkg from "node-sql-parser";
const { Parser } = pkg;

const parser = new Parser();

export const TABLE_WHITELIST = new Set([
    "sutartys", "sutartysAtviriDuomenys", "sutartysAtviriDuomenysImp",
    "jarCsv", "jar",
    "viesiejiPirkimai", "viesiejiPirkimaiVykdytojai",
    "pinregJuridiniaiRysiai", "pinreg",
    "failai",
    "sabisSutartys", "sabisSutarciuSalys", "sabisSaskaitos", "sabisSaskaituSalys",
    "cpvaProjektuSutartys", "cpvaProjektuSarasas",
    "cvppViesiejiPirkimai",
    "eiluciuSkaiciai", "bvpzKodai",
    "sodra", "regitra",
    "nepatikimiTiekejai", "melagingiTiekejai",
    "jadis", "rcInformaciniaiLeidiniaiPranesimai",
    "domenai", "kotis",
    "balansoAtaskaitos", "pelnoNuostoliuAtaskaitos",
    "darboVieta", "istatinisKapitalas",
    "atn1ataskaitos", "atn1dalyviai", "atn1pasiulymuEile", "atn1atmestiPasiulymai",
    "neskelbiamosDerybos",
    "vdiPazeidimai",
    "bylos", "bylosDalyviai",
    "mokesciai",
]);

export const VIEW_NAMES = new Set([
    "v_company", "v_sutartys", "v_pirkimas", "v_person_links", "v_dalyviai", "v_bylos",
]);

export const FUNCTION_WHITELIST = new Set([
    // Aggregates
    "count", "sum", "avg", "min", "max", "stddev", "stddev_pop", "stddev_samp",
    "variance", "var_pop", "var_samp", "bool_and", "bool_or", "every",
    "string_agg", "array_agg", "jsonb_agg", "json_agg",
    "percentile_cont", "percentile_disc", "mode",
    // Window
    "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile",
    "lag", "lead", "first_value", "last_value", "nth_value",
    // Conditional
    "coalesce", "nullif", "greatest", "least",
    // Math
    "round", "abs", "ceil", "ceiling", "floor", "trunc", "sign", "mod", "power",
    "sqrt", "exp", "ln", "log", "div",
    // Date/time
    "now", "current_date", "current_timestamp", "date_trunc", "date_part", "extract",
    "age", "to_char", "to_date", "to_timestamp", "make_date", "make_interval",
    "justify_interval",
    // String
    "upper", "lower", "length", "char_length", "trim", "ltrim", "rtrim", "btrim",
    "substring", "substr", "left", "right", "concat", "concat_ws", "replace",
    "split_part", "position", "strpos", "lpad", "rpad",
    "regexp_match", "regexp_matches", "regexp_replace", "regexp_split_to_array",
    "regexp_split_to_table", "format", "md5",
    // Array
    "unnest", "array_length", "array_position", "array_remove", "array_replace",
    "cardinality", "string_to_array", "array_to_string",
    // JSON
    "jsonb_build_object", "json_build_object", "jsonb_build_array", "jsonb_object_keys",
    "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_extract_path",
    "jsonb_extract_path_text",
    // Set returning
    "generate_series",
]);

const MAX_JOINS = 6;
const MAX_SUBQUERY_DEPTH = 3;
const MAX_CTES = 8;

/**
 * Validates a SQL string through 4 layers of guardrails.
 * Returns { ok: true, hasRecursive?: boolean } or { ok: false, layer: number, message: string }.
 */
export function validateSql(sql) {
    // Layer 1: Parse and assert single SELECT
    let ast;
    try {
        ast = parser.astify(sql, { database: "PostgreSQL" });
    } catch (err) {
        return { ok: false, layer: 1, message: `SQL parse error: ${err.message}` };
    }

    if (Array.isArray(ast)) {
        return { ok: false, layer: 1, message: "Only a single SELECT statement is allowed" };
    }

    if (ast.type !== "select") {
        return {
            ok: false, layer: 1,
            message: `Only SELECT statements are allowed (got ${ast.type?.toUpperCase() ?? "unknown"})`,
        };
    }

    // Collect all relevant information from the AST in one traversal
    const analysis = {
        tables: [],       // { db, table }[]
        functions: [],    // string[]
        joinCount: 0,
        cteNames: new Set(),
        maxSubqueryDepth: 0,
        cteCount: ast.with?.length ?? 0,
        hasRecursive: false,
    };

    walkSelect(ast, analysis, 0);

    // Layer 2: Table whitelist
    const allowedTables = new Set([...TABLE_WHITELIST, ...VIEW_NAMES, ...analysis.cteNames]);
    for (const { db, table } of analysis.tables) {
        if (db != null) {
            return {
                ok: false, layer: 2,
                message: `Table '${db}.${table}' is not in the allowed table list — schema-qualified references are not permitted. Call get_schema to see available tables.`,
            };
        }
        if (!allowedTables.has(table)) {
            return {
                ok: false, layer: 2,
                message: `Table '${table}' is not in the allowed table list — call get_schema to see available tables.`,
            };
        }
    }

    // Layer 3: Function whitelist (strict — reject anything not on the list)
    for (const fn of analysis.functions) {
        if (!FUNCTION_WHITELIST.has(fn)) {
            return {
                ok: false, layer: 3,
                message: `Function '${fn}' is not on the allow list.`,
            };
        }
    }

    // Layer 4: Complexity limits
    if (analysis.joinCount > MAX_JOINS) {
        return {
            ok: false, layer: 4,
            message: `Too many JOINs (${analysis.joinCount} — max ${MAX_JOINS})`,
        };
    }
    if (analysis.maxSubqueryDepth > MAX_SUBQUERY_DEPTH) {
        return {
            ok: false, layer: 4,
            message: `Subquery nesting too deep (depth ${analysis.maxSubqueryDepth} — max ${MAX_SUBQUERY_DEPTH})`,
        };
    }
    if (analysis.cteCount > MAX_CTES) {
        return {
            ok: false, layer: 4,
            message: `Too many CTEs (${analysis.cteCount} — max ${MAX_CTES})`,
        };
    }

    return { ok: true, hasRecursive: analysis.hasRecursive };
}

function walkSelect(selectNode, result, depth) {
    if (selectNode.with) {
        for (const cte of selectNode.with) {
            if (cte.name?.value) result.cteNames.add(cte.name.value);
            if (cte.recursive) result.hasRecursive = true;
            if (cte.stmt) walkSelect(cte.stmt, result, depth + 1);
        }
    }

    if (selectNode.from) {
        for (const f of selectNode.from) {
            if (f.join) result.joinCount++;
            if (f.table && !f.expr) {
                result.tables.push({ db: f.db ?? null, table: f.table });
            } else if (f.expr?.ast) {
                const d = depth + 1;
                if (d > result.maxSubqueryDepth) result.maxSubqueryDepth = d;
                walkSelect(f.expr.ast, result, d);
            }
        }
    }

    walkExpr(selectNode.columns, result, depth);
    walkExpr(selectNode.where, result, depth);
    walkExpr(selectNode.having, result, depth);
    walkExpr(selectNode.orderby, result, depth);
    walkExpr(selectNode.groupby, result, depth);
    walkExpr(selectNode.window, result, depth);
}

function walkExpr(node, result, depth) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
        for (const item of node) walkExpr(item, result, depth);
        return;
    }

    if (node.type === "function") {
        const name = node.name?.name?.[0]?.value;
        if (name) result.functions.push(name.toLowerCase());
        walkExpr(node.args, result, depth);
        return;
    }

    if (node.type === "aggr_func" || node.type === "window_func") {
        if (node.name) result.functions.push(node.name.toLowerCase());
        walkExpr(node.args, result, depth);
        walkExpr(node.over, result, depth);
        return;
    }

    // Subquery embedded in an expression (IN, EXISTS, scalar subquery)
    if (node.ast && node.ast.type === "select") {
        const d = depth + 1;
        if (d > result.maxSubqueryDepth) result.maxSubqueryDepth = d;
        walkSelect(node.ast, result, d);
        return;
    }

    // Recurse into all child properties for other node types
    for (const val of Object.values(node)) {
        if (val && typeof val === "object") walkExpr(val, result, depth);
    }
}

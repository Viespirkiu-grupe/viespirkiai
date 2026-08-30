import pkg from "node-sql-parser";
import { VIEW_NAMES } from "./tempViews.js";

const { Parser } = pkg;

const parser = new Parser();

export const TABLE_WHITELIST: Set<string> = new Set([
    "vpmSutartys", "sutartysAtviriDuomenys", "sutartysAtviriDuomenysImp",
    "jarAsmenys", "jar",
    "viesiejiPirkimai", "viesiejiPirkimaiVykdytojai",
    "pinregJuridiniaiRysiai", "pinreg",
    "sabisSutartys", "sabisSutarciuSalys", "sabisSaskaitos", "sabisSaskaituSalys",
    "sabisSaskaituSalysTipai", "sabisSaskaituSalysVeiklosVieta",
    "cpvaProjektuSutartys", "cpvaProjektuSarasas",
    // CVPP archyvo skelbimai (buvęs public."cvppViesiejiPirkimai") — `cvpp`
    // schemoje; nukirptas vardas `viesiejiPirkimai` būtų sutapęs su public
    // lentele, tad lentelė pervadinta į `archyvoSkelbimai`.
    "archyvoSkelbimai",
    "eiluciuSkaiciai", "bvpzKodai",
    // SODRA lentelės iškeltos į `sodra` schemą; analyst search_path jas mato
    // nekvalifikuotai (menesiniai = buvęs sodraMonthly).
    "menesiniai", "evrk", "importai", "pavadinimai", "savivaldybes",
    "regitra", "regitraMatymai", "regitraAtnaujinimai",
    "nepatikimiTiekejai", "melagingiTiekejai",
    "jadisDalyviuSkaiciai", "jadisDalyviuSarasai", "jadisValstybesDalyviai",
    "rcInformaciniaiLeidiniaiPranesimai",
    // `domenai` dabar yra normalizuota lentelė be savininko laukų;
    // `domenaiPilni` yra suderinamumo view su senąja forma. Abu
    // pasiekiami nekvalifikuotai per analyst rolės search_path.
    "domenai", "domenaiPilni", "kotis",
    "balansoAtaskaitos", "pelnoNuostoliuAtaskaitos",
    "darboVieta", "istatinisKapitalas",

    "neskelbiamosDerybos",
    // `vdi` schema; `pazeidimaiPilni` yra suderinamumo view su senąja forma.
    // Abu pasiekiami nekvalifikuotai per analyst search_path.
    "pazeidimai", "pazeidimaiPilni", "subjektai",
    // LITEKO lentelės iškeltos į `liteko` schemą; senąją stulpelių formą
    // atkuria view'ai, pasiekiami nekvalifikuotai per analyst search_path.
    "nuosprendziaiPilni", "dalyviaiPilni",
    "mokesciai",

    // PPA (ATN-1) XLSX ataskaitos iškeltos į `ppa` schemą. `dalyviai` yra ir
    // `liteko` schemoje, todėl analyst search_path'e `ppa` eina pirmiau —
    // nekvalifikuotas `dalyviai` čia reiškia PPA dalyvius.
    "ataskaitos", "dalyviai", "sutartys",
    "pasiulymuEile", "atmestiPasiulymai",
    "teisiniaiPagrindai", "ataskaitosTipai",
    "pirkimoVertes", "perkanciosiosOrganizacijosTipai",
    "igaliotosiosTipai", "pirkimoBudai",
    "atmestuPasiulymuStatusai", "atmetimoTeisiniaiPagrindai",
    "atmetimoPriezastys", "kainosIsraiskos",
    "salys", "centralizacijosTipai", "pirkimoObjektoRusys",
]);

export const FUNCTION_WHITELIST: Set<string> = new Set([
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
export const MAX_QUERY_LENGTH = 3072;

interface SqlAnalysis {
    tables: Array<{ db: string | null; table: string }>;
    functions: string[];
    joinCount: number;
    cteNames: Set<string>;
    maxSubqueryDepth: number;
    cteCount: number;
    hasRecursive: boolean;
}

// Returns null if valid, or an error message string if invalid.
export function validateSql(sql: string): string | null {
    if (sql.length > MAX_QUERY_LENGTH) {
        return `Query exceeds the ${MAX_QUERY_LENGTH}-character limit.`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ast: any;
    try {
        ast = parser.astify(sql, { database: "PostgreSQL" });
    } catch (err: unknown) {
        return `SQL parse error: ${(err as Error).message}`;
    }

    if (Array.isArray(ast)) {
        if (ast.length !== 1) {
            return "Only a single SELECT statement is allowed";
        }
        ast = ast[0];
    }

    if (ast.type !== "select") {
        return `Only SELECT statements are allowed (got ${ast.type?.toUpperCase() ?? "unknown"})`;
    }

    const analysis: SqlAnalysis = {
        tables: [],
        functions: [],
        joinCount: 0,
        cteNames: new Set(),
        maxSubqueryDepth: 0,
        cteCount: ast.with?.length ?? 0,
        hasRecursive: false,
    };

    walkSelect(ast, analysis, 0);

    const allowedTables = new Set([...TABLE_WHITELIST, ...VIEW_NAMES, ...analysis.cteNames]);
    for (const { db, table } of analysis.tables) {
        if (db != null) {
            return `Table '${db}.${table}' is not in the allowed table list — schema-qualified references are not permitted. Call get_schema to see available tables.`;
        }
        if (!allowedTables.has(table)) {
            return `Table '${table}' is not in the allowed table list — call get_schema to see available tables.`;
        }
    }

    for (const fn of analysis.functions) {
        if (!FUNCTION_WHITELIST.has(fn)) {
            return `Function '${fn}' is not on the allow list.`;
        }
    }

    if (analysis.joinCount > MAX_JOINS) {
        return `Too many JOINs (${analysis.joinCount} — max ${MAX_JOINS})`;
    }
    if (analysis.maxSubqueryDepth > MAX_SUBQUERY_DEPTH) {
        return `Subquery nesting too deep (depth ${analysis.maxSubqueryDepth} — max ${MAX_SUBQUERY_DEPTH})`;
    }
    if (analysis.cteCount > MAX_CTES) {
        return `Too many CTEs (${analysis.cteCount} — max ${MAX_CTES})`;
    }

    if (analysis.hasRecursive) {
        return "Recursive CTEs (WITH RECURSIVE) are not allowed.";
    }

    return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkSelect(selectNode: any, result: SqlAnalysis, depth: number): void {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkExpr(node: any, result: SqlAnalysis, depth: number): void {
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

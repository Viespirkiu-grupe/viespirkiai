import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { TABLE_WHITELIST } from "../analyst/validateSql.js";
import { VIEW_NAMES, COVERED_TABLES_BY_VIEWS } from "../analyst/tempViews.js";

const COVERED_TABLES = new Set(Object.keys(COVERED_TABLES_BY_VIEWS));
const TABLE_LIST = [...TABLE_WHITELIST].filter((t) => !COVERED_TABLES.has(t));
const VIEW_LIST = [...VIEW_NAMES];
const IDENTIFIER_CANDIDATES = [
    "id",
    "sutartiesUnikalusId",
    "pirkimoId",
    "pirkimoNumeris",
    "jarKodas",
    "tiekejoKodas",
    "pirkejoKodas",
];

const VIEW_METADATA = {
    v_company: {
        tags: ["capacity", "blacklist", "labor", "domains", "court"],
        keys: ["jarKodas", "pavadinimas", "darbuotojai", "melagingisTiekejas", "bylosSkaicius"],
        joins: [
            ["jarKodas", "jarCsv.jarKodas", "strict"],
        ],
        columns: [
            "jarKodas: text",
            "pavadinimas: text",
            "adresas: text",
            "registravimoData: date",
            "formosPavadinimas: text",
            "statusoPavadinimas: text",
            "statusasNuo: date",
            "sodraData: date",
            "darbuotojai: integer",
            "vidutinisAtlyginimas: numeric",
            "imokuSuma: numeric",
            "melagingisTiekejas: boolean",
            "nepatikimasTiekejas: boolean",
            "vdiPazeidimuSkaicius: bigint",
            "bylosSkaicius: bigint",
            "domenaiSkaicius: bigint",
            "neskelbiamosDerybosSkaicius: bigint",
        ],
        primaryKeys: ["jarKodas"],
        example:
            'SELECT "jarKodas", pavadinimas, "formosPavadinimas", darbuotojai, "vidutinisAtlyginimas" FROM v_company WHERE "jarKodas" = \'302556251\'',
    },
    v_sutartys: {
        tags: ["contracts", "buyer-supplier", "cpv", "value", "timing", "frameworks"],
        keys: ["sutartiesUnikalusId", "pirkejoKodas", "tiekejoKodas", "verte", "sudarymoData"],
        joins: [
            ["pirkejoKodas", "v_company.jarKodas", "strict"],
            ["tiekejoKodas", "v_company.jarKodas", "strict"],
            ["pirkimoNumeris", "v_pirkimas.pirkimoId", "semantic"],
        ],
        columns: [
            "sutartiesUnikalusId: bigint",
            "sutartiesNumeris: text",
            "pirkimoNumeris: text",
            "sudarymoData: timestamp without time zone",
            "paskelbimoData: timestamp without time zone",
            "galiojimoData: timestamp without time zone",
            "faktineIvykdimoData: timestamp without time zone",
            "verte: numeric",
            "suma: numeric",
            "faktineIvykdimoVerte: numeric",
            "pavadinimas: text",
            "bvpzKodas: text",
            "bvpzPavadinimas: text",
            "papildomiBvpzKodai: text[]",
            "papildomiBvpzPavadinimai: text[]",
            "kategorija: text",
            "tipas: text",
            "istrinta: boolean",
            "pirkejoKodas: text",
            "pirkejas: text",
            "tiekejoKodas: text",
            "tiekejas: text",
            "papildomiTiekejaiKodai: text[]",
        ],
        primaryKeys: ["sutartiesUnikalusId"],
        example:
            'SELECT "sutartiesUnikalusId", pirkejas, tiekejas, verte, "bvpzPavadinimas", "sudarymoData" FROM v_sutartys WHERE "sudarymoData" >= CURRENT_DATE - INTERVAL \'1 year\'',
    },
    v_pirkimas: {
        tags: ["procedures", "criteria", "lot-count", "single-bidder"],
        keys: ["pirkimoId", "jarKodas", "pirkimoBudas", "statusas", "numatomaVerteEUR"],
        joins: [
            ["jarKodas", "v_company.jarKodas", "strict"],
            ["pirkimoId", "v_sutartys.pirkimoNumeris", "semantic"],
            ["pirkimoId", "v_dalyviai.pirkimoNumeris", "semantic"],
        ],
        columns: [
            "pirkimoId: text",
            "pavadinimas: text",
            "jarKodas: text",
            "organizatorius: text",
            "trumpinys: text",
            "miestas: text",
            "pirkimoBudas: text",
            "statusas: text",
            "zingsnis: text",
            "pirkimoObjektoTipas: text",
            "numatomaVerteEUR: numeric",
            "paskelbimoData: timestamp without time zone",
            "pasiulymuPateikimoTerminas: timestamp without time zone",
            "esFinansavimas: boolean",
            "bvpzKodai: text[]",
            "informacija: text",
        ],
        primaryKeys: ["pirkimoId"],
        example:
            'SELECT "pirkimoId", pavadinimas, organizatorius, statusas, "numatomaVerteEUR" FROM v_pirkimas WHERE statusas = \'Paskelbtas\'',
    },
    v_person_links: {
        tags: ["conflict-of-interest", "directors", "beneficial-owners"],
        keys: ["id", "jarKodas", "vardas", "pavarde", "pareigos"],
        joins: [
            ["jarKodas", "v_company.jarKodas", "strict"],
        ],
        columns: [
            "id: bigint",
            "deklaracija: uuid",
            "vardas: text",
            "pavarde: text",
            "susijusioAsmensVardas: text",
            "susijusioAsmensPavarde: text",
            "jarKodas: text",
            "imonesVardas: text",
            "pareigos: text",
            "irasoTipas: text",
            "darbovietesTipas: text",
            "rysioPobudzioPavadinimas: text",
            "rysioPradzia: date",
            "rysioPabaiga: date",
            "yraJuridinisAsmuo: boolean",
            "registruotaLietuvoje: boolean",
            "jaTeisinesFormosPavadinimas: text",
            "kienoRysys: text",
            "dalyvaujaViesuosePirkimuose: boolean",
            "dalyvavimoVpInformacija: text",
            "pateikimoData: timestamp without time zone",
        ],
        primaryKeys: ["id"],
        example:
            'SELECT vardas, pavarde, "imonesVardas", pareigos, "dalyvaujaViesuosePirkimuose" FROM v_person_links WHERE "jarKodas" = \'302556251\'',
    },
    v_dalyviai: {
        tags: ["bid-ranking", "rejections", "co-bidding", "single-bidder"],
        keys: ["pirkimoNumeris", "tiekejoKodas", "eileNumeris", "pasiulymoKaina", "interesuKonfliktasNustatytas"],
        joins: [
            ["pirkejoKodas", "v_company.jarKodas", "strict"],
            ["tiekejoKodas", "v_company.jarKodas", "sparse"],
            ["pirkimoNumeris", "v_pirkimas.pirkimoId", "semantic"],
            ["pirkimoNumeris", "v_sutartys.pirkimoNumeris", "semantic"],
        ],
        columns: [
            "pirkimoNumeris: text",
            "pirkejoKodas: text",
            "pirkimoBudas: text",
            "ataskaitosData: timestamp with time zone",
            "pirkimoObjektoPavadinimas: text",
            "pagrindinisKodasBvpz: text",
            "daliuSkaicius: integer",
            "interesuKonfliktasNustatytas: boolean",
            "interesuKonfliktoPriemones: text",
            "konkurencijaIskreipiantisAsmuo: boolean",
            "konkurencijosPriemones: text",
            "pretenzijaPateikta: boolean",
            "ieskinysTeismui: boolean",
            "tiekejoKodas: text",
            "tiekejas: text",
            "fizinisAsmuo: boolean",
            "salis: text",
            "eileNumeris: integer",
            "pasiulymoKaina: numeric",
            "atmetimoPriezastis: text",
        ],
        primaryKeys: [],
        example:
            'SELECT "pirkimoNumeris", "tiekejoKodas", tiekejas, "eileNumeris", "pasiulymoKaina", "interesuKonfliktasNustatytas" FROM v_dalyviai WHERE "pirkimoNumeris" = \'1005158\'',
    },
    v_bylos: {
        tags: ["court", "litigation", "enforcement"],
        keys: ["bylosId", "jarKodas", "bylosNumeris", "bylosRusis", "bylojeKaip"],
        joins: [
            ["jarKodas", "v_company.jarKodas", "strict"],
        ],
        columns: [
            "bylosId: bigint",
            "bylosNumeris: text",
            "bylosRusis: text",
            "bylosData: date",
            "teismas: text",
            "jarKodas: text",
            "dalyvioPavadinimas: text",
            "dalyvioVardasIrPavarde: text",
            "bylojeKaip: text",
        ],
        primaryKeys: ["bylosId"],
        example:
            'SELECT "bylosId", "bylosNumeris", teismas, "dalyvioPavadinimas", "bylojeKaip" FROM v_bylos WHERE "jarKodas" = \'302556251\'',
    },
};

assertViewMetadataCompleteness();

export const name = "get_schema";
export const description =
    "Returns schema for the procurement database. " +
    "No args (mode: 'inventory'): compact list — id, kind, tags, keys for all entities. " +
    "With table + mode 'detail' (default): pk, columns object {name→type}, joins tuples [local,foreign,joinType], one example. " +
    "mode 'columns': column name→type map only. " +
    "mode 'joins': pk and joins tuples only. " +
    "mode 'examples': example SQL only. " +
    "joinType values: 'strict' (enforced FK, safe for INNER JOIN), 'semantic' (logical only, may miss rows), 'sparse' (FK exists but many nulls). " +
    "Call with no args at investigation start. Call with table+mode when you need column or join details.";

export const schema = {
    table: z
        .enum([...TABLE_LIST, ...VIEW_LIST])
        .optional()
        .describe("Table or view name. Omit to list all entities (inventory mode)."),
    mode: z
        .enum(["inventory", "detail", "columns", "joins", "examples"])
        .optional()
        .describe(
            "Output mode: inventory (default, no table) | detail (default with table) | columns | joins | examples"
        ),
};

export async function handler({ table, mode } = {}) {
    if (!table || mode === "inventory") {
        return listAll();
    }
    const effectiveMode = mode ?? "detail";
    if (effectiveMode === "columns") {
        return VIEW_NAMES.has(table) ? describeViewColumns(table) : describeTableColumns(table);
    }
    if (effectiveMode === "joins") {
        return VIEW_NAMES.has(table) ? describeViewJoins(table) : describeTableJoins(table);
    }
    if (effectiveMode === "examples") {
        return VIEW_NAMES.has(table) ? describeViewExamples(table) : describeTableExamples(table);
    }
    // detail (default)
    if (VIEW_NAMES.has(table)) {
        return describeViewDetail(table);
    }
    return describeTableDetail(table);
}

async function listAll() {
    const [statsResult, columnsResult] = await Promise.all([
        postgres.query(
            `
            SELECT relname AS table_name, n_live_tup AS row_count_estimate
            FROM pg_stat_user_tables
            WHERE relname = ANY($1::text[])
            ORDER BY relname
        `,
            [TABLE_LIST]
        ),
        postgres.query(
            `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            ORDER BY table_name, ordinal_position
        `,
            [TABLE_LIST]
        ),
    ]);

    const rowCountMap = Object.fromEntries(
        statsResult.rows.map((r) => [r.table_name, r.row_count_estimate])
    );
    const columnMap = new Map();
    for (const row of columnsResult.rows) {
        if (!columnMap.has(row.table_name)) {
            columnMap.set(row.table_name, []);
        }
        columnMap.get(row.table_name).push(row.column_name);
    }

    const views = VIEW_LIST.map((id) => {
        const metadata = VIEW_METADATA[id];
        return { id, kind: "view", tags: metadata.tags, keys: metadata.keys };
    });

    const tables = TABLE_LIST.map((id) => {
        const cols = columnMap.get(id) ?? [];
        const entry = { id, kind: "table", keys: cols.slice(0, 3) };
        const rc = rowCountMap[id];
        if (rc != null) entry.rowCountEstimate = rc;
        return entry;
    });

    const entities = [...views, ...tables];

    return {
        structuredContent: { entities },
        content: [
            {
                type: "text",
                text: `${entities.length} entities. Views: ${views.length} (use tags to route). Tables: ${tables.length}. Pass table+mode:'detail' for columns/joins.`,
            },
        ],
    };
}

// --- View detail modes ---

async function describeViewDetail(viewName) {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }

    const result = {
        id: viewName,
        pk: metadata.primaryKeys,
        columns: columnsArrayToObject(metadata.columns),
        joins: metadata.joins,
        ex: metadata.example,
    };

    return {
        structuredContent: result,
        content: [
            {
                type: "text",
                text: `${viewName}: ${metadata.columns.length} columns, ${metadata.joins.length} joins. Includes example.`,
            },
        ],
    };
}

async function describeViewColumns(viewName) {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }
    const result = { id: viewName, columns: columnsArrayToObject(metadata.columns) };
    return {
        structuredContent: result,
        content: [{ type: "text", text: `${viewName}: ${metadata.columns.length} columns.` }],
    };
}

async function describeViewJoins(viewName) {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }
    const result = { id: viewName, pk: metadata.primaryKeys, joins: metadata.joins };
    return {
        structuredContent: result,
        content: [{ type: "text", text: `${viewName}: ${metadata.joins.length} joins.` }],
    };
}

async function describeViewExamples(viewName) {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }
    const result = { id: viewName, ex: [metadata.example] };
    return {
        structuredContent: result,
        content: [{ type: "text", text: `${viewName}: 1 example.` }],
    };
}

// --- Table detail modes ---

async function describeTableDetail(tableName) {
    const coveringView = COVERED_TABLES_BY_VIEWS[tableName];
    if (coveringView) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' is fully covered by view '${coveringView}'. Call get_schema with '${coveringView}' to see columns, joins, and an example query.`,
                },
            ],
        };
    }

    const [colResult, primaryKeyResult, foreignKeyResult] = await Promise.all([
        postgres.query(
            `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
            ORDER BY ordinal_position
        `,
            [tableName]
        ),
        postgres.query(
            `
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = $1
        `,
            [tableName]
        ),
        postgres.query(
            `
            SELECT
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.constraint_schema = tc.constraint_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = $1
        `,
            [tableName]
        ),
    ]);

    if (colResult.rows.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' not found. Call get_schema without arguments to see the full table list.`,
                },
            ],
            isError: true,
        };
    }

    const primaryKeys = primaryKeyResult.rows.map((row) => row.column_name);
    const columns = columnsArrayToObject(
        colResult.rows.map((r) => `${r.column_name}: ${r.data_type}`)
    );
    const joins = foreignKeyResult.rows.map((row) => [
        row.column_name,
        `${row.foreign_table_name}.${row.foreign_column_name}`,
        "strict",
    ]);

    const result = {
        id: tableName,
        pk: primaryKeys,
        columns,
        joins,
        ex: buildTableExample(tableName, colResult.rows),
    };

    return {
        structuredContent: result,
        content: [
            {
                type: "text",
                text: `${tableName}: ${Object.keys(columns).length} columns, ${joins.length} joins. Includes example.`,
            },
        ],
    };
}

async function describeTableColumns(tableName) {
    const coveringView = COVERED_TABLES_BY_VIEWS[tableName];
    if (coveringView) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' is covered by view '${coveringView}'. Use get_schema with '${coveringView}' instead.`,
                },
            ],
        };
    }

    const colResult = await postgres.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
    );

    if (colResult.rows.length === 0) {
        return {
            content: [{ type: "text", text: `Table '${tableName}' not found.` }],
            isError: true,
        };
    }

    const columns = columnsArrayToObject(colResult.rows.map((r) => `${r.column_name}: ${r.data_type}`));
    return {
        structuredContent: { id: tableName, columns },
        content: [{ type: "text", text: `${tableName}: ${Object.keys(columns).length} columns.` }],
    };
}

async function describeTableJoins(tableName) {
    const coveringView = COVERED_TABLES_BY_VIEWS[tableName];
    if (coveringView) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' is covered by view '${coveringView}'. Use get_schema with '${coveringView}' instead.`,
                },
            ],
        };
    }

    const [primaryKeyResult, foreignKeyResult] = await Promise.all([
        postgres.query(
            `SELECT kcu.column_name FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
            [tableName]
        ),
        postgres.query(
            `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
            [tableName]
        ),
    ]);

    const pk = primaryKeyResult.rows.map((r) => r.column_name);
    const joins = foreignKeyResult.rows.map((row) => [
        row.column_name,
        `${row.foreign_table_name}.${row.foreign_column_name}`,
        "strict",
    ]);

    return {
        structuredContent: { id: tableName, pk, joins },
        content: [{ type: "text", text: `${tableName}: ${joins.length} joins.` }],
    };
}

async function describeTableExamples(tableName) {
    const coveringView = COVERED_TABLES_BY_VIEWS[tableName];
    if (coveringView) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' is covered by view '${coveringView}'. Use get_schema with '${coveringView}' instead.`,
                },
            ],
        };
    }

    const colResult = await postgres.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
    );

    if (colResult.rows.length === 0) {
        return {
            content: [{ type: "text", text: `Table '${tableName}' not found.` }],
            isError: true,
        };
    }

    const ex = buildTableExample(tableName, colResult.rows);
    return {
        structuredContent: { id: tableName, ex: [ex] },
        content: [{ type: "text", text: `${tableName}: 1 example.` }],
    };
}

// --- Helpers ---

function columnsArrayToObject(colStrings) {
    const obj = {};
    for (const col of colStrings) {
        const colonIdx = col.indexOf(": ");
        if (colonIdx !== -1) {
            obj[col.slice(0, colonIdx)] = col.slice(colonIdx + 2);
        }
    }
    return obj;
}

function buildTableExample(tableName, rows) {
    if (rows.length === 0) {
        return `SELECT 1 FROM "${tableName}" WHERE 1 = 1`;
    }

    const selectColumns = rows.map((r) => `"${r.column_name}"`);
    const whereColumn = pickRecommendedWhereColumn(rows);
    const wherePredicate = buildWherePredicate(whereColumn);
    return `SELECT ${selectColumns.join(", ")} FROM "${tableName}" WHERE ${wherePredicate}`;
}

function pickRecommendedWhereColumn(rows) {
    for (const candidate of IDENTIFIER_CANDIDATES) {
        const found = rows.find((r) => r.column_name === candidate);
        if (found) return found;
    }

    const temporal = rows.find((r) =>
        r.data_type.includes("timestamp") || r.data_type === "date"
    );
    if (temporal) return temporal;

    const textColumn = rows.find((r) => r.data_type === "text");
    if (textColumn) return textColumn;

    return rows[0];
}

function buildWherePredicate(row) {
    const quotedName = `"${row.column_name}"`;
    const lowerName = row.column_name.toLowerCase();
    const lowerType = row.data_type.toLowerCase();

    if (lowerName.includes("kodas")) {
        return `${quotedName} = '302556251'`;
    }
    if (lowerName.includes("numeris")) {
        return `${quotedName} = '1005158'`;
    }
    if (lowerType === "boolean") {
        return `${quotedName} = true`;
    }
    if (lowerType === "date" || lowerType.includes("timestamp")) {
        return `${quotedName} >= CURRENT_DATE - INTERVAL '1 year'`;
    }
    if (
        lowerType.includes("int") ||
        lowerType === "numeric" ||
        lowerType === "real" ||
        lowerType === "double precision"
    ) {
        return `${quotedName} > 0`;
    }
    if (lowerType.endsWith("[]")) {
        return `${quotedName} IS NOT NULL`;
    }
    if (lowerType === "text") {
        return `${quotedName} IS NOT NULL`;
    }
    return `${quotedName} IS NOT NULL`;
}

function assertViewMetadataCompleteness() {
    for (const viewName of VIEW_LIST) {
        if (!VIEW_METADATA[viewName]) {
            throw new Error(`Missing VIEW_METADATA for '${viewName}'.`);
        }
        const m = VIEW_METADATA[viewName];
        if (!Array.isArray(m.tags) || m.tags.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define a non-empty tags array.`);
        }
        if (!Array.isArray(m.keys) || m.keys.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define a non-empty keys array.`);
        }
        if (!Array.isArray(m.joins)) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define a joins array.`);
        }
        for (const join of m.joins) {
            if (!Array.isArray(join) || join.length !== 3 || !["strict", "semantic", "sparse"].includes(join[2])) {
                throw new Error(`VIEW_METADATA['${viewName}'] join ${JSON.stringify(join)} must be [local, foreign, "strict"|"semantic"|"sparse"].`);
            }
        }
        if (!Array.isArray(m.columns) || m.columns.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define at least one column.`);
        }
        for (const col of m.columns) {
            if (typeof col !== "string" || !col.includes(": ")) {
                throw new Error(`VIEW_METADATA['${viewName}'] column '${col}' must be "name: type" string format.`);
            }
        }
        if (!Array.isArray(m.primaryKeys)) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define primaryKeys array.`);
        }
        if (typeof m.example !== "string" || m.example.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define an example SQL query.`);
        }
    }
}

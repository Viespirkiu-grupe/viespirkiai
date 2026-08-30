import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { TABLE_WHITELIST } from "../analyst/validateSql.js";
import { VIEW_NAMES, COVERED_TABLES_BY_VIEWS } from "../analyst/tempViews.js";
import { traceSQL, traceSQLFailure } from "../analyst/utils.js";
import { logToolCall } from "../mcpLogger.js";

const COVERED_TABLES = new Set(Object.keys(COVERED_TABLES_BY_VIEWS));
const TABLE_LIST = [...TABLE_WHITELIST].filter((t) => !COVERED_TABLES.has(t));
const VIEW_LIST = [...VIEW_NAMES];
// Analyst rolės search_path schemos — lentelės iškeltos iš `public` (domenai,
// ppa, liteko, vdi, sodra) informacinėse schemose randamos tik pagal savo schemą.
const ANALYST_SCHEMAS = ["public", "viespirkiai", "domenai", "ppa", "liteko", "vdi", "sodra"];
const SCHEMA_ARRAY = `ARRAY[${ANALYST_SCHEMAS.map((s) => `'${s}'`).join(", ")}]`;
const IDENTIFIER_CANDIDATES = [
    "id",
    "sutartiesUnikalusId",
    "pirkimoId",
    "pirkimoNumeris",
    "jarKodas",
    "tiekejoKodas",
    "pirkejoKodas",
];

type JoinType = "strict" | "semantic" | "sparse";
type JoinDef = [string, string, JoinType];

interface ViewMetadata {
    tags: string[];
    keys: string[];
    joins: JoinDef[];
    columns: string[];
    primaryKeys: string[];
    example: string;
    notes?: string;
}

export const VIEW_METADATA: Record<string, ViewMetadata> = {
    v_company: {
        tags: ["capacity", "blacklist", "labor", "domains", "court"],
        keys: ["jarKodas", "pavadinimas", "darbuotojai", "melagingisTiekejas", "bylosSkaicius"],
        joins: [
            ["jarKodas", "jarAsmenys.jarKodas", "strict"],
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
            ["pirkimoNumeris", "v_dalyviai.pirkimoNumeris", "semantic"],
        ],
        columns: [
            "sutartiesUnikalusId: bigint",
            "sutartiesNumeris: text",
            "pirkimoNumeris: text",
            "sudarymoData: timestamp without time zone",
            "paskelbimoData: timestamp without time zone",
            "galiojimoData: timestamp without time zone",
            "faktineIvykdimoData: timestamp without time zone",
            "paskutinioRedagavimoData: timestamp without time zone",
            "paskutinioAtnaujinimoData: timestamp without time zone",
            "paskutiniKartaMatyta: timestamp without time zone",
            "paskutiniKartaAtnaujinta: timestamp without time zone",
            "verte: numeric",
            "suma: numeric",
            "faktineIvykdimoVerte: numeric",
            "pavadinimas: text",
            "bvpzKodas: text",
            "bvpzPavadinimas: text",
            "papildomiBvpzKodai: text[]",
            "papildomiBvpzPavadinimai: text[]",
            "bvpzKodai: text[]",
            "bvpzPavadinimai: text[]",
            "kategorija: text",
            "tipas: text",
            "tipoPavadinimas: text",
            "istrinta: boolean",
            "dokumentuKiekis: integer",
            "pirkejoKodas: text",
            "perkanciojiOrganizacija: text",
            "pirkejas: text",
            "tiekejoKodas: text",
            "tiekejoPavadinimas: text",
            "tiekejas: text",
            "papildomiTiekejai: text[]",
            "papildomiTiekejaiKodai: text[]",
            "tiekejaiKodai: text[]",
            "tiekejai: text[]",
        ],
        primaryKeys: ["sutartiesUnikalusId"],
        example:
            'SELECT "sutartiesUnikalusId", pirkejas, tiekejas, verte, "bvpzPavadinimas", "sudarymoData" FROM v_sutartys WHERE "sudarymoData" >= CURRENT_DATE - INTERVAL \'1 year\'',
    },
    v_pirkimas: {
        tags: ["procedures", "criteria", "lot-count", "single-bidder", "cvpp-archive"],
        keys: ["pirkimoId", "saltinis", "jarKodas", "pirkimoBudas", "statusas", "numatomaVerteEUR"],
        joins: [
            ["jarKodas", "v_company.jarKodas", "strict"],
            ["pirkimoId", "v_sutartys.pirkimoNumeris", "semantic"],
            ["pirkimoId", "v_dalyviai.pirkimoNumeris", "semantic"],
        ],
        columns: [
            "saltinis: text",
            "pirkimoId: text",
            "pavadinimas: text",
            "jarKodas: text",
            "jarKodasSaltinis: text",
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
        notes:
            "Du šaltiniai (saltinis):\n" +
            "- 'cvpis': CVP IS, ~2022-09–dabar. jarKodas tiesioginis, jarKodasSaltinis=NULL.\n" +
            "- 'cvpp': CVPP archyvas, iki 2022 (tik 'Skelbimas apie pirkimą', be CVP IS dublikatų). " +
            "pirkimoBudas/statusas/zingsnis/pirkimoObjektoTipas/numatomaVerteEUR/esFinansavimas/bvpzKodai=NULL; " +
            "informacija=nuoroda į CVPP skelbimą.\n" +
            "jarKodas 'cvpp' eilutėms gaunamas per sutartys.pirkimoNumeris atitikmenį (~45% atvejų): " +
            "jarKodasSaltinis='sutartys-join' jei rastas; kitaip jarKodas ir jarKodasSaltinis=NULL — " +
            "tokiu atveju pirkėją filtruok per organizatorius (tekstas), ne jarKodas.",
    },
    v_dalyviai: {
        tags: ["bid-ranking", "rejections", "co-bidding", "single-bidder"],
        keys: ["pirkimoNumeris", "tiekejoKodas", "daliesNumeris", "eileNumeris", "pasiulymoKaina", "interesuKonfliktasNustatytas"],
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
            "daliesNumeris: text",
            "eileNumeris: integer",
            "pasiulymoKaina: numeric",
            "atmetimoPriezastis: text",
        ],
        primaryKeys: [],
        example:
            'SELECT "pirkimoNumeris", "tiekejoKodas", tiekejas, "daliesNumeris", "eileNumeris", "pasiulymoKaina", "interesuKonfliktasNustatytas" FROM v_dalyviai WHERE "pirkimoNumeris" = \'1005158\'',
        notes:
            "Vienas eilutė per (pirkimas, tiekėjas, pirkimo dalis). Apima PPA ataskaitas. " +
            "eileNumeris/pasiulymoKaina — laimėtojo/ne atmestų pasiūlymų eilė konkrečioje dalyje (daliesNumeris); " +
            "atmetimoPriezastis užpildytas, jei pasiūlymas tos dalies buvo atmestas. " +
            "Abu gali būti NULL tai pačiai (pirkimas, tiekėjas, dalis) eilutei, jei duomenų nėra.",
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
    "Grąžina viešųjų pirkimų duomenų bazės schemą. " +
    "Be argumentų (mode: 'inventory'): kompaktiškas sąrašas — id, tipas, žymos, raktai visiems objektams. " +
    "Su table + mode 'detail' (numatytasis): pk, stulpeliai {pavadinimas→tipas}, jungtys [vietinis,išorinis,tipas], vienas pavyzdys. " +
    "mode 'columns': tik stulpelių pavadinimų→tipų žemėlapis. " +
    "mode 'joins': tik pk ir jungtys. " +
    "mode 'examples': tik SQL pavyzdžiai. " +
    "Jungčių tipai: 'strict' (privaloma FK, saugu INNER JOIN), 'semantic' (tik loginė, gali trūkti eilučių), 'sparse' (FK yra, bet daug NULL). " +
    "Iškvieskite be argumentų tyrimo pradžioje. Iškvieskite su table+mode kai reikia tikslių stulpelių ar jungčių detalių prieš execute_query.";

export const schema = {
    table: z
        .enum([...TABLE_LIST, ...VIEW_LIST] as [string, ...string[]])
        .optional()
        .describe("Table or view name. Omit to list all entities (inventory mode)."),
    mode: z
        .enum(["inventory", "detail", "columns", "joins", "examples"])
        .optional()
        .describe(
            "Output mode: inventory (default, no table) | detail (default with table) | columns | joins | examples"
        ),
};

// In-process cache: schema/inventory results are stable for the lifetime of the process.
// Keyed by "<table>:<effectiveMode>" — empty string prefix for inventory.
const _cache = new Map<string, object>();

export async function handler({ table, mode }: { table?: string; mode?: string } = {}): Promise<object> {
    const effectiveMode = (!table || mode === "inventory") ? "inventory" : (mode ?? "detail");
    const cacheKey = `${table ?? ""}:${effectiveMode}`;
    traceSQL(`[get_schema] CALL table=${table ?? "(none)"} mode=${effectiveMode}`);

    if (_cache.has(cacheKey)) {
        logToolCall({ toolName: name, durationMs: 0, success: true, errorMsg: undefined });
        return _cache.get(cacheKey)!;
    }

    const start = Date.now();
    try {
        const result = await _compute(table, effectiveMode);
        _cache.set(cacheKey, result);
        logToolCall({ toolName: name, durationMs: Date.now() - start, success: true, errorMsg: undefined });
        return result;
    } catch (err: unknown) {
        const msg = (err as Error).message;
        traceSQLFailure(`[get_schema] ERROR table=${table ?? "(none)"} mode=${effectiveMode} error="${msg}"`);
        logToolCall({ toolName: name, durationMs: Date.now() - start, success: false, errorMsg: msg });
        throw err;
    }
}

async function _compute(table: string | undefined, effectiveMode: string): Promise<object> {
    if (effectiveMode === "inventory") {
        return listAll();
    }
    if (effectiveMode === "columns") {
        return VIEW_NAMES.has(table!) ? describeViewColumns(table!) : describeTableColumns(table!);
    }
    if (effectiveMode === "joins") {
        return VIEW_NAMES.has(table!) ? describeViewJoins(table!) : describeTableJoins(table!);
    }
    if (effectiveMode === "examples") {
        return VIEW_NAMES.has(table!) ? describeViewExamples(table!) : describeTableExamples(table!);
    }
    // detail (default)
    if (VIEW_NAMES.has(table!)) {
        return describeViewDetail(table!);
    }
    return describeTableDetail(table!);
}

async function listAll(): Promise<object> {
    const [statsResult, columnsResult] = await Promise.all([
        postgres.query(
            `
            SELECT relname AS table_name, n_live_tup AS row_count_estimate
            FROM pg_stat_user_tables
            WHERE schemaname = ANY(${SCHEMA_ARRAY})
              AND relname = ANY($1::text[])
            ORDER BY relname
        `,
            [TABLE_LIST]
        ),
        postgres.query(
            `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = ANY(${SCHEMA_ARRAY})
              AND table_name = ANY($1::text[])
            ORDER BY table_name, ordinal_position
        `,
            [TABLE_LIST]
        ),
    ]);

    const rowCountMap = Object.fromEntries(
        statsResult.rows.map((r) => [r.table_name, r.row_count_estimate])
    );
    const columnMap = new Map<string, string[]>();
    for (const row of columnsResult.rows) {
        if (!columnMap.has(row.table_name)) {
            columnMap.set(row.table_name, []);
        }
        columnMap.get(row.table_name)!.push(row.column_name);
    }

    const views = VIEW_LIST.map((id) => {
        const metadata = VIEW_METADATA[id];
        return { id, kind: "view", tags: metadata.tags, keys: metadata.keys };
    });

    const tables = TABLE_LIST.map((id) => {
        const cols = columnMap.get(id) ?? [];
        const entry: Record<string, unknown> = { id, kind: "table", keys: cols.slice(0, 3), note: "Call get_schema(table, mode:'detail') for full column list before querying." };
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
                text: `${entities.length} entities. Views: ${views.length} (use tags to route). Tables: ${tables.length}. IMPORTANT: Always call get_schema(table, mode:'detail') for the exact column list before writing any query — never guess column names from other tables or views.`,
            },
        ],
    };
}

// --- View detail modes ---

async function describeViewDetail(viewName: string): Promise<object> {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }

    const result: Record<string, unknown> = {
        id: viewName,
        pk: metadata.primaryKeys,
        columns: columnsArrayToObject(metadata.columns),
        joins: metadata.joins,
        ex: metadata.example,
    };
    if (metadata.notes) result.notes = metadata.notes;

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

async function describeViewColumns(viewName: string): Promise<object> {
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

async function describeViewJoins(viewName: string): Promise<object> {
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

async function describeViewExamples(viewName: string): Promise<object> {
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

interface ColumnRow {
    column_name: string;
    data_type: string;
    is_nullable?: string;
}

async function describeTableDetail(tableName: string): Promise<object> {
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
            WHERE table_schema = ANY(${SCHEMA_ARRAY})
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
              AND tc.table_schema = ANY(${SCHEMA_ARRAY})
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
              AND tc.table_schema = ANY(${SCHEMA_ARRAY})
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
        colResult.rows.map((r: ColumnRow) => `${r.column_name}: ${r.data_type}`)
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

async function describeTableColumns(tableName: string): Promise<object> {
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
         WHERE table_schema = ANY(${SCHEMA_ARRAY}) AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
    );

    if (colResult.rows.length === 0) {
        return {
            content: [{ type: "text", text: `Table '${tableName}' not found.` }],
            isError: true,
        };
    }

    const columns = columnsArrayToObject(colResult.rows.map((r: ColumnRow) => `${r.column_name}: ${r.data_type}`));
    return {
        structuredContent: { id: tableName, columns },
        content: [{ type: "text", text: `${tableName}: ${Object.keys(columns).length} columns.` }],
    };
}

async function describeTableJoins(tableName: string): Promise<object> {
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
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = ANY(${SCHEMA_ARRAY}) AND tc.table_name = $1`,
            [tableName]
        ),
        postgres.query(
            `SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY(${SCHEMA_ARRAY}) AND tc.table_name = $1`,
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

async function describeTableExamples(tableName: string): Promise<object> {
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
         WHERE table_schema = ANY(${SCHEMA_ARRAY}) AND table_name = $1 ORDER BY ordinal_position`,
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

function columnsArrayToObject(colStrings: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const col of colStrings) {
        const colonIdx = col.indexOf(": ");
        if (colonIdx !== -1) {
            obj[col.slice(0, colonIdx)] = col.slice(colonIdx + 2);
        }
    }
    return obj;
}

function buildTableExample(tableName: string, rows: ColumnRow[]): string {
    if (rows.length === 0) {
        return `SELECT 1 FROM "${tableName}" WHERE 1 = 1`;
    }

    const selectColumns = rows.map((r) => `"${r.column_name}"`);
    const whereColumn = pickRecommendedWhereColumn(rows);
    const wherePredicate = buildWherePredicate(whereColumn);
    return `SELECT ${selectColumns.join(", ")} FROM "${tableName}" WHERE ${wherePredicate}`;
}

function pickRecommendedWhereColumn(rows: ColumnRow[]): ColumnRow {
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

function buildWherePredicate(row: ColumnRow): string {
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

function assertViewMetadataCompleteness(): void {
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

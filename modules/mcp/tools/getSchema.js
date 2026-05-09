import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { TABLE_WHITELIST, VIEW_NAMES } from "../analyst/validateSql.js";

const TABLE_LIST = [...TABLE_WHITELIST];
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

const TABLE_DESCRIPTIONS = {
    sutartys: "Public procurement contracts with buyer, supplier, value, and timing fields.",
    jarCsv: "Company registry snapshot with legal entity identity and profile attributes.",
    viesiejiPirkimai: "Procurement notices with status, method, and estimated value fields.",
    viesiejiPirkimaiVykdytojai: "Lookup table for procurement organizers and location details.",
    pinregJuridiniaiRysiai: "Declared person-to-company links and relationship metadata.",
    bylos: "Court case records with case number, type, date, and court.",
    bylosDalyviai: "Court case participants, their codes, and participation role.",
    atn1ataskaitos: "ATN-1 procurement report headers and process metadata.",
    atn1dalyviai: "ATN-1 report participants (suppliers) per procurement report.",
    atn1pasiulymuEile: "ATN-1 supplier ranking and bid price rows.",
    atn1atmestiPasiulymai: "ATN-1 rejected bids with rejection reasons.",
    failai: "Document/file registry with source links and OCR-related attributes.",
    sodra: "Employer social insurance metrics by period and company code.",
    domenai: "Domain ownership records linked to legal entities.",
    mokesciai: "Tax-related indicators by legal entity and period.",
};

const VIEW_METADATA = {
    v_company: {
        description:
            "Company profile with workforce, payroll, risk flags, and activity counters.",
        columns: [
            { name: "jarKodas", type: "text", primaryKey: true },
            { name: "pavadinimas", type: "text", description: "Company name." },
            { name: "adresas", type: "text", description: "Registered address." },
            { name: "registravimoData", type: "timestamp without time zone" },
            { name: "statusoPavadinimas", type: "text" },
            { name: "statusasNuo", type: "timestamp without time zone" },
            { name: "sodraData", type: "date", description: "Latest sodra snapshot date." },
            { name: "darbuotojai", type: "integer", description: "Current employee count estimate." },
            { name: "vidutinisAtlyginimas", type: "numeric" },
            { name: "imokuSuma", type: "numeric" },
            { name: "melagingisTiekejas", type: "boolean" },
            { name: "nepatikimasTiekejas", type: "boolean" },
            { name: "vdiPazeidimuSkaicius", type: "bigint" },
            { name: "bylosSkaicius", type: "bigint" },
            { name: "domenaiSkaicius", type: "bigint" },
            { name: "neskelbiamosDerybosSkaicius", type: "bigint" },
        ],
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for company master data.",
            },
        ],
        example:
            'SELECT "jarKodas", pavadinimas, darbuotojai, "vidutinisAtlyginimas" FROM v_company WHERE "jarKodas" = \'302556251\'',
    },
    v_sutartys: {
        description:
            "Contract-centric view with buyer/supplier names and key contract values.",
        columns: [
            { name: "sutartiesUnikalusId", type: "bigint", primaryKey: true },
            { name: "pirkimoNumeris", type: "text" },
            { name: "sudarymoData", type: "timestamp without time zone" },
            { name: "galiojimoData", type: "timestamp without time zone" },
            { name: "verte", type: "numeric" },
            { name: "faktineIvykdimoVerte", type: "numeric" },
            { name: "pavadinimas", type: "text" },
            { name: "bvpzKodas", type: "text" },
            { name: "tipas", type: "text" },
            { name: "istrinta", type: "boolean" },
            { name: "pirkejoKodas", type: "text" },
            { name: "pirkejas", type: "text", description: "Buyer name from jarCsv." },
            { name: "tiekejoKodas", type: "text" },
            { name: "tiekejas", type: "text", description: "Supplier name from jarCsv." },
            { name: "papildomiTiekejaiKodai", type: "text[]" },
        ],
        relationships: [
            {
                column: "pirkejoKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for buyer company details.",
            },
            {
                column: "tiekejoKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for supplier company details.",
            },
        ],
        example:
            'SELECT "sutartiesUnikalusId", pirkejas, tiekejas, verte, "sudarymoData" FROM v_sutartys WHERE "sudarymoData" >= CURRENT_DATE - INTERVAL \'1 year\'',
    },
    v_pirkimas: {
        description:
            "Procurement notice view with organizer details, lifecycle status, and value.",
        columns: [
            { name: "pirkimoId", type: "bigint", primaryKey: true },
            { name: "pavadinimas", type: "text" },
            { name: "jarKodas", type: "text" },
            { name: "organizatorius", type: "text" },
            { name: "trumpinys", type: "text" },
            { name: "miestas", type: "text" },
            { name: "pirkimoBudas", type: "text" },
            { name: "statusas", type: "text" },
            { name: "zingsnis", type: "text" },
            { name: "pirkimoObjektoTipas", type: "text" },
            { name: "numatomaVerteEUR", type: "numeric" },
            { name: "paskelbimoData", type: "timestamp without time zone" },
            { name: "pasiulymuPateikimoTerminas", type: "timestamp without time zone" },
            { name: "esFinansavimas", type: "boolean" },
            { name: "bvpzKodai", type: "text[]" },
        ],
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for procuring organization details.",
            },
        ],
        example:
            'SELECT "pirkimoId", pavadinimas, organizatorius, statusas, "numatomaVerteEUR" FROM v_pirkimas WHERE statusas = \'Paskelbtas\'',
    },
    v_person_links: {
        description:
            "Person-to-organization relationship view from PINREG declarations.",
        columns: [
            { name: "id", type: "bigint", primaryKey: true },
            { name: "deklaracija", type: "text" },
            { name: "vardas", type: "text" },
            { name: "pavarde", type: "text" },
            { name: "susijusioAsmensVardas", type: "text" },
            { name: "susijusioAsmensPavarde", type: "text" },
            { name: "jarKodas", type: "text" },
            { name: "imonesVardas", type: "text" },
            { name: "pareigos", type: "text" },
            { name: "irasoTipas", type: "text" },
            { name: "darbovietesTipas", type: "text" },
            { name: "rysioPobudzioPavadinimas", type: "text" },
            { name: "rysioPradzia", type: "date" },
            { name: "rysioPabaiga", type: "date" },
            { name: "yraJuridinisAsmuo", type: "boolean" },
            { name: "registruotaLietuvoje", type: "boolean" },
        ],
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for organization name enrichment.",
            },
        ],
        example:
            'SELECT vardas, pavarde, "imonesVardas", pareigos, "rysioPobudzioPavadinimas" FROM v_person_links WHERE "jarKodas" = \'302556251\'',
    },
    v_dalyviai: {
        description:
            "Bidder-level ATN-1 procurement participation, ranking, and rejection data.",
        columns: [
            { name: "pirkimoNumeris", type: "text" },
            { name: "pirkejoKodas", type: "text" },
            { name: "pirkimoBudas", type: "text" },
            { name: "ataskaitosData", type: "timestamp without time zone" },
            { name: "tiekejoKodas", type: "text" },
            { name: "tiekejas", type: "text" },
            { name: "fizinisAsmuo", type: "boolean" },
            { name: "salis", type: "text" },
            { name: "eileNumeris", type: "integer" },
            { name: "pasiulymoKaina", type: "numeric" },
            { name: "atmetimoPriezastis", type: "text" },
        ],
        relationships: [
            {
                column: "pirkejoKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for buyer organization details.",
            },
            {
                column: "tiekejoKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for supplier organization details.",
            },
        ],
        example:
            'SELECT "pirkimoNumeris", "tiekejoKodas", tiekejas, "eileNumeris", "pasiulymoKaina" FROM v_dalyviai WHERE "pirkimoNumeris" = \'1005158\'',
    },
    v_bylos: {
        description:
            "Court case view linking case attributes with participant organizations.",
        columns: [
            { name: "bylosId", type: "bigint", primaryKey: true },
            { name: "bylosNumeris", type: "text" },
            { name: "bylosRusis", type: "text" },
            { name: "bylosData", type: "date" },
            { name: "teismas", type: "text" },
            { name: "jarKodas", type: "text" },
            { name: "dalyvioPavadinimas", type: "text" },
            { name: "dalyvioVardasIrPavarde", type: "text" },
            { name: "bylojeKaip", type: "text" },
        ],
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for legal entity details in case participants.",
            },
        ],
        example:
            'SELECT "bylosId", "bylosNumeris", teismas, "dalyvioPavadinimas", "bylojeKaip" FROM v_bylos WHERE "jarKodas" = \'302556251\'',
    },
};

assertViewMetadataCompleteness();

export const name = "get_schema";
export const description =
    "Returns schema information for the procurement database. " +
    "Without arguments: lists available query entities with row count estimates for base tables. " +
    "With a table or view name: returns normalized columns, keys, relationships, and an example SQL query. " +
    "Call this at the start of an investigation to understand what data is available.";

export const schema = {
    table: z
        .enum([...TABLE_LIST, ...VIEW_LIST])
        .optional()
        .describe(
            "Table or view name. Omit to list all available entities with brief descriptions."
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
            SELECT table_name, column_name, data_type, is_nullable
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
        columnMap.get(row.table_name).push({
            name: row.column_name,
            type: row.data_type,
            nullable: row.is_nullable === "YES",
            primaryKey: false,
        });
    }

    const tables = TABLE_LIST.map((identifier) => {
        const columns = columnMap.get(identifier) ?? [];
        return {
            identifier,
            description: buildTableDescription(identifier, columns),
            rowCountEstimate: rowCountMap[identifier] ?? null,
            example: buildTableExample(identifier, columns),
        };
    });

    const views = VIEW_LIST.map((identifier) => {
        const metadata = VIEW_METADATA[identifier];
        return {
            identifier,
            description: metadata.description,
            example: metadata.example,
        };
    });

    const entities = [...views, ...tables];

    return {
        structuredContent: { entities },
        content: [
            {
                type: "text",
                text: `Available schema entities: ${entities.length}. Use "table" to request columns, relationships, and a query example.`,
            },
        ],
    };
}

async function describeTable(tableName) {
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

    const primaryKeys = new Set(primaryKeyResult.rows.map((row) => row.column_name));
    const columns = colResult.rows.map((r) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === "YES",
        primaryKey: primaryKeys.has(r.column_name),
    }));

    const relationships = foreignKeyResult.rows.map((row) => ({
        column: row.column_name,
        references: `${row.foreign_table_name}.${row.foreign_column_name}`,
        description: "Foreign key relationship.",
    }));

    const result = {
        identifier: tableName,
        description: buildTableDescription(tableName, columns),
        columns,
        relationships,
        example: buildTableExample(tableName, columns),
    };

    return {
        structuredContent: result,
        content: [
            {
                type: "text",
                text: `${tableName}: ${columns.length} columns, ${relationships.length} relationships. Includes example SQL query.`,
            },
        ],
    };
}

async function describeView(viewName) {
    const metadata = VIEW_METADATA[viewName];
    if (!metadata) {
        return {
            content: [{ type: "text", text: `View '${viewName}' metadata was not found.` }],
            isError: true,
        };
    }

    const result = {
        identifier: viewName,
        description: metadata.description,
        columns: metadata.columns,
        relationships: metadata.relationships,
        example: metadata.example,
    };

    return {
        structuredContent: result,
        content: [
            {
                type: "text",
                text: `${viewName}: ${metadata.columns.length} columns, ${metadata.relationships.length} relationships. Includes example SQL query.`,
            },
        ],
    };
}

function buildTableExample(tableName, columns) {
    if (columns.length === 0) {
        return `SELECT 1 FROM "${tableName}" WHERE 1 = 1`;
    }

    const selectColumns = columns.map((c) => `"${c.name}"`);
    const whereColumn = pickRecommendedWhereColumn(columns);
    const wherePredicate = buildWherePredicate(whereColumn);
    return `SELECT ${selectColumns.join(", ")} FROM "${tableName}" WHERE ${wherePredicate}`;
}

function pickRecommendedWhereColumn(columns) {
    const primary = columns.find((c) => c.primaryKey);
    if (primary) return primary;

    for (const candidate of IDENTIFIER_CANDIDATES) {
        const found = columns.find((c) => c.name === candidate);
        if (found) return found;
    }

    const temporal = columns.find((c) =>
        c.type.includes("timestamp") || c.type === "date"
    );
    if (temporal) return temporal;

    const textColumn = columns.find((c) => c.type === "text");
    if (textColumn) return textColumn;

    return columns[0];
}

function buildWherePredicate(column) {
    const quotedName = `"${column.name}"`;
    const lowerName = column.name.toLowerCase();
    const lowerType = column.type.toLowerCase();

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

function buildTableDescription(tableName, columns) {
    if (TABLE_DESCRIPTIONS[tableName]) {
        return TABLE_DESCRIPTIONS[tableName];
    }
    return inferDescriptionFromColumns(tableName, columns);
}

function inferDescriptionFromColumns(tableName, columns) {
    if (columns.length === 0) {
        return `Public dataset table '${tableName}'.`;
    }

    const names = columns.map((c) => c.name.toLowerCase());
    const has = (token) => names.some((n) => n.includes(token));

    if (has("jar") || has("imones") || has("imone")) {
        return `Entity-focused dataset for '${tableName}' with company identifiers and profile fields.`;
    }
    if (has("sutart") || has("pirkimo")) {
        return `Procurement dataset for '${tableName}' with contract/procurement identifiers, values, and dates.`;
    }
    if (has("bylos") || has("teism")) {
        return `Court-case dataset for '${tableName}' with case attributes and participant linkage fields.`;
    }
    if (has("atlygin") || has("imoku") || has("draust")) {
        return `Employment and payroll-related dataset for '${tableName}' with period-based metrics.`;
    }
    if (has("kaina") || has("verte") || has("suma")) {
        return `Financial-value dataset for '${tableName}' with monetary indicators and related dimensions.`;
    }

    const sampleColumns = columns
        .slice(0, 3)
        .map((c) => `"${c.name}"`)
        .join(", ");
    return `Public dataset table '${tableName}' with columns such as ${sampleColumns}.`;
}

function assertViewMetadataCompleteness() {
    for (const viewName of VIEW_LIST) {
        if (!VIEW_METADATA[viewName]) {
            throw new Error(`Missing VIEW_METADATA for '${viewName}'.`);
        }
        if (!Array.isArray(VIEW_METADATA[viewName].columns) || VIEW_METADATA[viewName].columns.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define at least one column.`);
        }
        if (typeof VIEW_METADATA[viewName].example !== "string" || VIEW_METADATA[viewName].example.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define an example SQL query.`);
        }
    }
}

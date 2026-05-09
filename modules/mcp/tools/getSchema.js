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
            "Company profile with legal form, workforce, payroll, risk flags, and activity counters.",
        keyColumns: [
            "jarKodas (PK)",
            "pavadinimas",
            "formosPavadinimas",
            "darbuotojai",
            "vidutinisAtlyginimas",
            "melagingisTiekejas",
            "nepatikimasTiekejas",
            "bylosSkaicius",
        ],
        linksTo: ["v_sutartys.pirkejoKodas", "v_sutartys.tiekejoKodas", "v_bylos.jarKodas", "v_person_links.jarKodas", "v_dalyviai.tiekejoKodas"],
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
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for company master data.",
            },
        ],
        example:
            'SELECT "jarKodas", pavadinimas, "formosPavadinimas", darbuotojai, "vidutinisAtlyginimas" FROM v_company WHERE "jarKodas" = \'302556251\'',
    },
    v_sutartys: {
        description:
            "Contract-centric view with buyer/supplier names, CPV category, value, and timing fields.",
        keyColumns: [
            "sutartiesUnikalusId (PK)",
            "pirkimoNumeris (FK→v_pirkimas)",
            "pirkejoKodas (FK→v_company)",
            "tiekejoKodas (FK→v_company)",
            "sudarymoData",
            "verte",
            "tipas",
            "bvpzKodas",
            "kategorija",
        ],
        linksTo: ["v_company.jarKodas", "v_pirkimas.pirkimoId", "v_dalyviai.pirkimoNumeris"],
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
            'SELECT "sutartiesUnikalusId", pirkejas, tiekejas, verte, "bvpzPavadinimas", "sudarymoData" FROM v_sutartys WHERE "sudarymoData" >= CURRENT_DATE - INTERVAL \'1 year\'',
    },
    v_pirkimas: {
        description:
            "Procurement notice view with organizer details, lifecycle status, estimated value, and description.",
        keyColumns: [
            "pirkimoId (PK)",
            "jarKodas (FK→v_company)",
            "pirkimoBudas",
            "statusas",
            "numatomaVerteEUR",
            "paskelbimoData",
        ],
        linksTo: ["v_company.jarKodas", "v_sutartys.pirkimoNumeris", "v_dalyviai.pirkimoNumeris"],
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
            "Person-to-organization relationship view from PINREG declarations, including procurement participation flag.",
        keyColumns: [
            "id (PK)",
            "jarKodas (FK→v_company)",
            "vardas",
            "pavarde",
            "pareigos",
            "dalyvaujaViesuosePirkimuose",
            "rysioPradzia",
        ],
        linksTo: ["v_company.jarKodas"],
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
        relationships: [
            {
                column: "jarKodas",
                references: "jarCsv.jarKodas",
                description: "Join key for organization name enrichment.",
            },
        ],
        example:
            'SELECT vardas, pavarde, "imonesVardas", pareigos, "dalyvaujaViesuosePirkimuose" FROM v_person_links WHERE "jarKodas" = \'302556251\'',
    },
    v_dalyviai: {
        description:
            "Bidder-level ATN-1 procurement participation with ranking, rejection data, and fraud-signal flags (conflict of interest, competition distortion, complaints).",
        keyColumns: [
            "pirkimoNumeris (FK→v_pirkimas)",
            "pirkejoKodas (FK→v_company)",
            "tiekejoKodas (FK→v_company)",
            "eileNumeris",
            "pasiulymoKaina",
            "interesuKonfliktasNustatytas",
            "konkurencijaIskreipiantisAsmuo",
            "pretenzijaPateikta",
        ],
        linksTo: ["v_company.jarKodas", "v_pirkimas.pirkimoId", "v_sutartys.pirkimoNumeris"],
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
            'SELECT "pirkimoNumeris", "tiekejoKodas", tiekejas, "eileNumeris", "pasiulymoKaina", "interesuKonfliktasNustatytas" FROM v_dalyviai WHERE "pirkimoNumeris" = \'1005158\'',
    },
    v_bylos: {
        description:
            "Court case view linking case attributes with participant organizations.",
        keyColumns: [
            "bylosId (PK)",
            "jarKodas (FK→v_company)",
            "bylosNumeris",
            "bylosRusis",
            "bylosData",
            "bylojeKaip",
        ],
        linksTo: ["v_company.jarKodas"],
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
        columnMap.get(row.table_name).push(row);
    }

    const tables = TABLE_LIST.map((identifier) => {
        const rows = columnMap.get(identifier) ?? [];
        return {
            identifier,
            description: buildTableDescription(identifier, rows),
            rowCountEstimate: rowCountMap[identifier] ?? null,
            example: buildTableExample(identifier, rows),
        };
    });

    const views = VIEW_LIST.map((identifier) => {
        const metadata = VIEW_METADATA[identifier];
        return {
            identifier,
            description: metadata.description,
            keyColumns: metadata.keyColumns,
            linksTo: metadata.linksTo,
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
    const coveringView = COVERED_TABLES_BY_VIEWS[tableName];
    if (coveringView) {
        return {
            content: [
                {
                    type: "text",
                    text: `Table '${tableName}' is fully covered by view '${coveringView}'. Call get_schema with '${coveringView}' to see columns, relationships, and an example query.`,
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

    const primaryKeys = new Set(primaryKeyResult.rows.map((row) => row.column_name));
    const columns = colResult.rows.map((r) => `${r.column_name}: ${r.data_type}`);
    const primaryKeyList = Array.from(primaryKeys);

    const relationships = foreignKeyResult.rows.map((row) => ({
        column: row.column_name,
        references: `${row.foreign_table_name}.${row.foreign_column_name}`,
        description: "Foreign key relationship.",
    }));

    const result = {
        identifier: tableName,
        description: buildTableDescription(tableName, colResult.rows),
        columns,
        primaryKeys: primaryKeyList,
        relationships,
        example: buildTableExample(tableName, colResult.rows),
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
        primaryKeys: metadata.primaryKeys,
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

function buildTableDescription(tableName, rows) {
    if (TABLE_DESCRIPTIONS[tableName]) {
        return TABLE_DESCRIPTIONS[tableName];
    }
    return inferDescriptionFromColumns(tableName, rows);
}

function inferDescriptionFromColumns(tableName, rows) {
    if (rows.length === 0) {
        return `Public dataset table '${tableName}'.`;
    }

    const names = rows.map((r) => r.column_name.toLowerCase());
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

    const sampleColumns = rows
        .slice(0, 3)
        .map((r) => `"${r.column_name}"`)
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
        for (const col of VIEW_METADATA[viewName].columns) {
            if (typeof col !== "string" || !col.includes(": ")) {
                throw new Error(`VIEW_METADATA['${viewName}'] column '${col}' must be "name: type" string format.`);
            }
        }
        if (!Array.isArray(VIEW_METADATA[viewName].primaryKeys)) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define primaryKeys array.`);
        }
        if (typeof VIEW_METADATA[viewName].example !== "string" || VIEW_METADATA[viewName].example.length === 0) {
            throw new Error(`VIEW_METADATA['${viewName}'] must define an example SQL query.`);
        }
    }
}

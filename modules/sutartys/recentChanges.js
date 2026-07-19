import { isDeepStrictEqual } from "node:util";
import { postgres } from "../../postgres/postgres.js";

const CANONICAL_FIELD_ORDER = [
    "unikalusId",
    "pavadinimas",
    "sudarymoData",
    "galiojimoData",
    "faktineIvykdimoData",
    "paskelbimoData",
    "redagavimoData",
    "perkanciosiosOrganizacijosKodas",
    "perkanciosiosOrganizacijosPavadinimas",
    "sutartiesNumeris",
    "pirkimoNumeris",
    "numatomaVerte",
    "faktineVerte",
    "pirmoTiekejoKodas",
    "pirmoTiekejoPavadinimas",
    "papildomiTiekejai",
    "tipas",
    "kategorija",
    "bvpzKodas",
    "papildomiBvpzKodai",
    "dokumentai",
    "istrinta",
    "pakeitimas",
];

export const RECENT_CHANGES_SQL = `
WITH recent_changes AS MATERIALIZED (
    SELECT change.*
    FROM public."vpmSutartysChanges" change
    WHERE ($2::bigint IS NULL OR change."unikalusId" = $2)
      AND ($3::integer IS NULL OR change.id < $3)
    ORDER BY change.id DESC
    LIMIT $1
)
SELECT
    recent.id,
    recent."unikalusId",
    recent."pakeitimoData",
    recent.sutartis AS before,
    recent."sutartisHash" AS "beforeHash",
    COALESCE(next_change.sutartis, current_contract.doc) AS after,
    COALESCE(next_change."sutartisHash", current_contract.hash) AS "afterHash"
FROM recent_changes recent
LEFT JOIN LATERAL (
    SELECT later.sutartis, later."sutartisHash"
    FROM public."vpmSutartysChanges" later
    WHERE later."unikalusId" = recent."unikalusId"
      AND later.id > recent.id
    ORDER BY later.id
    LIMIT 1
) next_change ON true
LEFT JOIN LATERAL (
    SELECT
        current.hash,
        jsonb_build_object(
            'unikalusId', current."unikalusId",
            'pavadinimas', current.pavadinimas,
            'sudarymoData', current."sudarymoData",
            'galiojimoData', current."galiojimoData",
            'faktineIvykdimoData', current."faktineIvykdimoData",
            'paskelbimoData', CASE WHEN current."paskelbimoData" IS NULL THEN NULL
                ELSE to_char(current."paskelbimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS') END,
            'redagavimoData', CASE WHEN current."redagavimoData" IS NULL THEN NULL
                ELSE to_char(current."redagavimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS') END,
            'perkanciosiosOrganizacijosKodas', current."perkanciosiosOrganizacijosKodas",
            'perkanciosiosOrganizacijosPavadinimas', buyer_name.pavadinimas,
            'sutartiesNumeris', current."sutartiesNumeris",
            'pirkimoNumeris', current."pirkimoNumeris",
            'numatomaVerte', current."numatomaVerte",
            'faktineVerte', current."faktineVerte",
            'pirmoTiekejoKodas', current."pirmoTiekejoKodas",
            'pirmoTiekejoPavadinimas', supplier_name.pavadinimas,
            'papildomiTiekejai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'kodas', extra."tiekejoKodas",
                        'pavadinimas', extra_name.pavadinimas
                    ) ORDER BY extra.id
                )
                FROM public."vpmSutartysPapildomiTiekejai" extra
                LEFT JOIN public."vpmSutartysSalys" extra_name
                  ON extra_name.id = extra."tiekejoPavadinimoId"
                WHERE extra."unikalusId" = current."unikalusId"
            ), '[]'::jsonb),
            'tipas', type_name.tipas,
            'kategorija', category_name.kategorija,
            'bvpzKodas', current."bvpzKodas",
            'papildomiBvpzKodai', COALESCE((
                SELECT jsonb_agg(extra_bvpz."bvpzKodas" ORDER BY extra_bvpz.id)
                FROM public."vpmSutartysPapildomiBvpzKodai" extra_bvpz
                WHERE extra_bvpz."unikalusId" = current."unikalusId"
            ), '[]'::jsonb),
            'dokumentai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'pavadinimas', file.pavadinimas,
                        'fileId', file."fileId"
                    ) ORDER BY file.id
                )
                FROM public."vpmSutartysFailai" file
                WHERE file."unikalusId" = current."unikalusId"
            ), '[]'::jsonb),
            'istrinta', current.istrinta,
            'pakeitimas', current.pakeitimas
        ) AS doc
    FROM public."vpmSutartys" current
    LEFT JOIN public."vpmSutartysSalys" buyer_name
      ON buyer_name.id = current."perkanciosiosOrganizacijosPavadinimoId"
    LEFT JOIN public."vpmSutartysSalys" supplier_name
      ON supplier_name.id = current."pirmoTiekejoPavadinimoId"
    LEFT JOIN public."vpmSutartysTipai" type_name
      ON type_name.id = current."tipasId"
    LEFT JOIN public."vpmSutartysKategorijos" category_name
      ON category_name.id = current."kategorijaId"
    WHERE current."unikalusId" = recent."unikalusId"
      AND next_change.sutartis IS NULL
) current_contract ON true
ORDER BY recent.id DESC
`;

function positiveInteger(value, option) {
    if (!/^\d+$/.test(value ?? "") || Number(value) < 1) {
        throw new Error(`${option} turi būti teigiamas sveikasis skaičius`);
    }
    return Number(value);
}

export function parseRecentChangesArgs(argv) {
    const options = {
        limit: null,
        id: null,
        batchSize: 20,
        json: false,
        color: null,
        pager: true,
        pageSize: null,
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--color") {
            options.color = true;
        } else if (arg === "--no-color") {
            options.color = false;
        } else if (arg === "--pager") {
            options.pager = true;
        } else if (arg === "--no-pager") {
            options.pager = false;
        } else if (arg === "--page-size") {
            options.pageSize = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--page-size=")) {
            options.pageSize = positiveInteger(arg.slice(12), "--page-size");
        } else if (arg === "--batch-size") {
            options.batchSize = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--batch-size=")) {
            options.batchSize = positiveInteger(arg.slice(13), "--batch-size");
        } else if (arg === "--limit" || arg === "-n") {
            options.limit = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--limit=")) {
            options.limit = positiveInteger(arg.slice(8), "--limit");
        } else if (arg === "--id") {
            options.id = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--id=")) {
            options.id = positiveInteger(arg.slice(5), "--id");
        } else {
            throw new Error(`Nežinomas argumentas: ${arg}`);
        }
    }

    return options;
}

export function diffContractDocuments(before, after) {
    const left = before ?? {};
    const right = after ?? {};
    const known = new Set(CANONICAL_FIELD_ORDER);
    const extraFields = [...new Set([
        ...Object.keys(left),
        ...Object.keys(right),
    ])].filter((field) => !known.has(field)).sort();

    return [...CANONICAL_FIELD_ORDER, ...extraFields].flatMap((field) => {
        if (isDeepStrictEqual(left[field], right[field])) return [];
        if (
            field === "dokumentai"
            && Array.isArray(left[field])
            && Array.isArray(right[field])
        ) {
            return diffDocuments(left[field], right[field]);
        }
        return [{ field, before: left[field], after: right[field] }];
    });
}

function documentKey(document, index) {
    if (document?.fileId !== null && document?.fileId !== undefined) {
        return `fileId=${document.fileId}`;
    }
    return `be-fileId#${index + 1}`;
}

function groupDocuments(documents) {
    const groups = new Map();
    documents.forEach((document, index) => {
        const key = documentKey(document, index);
        const values = groups.get(key) ?? [];
        values.push(document);
        groups.set(key, values);
    });
    return groups;
}

function diffDocuments(before, after) {
    const left = groupDocuments(before);
    const right = groupDocuments(after);
    const keys = [...new Set([...left.keys(), ...right.keys()])];
    const changes = [];

    for (const key of keys) {
        const oldValues = left.get(key) ?? [];
        const newValues = right.get(key) ?? [];
        const count = Math.max(oldValues.length, newValues.length);
        for (let i = 0; i < count; i++) {
            if (isDeepStrictEqual(oldValues[i], newValues[i])) continue;
            const occurrence = count > 1 ? `#${i + 1}` : "";
            changes.push({
                field: `dokumentai[${key}]${occurrence}`,
                before: oldValues[i],
                after: newValues[i],
            });
        }
    }
    return changes;
}

function printableJson(value) {
    return value === undefined ? "(nėra)" : JSON.stringify(value);
}

const ANSI = {
    reset: "\x1b[0m",
    boldCyan: "\x1b[1;36m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
};

function paint(text, color, enabled) {
    return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

export function formatRecentChanges(rows, { color = false } = {}) {
    if (rows.length === 0) return "Sutarčių pakeitimų nerasta.";

    return rows.map((row) => {
        const header = `@@ pakeitimas #${row.id} | sutartis ${row.unikalusId} | ${row.pakeitimoData} @@`;
        if (!row.after) {
            return `${paint(header, "boldCyan", color)}\n${paint(
                "! Dabartinė sutarties būsena nerasta.",
                "yellow",
                color,
            )}`;
        }

        const changes = diffContractDocuments(row.before, row.after);
        const lines = [paint(header, "boldCyan", color)];
        if (row.beforeHash || row.afterHash) {
            lines.push(paint(
                `  hash: ${row.beforeHash ?? "?"} -> ${row.afterHash ?? "?"}`,
                "dim",
                color,
            ));
        }
        if (changes.length === 0) {
            lines.push(paint(
                "  Matomų kanoninio JSON laukų skirtumų nėra.",
                "yellow",
                color,
            ));
        }
        for (const change of changes) {
            lines.push(paint(
                `- ${change.field}: ${printableJson(change.before)}`,
                "red",
                color,
            ));
            lines.push(paint(
                `+ ${change.field}: ${printableJson(change.after)}`,
                "green",
                color,
            ));
        }
        return lines.join("\n");
    }).join("\n\n");
}

export async function fetchRecentChanges(
    { limit = 20, id = null, beforeId = null } = {},
    db = postgres,
) {
    const result = await db.query(RECENT_CHANGES_SQL, [limit, id, beforeId]);
    return result.rows;
}

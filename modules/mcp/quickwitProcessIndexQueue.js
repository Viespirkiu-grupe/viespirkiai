import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import {
    drainIndexQueue,
    runShardedDrain,
} from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { toNumber } from "../../utils/coerce.js";
import { toRfc3339 } from "../../utils/time.js";

/*
MCP įrankių iškvietimų logas → Quickwit.

Schema NĖRA JS konstantoje (kitaip nei juridiniuose): ji gyvena
`modules/mcp/mcpToolCalls.quickwit.yaml` ir į `quickwitLenteles` įdedama ranka.
Todėl čia nėra `ensureConfig()` — tik patikra, kad įrašas egzistuoja.

`mcpToolCalls` skaidymas į žodynines lenteles vyksta dviem dalimis
(`sql/mcpToolCallsSplit1.sql`, `sql/mcpToolCallsSplit2.sql`), tad šaltinio lentelė
pereinamuoju laikotarpiu gali būti dviejų formų. `fetchRows` formą nustato pati
(vieną kartą, pagal `toolNameId` stulpelio buvimą), kad drainer'į būtų galima
paleisti bet kurioje migracijos stadijoje.
*/

const logger = new Logger();
const LENTELE = "mcpToolCalls";
const QUEUE_TABLE = "mcpToolCallsQuickwitIndexQueue";
const BATCH_SIZE = 5_000;

/** @type {boolean|null} */
let normalizedShape = null;
let configChecked = false;

async function ensureConfigRegistered() {
    if (configChecked) return;
    const { rows } = await postgres.query(
        `SELECT 1 FROM public."quickwitLenteles" WHERE "lentele" = $1`,
        [LENTELE],
    );
    if (!rows.length) {
        throw new Error(
            `quickwitLenteles neturi „${LENTELE}" įrašo — įdėkite ` +
            "modules/mcp/mcpToolCalls.quickwit.yaml turinį į stulpelį \"indexConfig\"",
        );
    }
    configChecked = true;
}

/**
 * `true`, kai jau pritaikytas mcpToolCallsSplit1.sql (yra `toolNameId`).
 * @param {import("pg").ClientBase} client
 */
async function isNormalized(client) {
    if (normalizedShape != null) return normalizedShape;
    const { rows } = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = 'toolNameId'`,
        [LENTELE],
    );
    normalizedShape = rows.length > 0;
    return normalizedShape;
}

/** Quickwit `mode: strict` – null reikšmes geriau praleisti, nei siųsti. */
function withoutNulls(object) {
    return Object.fromEntries(
        Object.entries(object).filter(([, value]) => value != null),
    );
}

export function buildDoc(row) {
    return withoutNulls({
        id: toNumber(row.id),
        toolName: row.toolName,
        userAgent: row.userAgent,
        success: row.success,
        durationMs: toNumber(row.durationMs),
        errorMsg: row.errorMsg,
        createdAt: toRfc3339(row.createdAt),
    });
}

export async function processMcpToolCallsIndexQueue(opts = {}) {
    await ensureConfigRegistered();
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: QUEUE_TABLE,
            keyColumn: "mcpToolCallId",
            batchSize: BATCH_SIZE,
            commit: "auto",
            rowId: (row) => row.id,
            buildDoc,
            fetchRows: async (client, ids) => {
                const normalized = await isNormalized(client);
                const { rows } = await client.query(
                    normalized
                        ? `SELECT
                                c."id",
                                t."toolName",
                                u."userAgent",
                                e."errorMsg",
                                c."durationMs",
                                c."success",
                                c."createdAt"
                           FROM public."mcpToolCalls" c
                           LEFT JOIN public."mcpToolCallsToolName" t
                                ON t."id" = c."toolNameId"
                           LEFT JOIN public."mcpToolCallsUserAgent" u
                                ON u."id" = c."userAgentId"
                           LEFT JOIN public."mcpToolCallsErrorMsg" e
                                ON e."id" = c."errorMsgId"
                           WHERE c."id" = ANY($1::bigint[])`
                        : `SELECT
                                c."id",
                                c."toolName",
                                c."userAgent",
                                c."errorMsg",
                                c."durationMs",
                                c."success",
                                c."createdAt"
                           FROM public."mcpToolCalls" c
                           WHERE c."id" = ANY($1::bigint[])`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processMcpToolCallsIndexQueue,
        label: LENTELE,
        logger,
    });
    await postgres.end();
    process.exit(0);
}

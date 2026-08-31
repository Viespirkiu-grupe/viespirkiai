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

Indekso schema gyvena tik DB — `quickwit.lenteles."indexConfig"` stulpelyje
(`quickwit/quickwit.js` iš ten ją ir paima kurdamas shard'ą), tad kode jos
nedubliuojame; čia lieka tik patikra, kad įrašas egzistuoja.

Žurnalo lentelės gyvena `mcp` schemoje (DDL — mcpSchema.sql); `LENTELE` lieka
Quickwit indekso etiketė (`quickwit.lenteles."lentele"`), o ne SQL vardas.
*/

const logger = new Logger();
const LENTELE = "mcpToolCalls";
const QUEUE_SCHEMA = "mcp";
const QUEUE_TABLE = "indexQueue";
const BATCH_SIZE = 5_000;

let configChecked = false;

async function ensureConfigRegistered() {
    if (configChecked) return;
    const { rows } = await postgres.query(
        `SELECT 1 FROM "quickwit"."lenteles" WHERE "lentele" = $1`,
        [LENTELE],
    );
    if (!rows.length) {
        throw new Error(`quickwit.lenteles neturi „${LENTELE}" įrašo`);
    }
    configChecked = true;
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
            queueSchema: QUEUE_SCHEMA,
            keyColumn: "mcpToolCallId",
            batchSize: BATCH_SIZE,
            commit: "auto",
            rowId: (row) => row.id,
            buildDoc,
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT
                            c."id",
                            t."toolName",
                            u."userAgent",
                            e."errorMsg",
                            c."durationMs",
                            c."success",
                            c."createdAt"
                       FROM mcp."toolCalls" c
                       LEFT JOIN mcp."toolName" t ON t."id" = c."toolNameId"
                       LEFT JOIN mcp."userAgent" u ON u."id" = c."userAgentId"
                       LEFT JOIN mcp."errorMsg" e ON e."id" = c."errorMsgId"
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

/**
 * SVARBU (deploy'o tvarka): šis modulis rašo tik žodynų ID, o ne tekstą, tad
 * prieš jį paleidžiant DB jau turi būti pritaikyta
 * `modules/mcp/sql/mcpToolCallsSplit1.sql` (žodyninės lentelės + `*Id` stulpeliai).
 * `modules/mcp/sql/mcpToolCallsSplit2.sql` (tekstinių stulpelių dropas) leidžiamas
 * tik po to, kai ši versija jau veikia.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { postgres } from "../../postgres/postgres.js";

export const requestContext = new AsyncLocalStorage();

let dbReadOnly = false;

/**
 * Žodynų reikšmių riba. `userAgent` ateina iš kliento header'io, tad be ribos
 * piktas klientas galėtų prikišti neribotai unikalių eilučių į žodyną.
 * Realūs duomenys (2026-08) telpa į 111 simbolių.
 */
const MAX_ZODYNO_ILGIS = 256;

/**
 * Vienas sakinys: žodynų upsert'ai CTE viduje + faktų eilutė. Taip hot path'e
 * lieka vienas round-trip ir nereikia proceso cache'o.
 *
 * `ON CONFLICT DO UPDATE` (o ne `DO NOTHING`) — kad `RETURNING` grąžintų `id` ir
 * tada, kai reikšmė jau egzistuoja.
 */
const INSERT_SQL = `
    WITH tn AS (
        INSERT INTO "mcpToolCallsToolName" ("toolName") VALUES ($1)
        ON CONFLICT ("toolName") DO UPDATE SET "toolName" = EXCLUDED."toolName"
        RETURNING id
    ), em AS (
        INSERT INTO "mcpToolCallsErrorMsg" ("errorMsg")
        SELECT $4::text WHERE $4::text IS NOT NULL
        ON CONFLICT ("errorMsg") DO UPDATE SET "errorMsg" = EXCLUDED."errorMsg"
        RETURNING id
    ), ua AS (
        INSERT INTO "mcpToolCallsUserAgent" ("userAgent")
        SELECT $5::text WHERE $5::text IS NOT NULL
        ON CONFLICT ("userAgent") DO UPDATE SET "userAgent" = EXCLUDED."userAgent"
        RETURNING id
    )
    INSERT INTO "mcpToolCalls" ("toolNameId", "durationMs", success, "errorMsgId", "userAgentId")
    SELECT (SELECT id FROM tn), $2, $3, (SELECT id FROM em), (SELECT id FROM ua)`;

function trumpinti(value) {
    if (value == null) return null;
    return String(value).slice(0, MAX_ZODYNO_ILGIS);
}

export async function logToolCall({ toolName, durationMs, success, errorMsg }) {
    if (dbReadOnly) return;
    const ctx = requestContext.getStore();
    try {
        await postgres.query(INSERT_SQL, [
            trumpinti(toolName),
            durationMs,
            success,
            trumpinti(errorMsg),
            trumpinti(ctx?.userAgent),
        ]);
    } catch (err) {
        if (err?.code === "25006") dbReadOnly = true;
    }
}

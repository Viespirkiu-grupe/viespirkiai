import { AsyncLocalStorage } from "node:async_hooks";
import { postgres } from "../../postgres/postgres.js";

export const requestContext = new AsyncLocalStorage();

let dbReadOnly = false;

export async function logToolCall({ toolName, durationMs, success, errorMsg }) {
    if (dbReadOnly) return;
    const ctx = requestContext.getStore();
    try {
        await postgres.query(
            `INSERT INTO "mcpToolCalls" ("toolName", "durationMs", success, "errorMsg", "userAgent")
             VALUES ($1, $2, $3, $4, $5)`,
            [
                toolName,
                durationMs,
                success,
                errorMsg ?? null,
                ctx?.userAgent ?? null,
            ],
        );
    } catch (err) {
        if (err?.code === "25006") dbReadOnly = true;
    }
}

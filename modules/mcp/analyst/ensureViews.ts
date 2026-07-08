import { postgres } from "../../../postgres/postgres.js";
import config from "../../../utils/config.js";
import { log } from "../../../utils/log.js";
import { VIEW_DEFINITIONS, VIEW_NAMES } from "./tempViews.js";

// The analyst role that execute_query connects with runs read-only
// (default_transaction_read_only), so it cannot CREATE the v_* helper views itself.
// Instead we create them once as PERSISTENT views using the writable admin pool and
// GRANT SELECT to the analyst role. Persistent views survive across connections and
// pooling modes, so execute_query never has to create anything at query time.

let ensurePromise: Promise<void> | null = null;

/**
 * Idempotently create the v_* analyst views and grant SELECT to the analyst role.
 * Memoized: the DDL runs once per process. A failure clears the memo so the next
 * caller retries rather than being wedged behind a permanently-rejected promise.
 */
export function ensureAnalystViews(): Promise<void> {
    if (!ensurePromise) {
        ensurePromise = _createViews().catch((err: unknown) => {
            ensurePromise = null;
            throw err;
        });
    }
    return ensurePromise;
}

function _quoteIdent(name: string): string {
    // Role names come from config, not user input, but quote defensively anyway.
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(`Refusing to build GRANT with unsafe role identifier: ${name}`);
    }
    return `"${name}"`;
}

async function _createViews(): Promise<void> {
    const analystRole = config.pgAnalystUser;
    const client = await postgres.connect();
    try {
        for (const [name, definition] of Object.entries(VIEW_DEFINITIONS)) {
            await client.query(definition);
            if (analystRole) {
                await client.query(`GRANT SELECT ON ${name} TO ${_quoteIdent(analystRole)}`);
            }
        }
        log(`analyst views: ensured ${VIEW_NAMES.size} persistent views${analystRole ? `, granted SELECT to ${analystRole}` : ""}`);
    } finally {
        client.release();
    }
}

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

// PostgreSQL klaidos kodas: „insufficient_privilege". Nuo PG15 `public` schema
// nebeturi CREATE teisės rolei PUBLIC, o `CREATE OR REPLACE VIEW` ant kito
// vartotojo view'o reikalauja jo nuosavybės — abu atvejai grąžina 42501.
const INSUFFICIENT_PRIVILEGE = "42501";

function _isInsufficientPrivilege(err: unknown): boolean {
    return (err as { code?: string } | null)?.code === INSUFFICIENT_PRIVILEGE;
}

/**
 * Sukuria (arba atnaujina) vieną view'ą.
 *
 * Jei prisijungusi rolė DDL teisių neturi — pvz. programa jungiasi ribotu vartotoju,
 * o v_* view'us iš anksto sukūrė DBA/admin — DDL praleidžiamas, jei view'as jau
 * egzistuoja ir yra nuskaitomas. Jei view'o nėra, klaida keliaujama toliau: tada
 * teisių trūkumas yra tikra problema, o ne tik neveiksni „refresh" pastanga.
 *
 * @returns `true`, jei DDL buvo įvykdytas (vadinasi, view'as mūsų, galim ir GRANT'inti).
 */
async function _applyDefinition(
    client: { query: (sql: string) => Promise<unknown> },
    name: string,
    definition: string,
): Promise<boolean> {
    try {
        await client.query(definition);
        return true;
    } catch (err: unknown) {
        if (!_isInsufficientPrivilege(err)) throw err;

        try {
            await client.query(`SELECT 1 FROM ${name} LIMIT 0`);
        } catch {
            throw err;
        }

        return false;
    }
}

async function _createViews(): Promise<void> {
    const analystRole = config.pgAnalystUser;
    const client = await postgres.connect();
    try {
        const reused: string[] = [];
        for (const [name, definition] of Object.entries(VIEW_DEFINITIONS)) {
            // Neperkurtiems (svetimiems) view'ams GRANT'as irgi nepavyktų — jų teisės
            // yra tos rolės, kuri juos sukūrė, atsakomybė.
            if (!(await _applyDefinition(client, name, definition))) {
                reused.push(name);
                continue;
            }
            if (analystRole) {
                await client.query(`GRANT SELECT ON ${name} TO ${_quoteIdent(analystRole)}`);
            }
        }
        const appliedCount = VIEW_NAMES.size - reused.length;
        log(
            `analyst views: ensured ${VIEW_NAMES.size} persistent views (${appliedCount} via DDL)` +
                (reused.length ? `, be DDL teisių — naudojam esamus: ${reused.join(", ")}` : "") +
                (analystRole ? `, granted SELECT to ${analystRole}` : ""),
        );
    } finally {
        client.release();
    }
}

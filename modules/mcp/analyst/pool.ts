import configModule from "../../../utils/config.js";
import pkg from "pg";
import { TEMP_VIEWS_SQL } from "./tempViews.js";
import { log } from "../../../utils/log.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = configModule as any;
const { Pool } = pkg;
// NOTE: type parsers (DATE→string, NUMERIC→float) are already set globally by postgres/postgres.js

export const analystPool = new Pool({
    host: config.pgHost,
    port: config.pgAnalystPort,  // CRITICAL: direct PostgreSQL port, NOT PgBouncer
    user: config.pgAnalystUser,
    password: config.pgAnalystPassword,
    database: config.pgDatabase,
    max: config.pgAnalystMaxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10_000,
    statement_cache_size: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// Create the six TEMP views once per physical backend connection.
// TEMP views are session-scoped, so they persist for the lifetime of this backend
// connection and are dropped automatically when it closes.
analystPool.on("connect", (client) => {
    client.query(TEMP_VIEWS_SQL).catch((err: Error) => {
        log(`analyst pool: TEMP view creation failed: ${err.message}`);
    });
});

analystPool.on("error", (err: Error) => {
    log(`analyst pool error: ${err.message}`);
});

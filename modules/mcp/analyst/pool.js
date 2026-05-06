import config from "../../../utils/config.js";
import pkg from "pg";
import { TEMP_VIEWS_SQL } from "./tempViews.js";
import { log } from "../../../utils/log.js";

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
});

// Create the six TEMP views once per physical backend connection.
// TEMP views are session-scoped, so they persist for the lifetime of this backend
// connection and are dropped automatically when it closes.
analystPool.on("connect", (client) => {
    client.query(TEMP_VIEWS_SQL).catch((err) => {
        log(`analyst pool: TEMP view creation failed: ${err.message}`);
    });
});

analystPool.on("error", (err) => {
    log(`analyst pool error: ${err.message}`);
});

import config from "../../../utils/config.js";
import pkg from "pg";
import type { PoolConfig } from "pg";
import { log } from "../../../utils/log.js";

const { Pool } = pkg;
// NOTE: type parsers (DATE→string, NUMERIC→float) are already set globally by postgres/postgres.js

const analystPoolConfig: PoolConfig = {
    host: config.pgHost,
    port: config.pgAnalystPort,
    user: config.pgAnalystUser,
    password: config.pgAnalystPassword,
    database: config.pgDatabase,
    max: config.pgAnalystMaxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10_000,
};

export const analystPool = new Pool(analystPoolConfig);

// The v_* helper views are created as PERSISTENT views by the admin pool
// (see ensureViews.ts) — the read-only analyst role cannot create them itself.
// This pool only runs read-only SELECTs against them.

analystPool.on("error", (err: Error) => {
    log(`analyst pool error: ${err.message}`);
});

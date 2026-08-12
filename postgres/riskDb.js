import config from "../utils/config.js";
import pkg from "pg";

const { Pool, types } = pkg;

// DATE (OID 1082) → string
types.setTypeParser(1082, (str) => str);
// TIMESTAMP WITHOUT TIME ZONE (OID 1114) → string
types.setTypeParser(1114, (str) => str);
// NUMERIC/DECIMAL (OID 1700) → float
types.setTypeParser(1700, (val) => parseFloat(val));

// Connection to the `risk` schema's database. In dev this is a local Docker
// Postgres (docker/risk/compose.yml) — a different physical server than the
// main `postgres` pool in postgres/postgres.js, which stays pointed at the
// real `viespirkiai` database for reading `public` canonical facts.
//
// This split means a Risk Indicator calculation reads `public` through the
// default `postgres` pool (a dev-mode stand-in for the dedicated read-only
// `risk_calc` role risk-service-architecture.md §1.2 specifies — creating
// that role on the shared production database is a follow-up, not part of
// this slice), while the Risk Signals Writer persists through `riskDb`.
export const riskDb = new Pool({
    host: config.riskPgHost,
    port: config.riskPgPort,
    user: config.riskPgUser,
    password: config.riskPgPassword,
    database: config.riskPgDatabase,
    max: config.riskPgMaxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10_000,
});

import config from "../utils/config.js";
import pkg from "pg";
const { Pool, types } = pkg;

// DATE (OID 1082) → string
types.setTypeParser(1082, (str) => str);

// TIMESTAMP WITHOUT TIME ZONE (OID 1114) → string:
types.setTypeParser(1114, (str) => str);

// NUMERIC/DECIMAL (OID 1700) → float
types.setTypeParser(1700, (val) => parseFloat(val));

export const postgres = new Pool({
    host: config.pgHost,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    port: config.pgPort,
    max: 10, // max connections
    idleTimeoutMillis: 30000, // close idle clients after 30s
    connectionTimeoutMillis: 2000, // fail if connection takes longer
});

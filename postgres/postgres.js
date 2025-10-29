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
    max: 50, // max connections
    idleTimeoutMillis: 30000, // close idle clients after 30s
    connectionTimeoutMillis: 2000, // fail if connection takes longer
});

export function parsePgArray(str) {
    const result = [];
    let current = "";
    let inQuotes = false;

    // Strip outer braces
    const s = str.slice(1, -1);

    for (let i = 0; i < s.length; i++) {
        const char = s[i];

        // Handle escaped quote \"
        if (char === "\\" && s[i + 1] === '"') {
            current += '"'; // add literal quote
            i++; // skip the "
            continue;
        }

        // Handle unescaped quote → toggle inQuotes
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        // Comma outside quotes → end of element
        if (char === "," && !inQuotes) {
            result.push(current);
            current = "";
            continue;
        }

        // Everything else, including backslashes and newlines
        current += char;
    }

    result.push(current); // push last element
    return result;
}

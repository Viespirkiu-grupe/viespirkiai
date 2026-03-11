import { postgres } from "../../postgres/postgres.js";

export async function validateOcrApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string")
        return { error: 400, message: "API raktas privalomas." };

    const result = await postgres.query(
        `SELECT * FROM "ocrNuskaitytojai" WHERE "apiKey" = $1 LIMIT 1`,
        [apiKey],
    );
    if (!result.rows.length)
        return { error: 403, message: "Neteisingas API raktas." };

    const user = result.rows[0];
    if (user.rezervacijos > 500)
        return { error: 429, message: "Per daug rezervacijų." };

    return { user };
}

export async function validateReverseProxyApiKey(authHeader) {
    if (!authHeader?.startsWith("Bearer "))
        return { error: 400, message: "API raktas privalomas." };

    const result = await postgres.query(
        `SELECT * FROM "reverseProxies" WHERE "apiKey" = $1 LIMIT 1`,
        [authHeader.slice(7)],
    );
    if (!result.rows.length)
        return { error: 403, message: "Neteisingas API raktas." };

    return { proxy: result.rows[0] };
}

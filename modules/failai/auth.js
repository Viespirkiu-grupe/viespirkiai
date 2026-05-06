import { postgres } from "../../postgres/postgres.js";

export async function validateOcrApiKey(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== "string")
        return { error: 400, message: "API raktas privalomas." };

    const result = await postgres.query(
        `
        SELECT o.*
        FROM public."ocrNuskaitytojai" o
        JOIN public."apiRaktai" a ON a.id = o."apiRaktasId"
        WHERE a."apiKey" = $1
        LIMIT 1
        `,
        [apiKey],
    );

    if (!result.rows.length)
        return { error: 403, message: "Neteisingas API raktas." };

    const user = result.rows[0];

    if (user.rezervacijos > 5_000 && !options.skipRezervacijosCheck)
        return { error: 429, message: "Per daug rezervacijų." };

    return { user };
}

export async function validateReverseProxyApiKey(authHeader) {
    if (!authHeader?.startsWith("Bearer "))
        return { error: 400, message: "API raktas privalomas." };

    const apiKey = authHeader.slice(7);

    const result = await postgres.query(
        `
        SELECT r.*
        FROM public."reverseProxies" r
        JOIN public."apiRaktai" a ON a.id = r."apiRaktasId"
        WHERE a."apiKey" = $1
        LIMIT 1
        `,
        [apiKey],
    );

    if (!result.rows.length)
        return { error: 403, message: "Neteisingas API raktas." };

    return { proxy: result.rows[0] };
}
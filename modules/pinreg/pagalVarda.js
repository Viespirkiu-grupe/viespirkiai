import { postgres } from "../../postgres/postgres.js";

export async function gautiPinregDeklaracijasPagalVardaPavarde(
    fullName,
    options = {},
) {
    const limit = options.limit ? Number(options.limit) : null;
    const flat = Boolean(options.flat);

    if (!fullName || typeof fullName !== "string") {
        throw new Error("Name must be a non-empty string");
    }

    const params = [fullName.trim()];

    const declarationsQuery = await postgres.query(
        `SELECT uuid, json, "pateikimoData"
         FROM pinreg."deklaracijos"
         WHERE lower(asmuo) = lower($1)
            OR lower(sutuoktinis) = lower($1)
         ORDER BY "pateikimoData" DESC
         ${limit ? "LIMIT $2" : ""}`,
        limit ? [...params, limit] : params,
    );

    const declarations = declarationsQuery.rows
        .map((row) => ({
            uuid: row.uuid,
            pateikimoData: row.pateikimoData,
            ...(row.json || {}),
        }))
        .filter((row) => row && typeof row === "object");

    if (flat) {
        return {
            rows: declarations,
            count: declarations.length,
            limit,
        };
    }

    const darbovietes = declarations.flatMap((d) =>
        Array.isArray(d.darbovietes) ? d.darbovietes : [],
    );
    const rysiaiSuJa = declarations.flatMap((d) =>
        Array.isArray(d.rysiaiSuJa) ? d.rysiaiSuJa : [],
    );
    const sutuoktinioDarbovietes = declarations.flatMap((d) =>
        Array.isArray(d.sutuoktinioDarbovietes) ? d.sutuoktinioDarbovietes : [],
    );

    const counts = {
        darbovietes: darbovietes.length,
        rysiaiSuJa: rysiaiSuJa.length,
        sutuoktiniuDarbovietes: sutuoktinioDarbovietes.length,
    };

    return {
        darbovietes,
        rysiaiSuJa,
        sutuoktinioDarbovietes,
        counts: {
            darbovietes: counts.darbovietes,
            rysiaiSuJa: counts.rysiaiSuJa,
            sutuoktiniuDarbovietes: counts.sutuoktiniuDarbovietes,
        },
        total:
            counts.darbovietes +
            counts.rysiaiSuJa +
            counts.sutuoktiniuDarbovietes,
        limit,
    };
}

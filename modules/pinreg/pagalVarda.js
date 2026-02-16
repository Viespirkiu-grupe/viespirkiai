import { postgres } from "../../postgres/postgres.js";

export async function gautiPinregDeklaracijasPagalVardaPavarde(
    fullName,
    options = {},
) {
    const limit = options.limit ? Number(options.limit) : null;

    if (!fullName || typeof fullName !== "string") {
        throw new Error("Name must be a non-empty string");
    }

    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const variants = [];

    if (parts.length >= 2) {
        const [a, b] = parts;
        variants.push({ vardas: a, pavarde: b });
        variants.push({ vardas: b, pavarde: a });
    } else {
        variants.push({ vardas: parts[0], pavarde: parts[0] });
    }

    const nameWhere = variants
        .map(
            (_, i) =>
                `(lower(vardas) = lower($${i * 2 + 1}) AND lower(pavarde) = lower($${i * 2 + 2}))`,
        )
        .join(" OR ");

    const params = variants.flatMap((v) => [v.vardas, v.pavarde]);

    const [
        darbovietesQuery,
        darbovietesCountsQuery,
        rysiaiQuery,
        rysiaiCountsQuery,
        sutuoktiniuQuery,
        sutuoktiniuCountsQuery,
    ] = await Promise.all([
        postgres.query(
            `SELECT * FROM public."pinregDarbovietes"
             WHERE ${nameWhere}
             ORDER BY "pateikimoData" DESC
             ${limit ? "LIMIT $" + (params.length + 1) : ""}`,
            limit ? [...params, limit] : params,
        ),
        postgres.query(
            `SELECT COUNT(*)::int AS count FROM public."pinregDarbovietes"
             WHERE ${nameWhere}`,
            params,
        ),
        postgres.query(
            `SELECT * FROM public."pinregRysiaiSuJa"
             WHERE ${nameWhere}
             ORDER BY "pateikimoData" DESC
             ${limit ? "LIMIT $" + (params.length + 1) : ""}`,
            limit ? [...params, limit] : params,
        ),
        postgres.query(
            `SELECT COUNT(*)::int AS count FROM public."pinregRysiaiSuJa"
             WHERE ${nameWhere}`,
            params,
        ),
        postgres.query(
            `SELECT * FROM public."pinregSutuoktiniuDarbovietes"
             WHERE (
                 ${variants
                     .map(
                         (_, i) =>
                             `(lower("deklaruojancioVardas") = lower($${i * 2 + 1})
                               AND lower("deklaruojancioPavarde") = lower($${i * 2 + 2}))`,
                     )
                     .join(" OR ")}
             )
             ORDER BY "pateikimoData" DESC
             ${limit ? "LIMIT $" + (params.length + 1) : ""}`,
            limit ? [...params, limit] : params,
        ),
        postgres.query(
            `SELECT COUNT(*)::int AS count FROM public."pinregSutuoktiniuDarbovietes"
             WHERE (
                 ${variants
                     .map(
                         (_, i) =>
                             `(lower("deklaruojancioVardas") = lower($${i * 2 + 1})
                               AND lower("deklaruojancioPavarde") = lower($${i * 2 + 2}))`,
                     )
                     .join(" OR ")}
             )`,
            params,
        ),
    ]);

    return {
        darbovietes: darbovietesQuery.rows,
        rysiaiSuJa: rysiaiQuery.rows,
        sutuoktinioDarbovietes: sutuoktiniuQuery.rows,
        counts: {
            darbovietes: darbovietesCountsQuery.rows[0]?.count ?? 0,
            rysiaiSuJa: rysiaiCountsQuery.rows[0]?.count ?? 0,
            sutuoktiniuDarbovietes: sutuoktiniuCountsQuery.rows[0]?.count ?? 0,
        },
        total:
            (darbovietesCountsQuery.rows[0]?.count ?? 0) +
            (rysiaiCountsQuery.rows[0]?.count ?? 0) +
            (sutuoktiniuCountsQuery.rows[0]?.count ?? 0),
        limit,
    };
}

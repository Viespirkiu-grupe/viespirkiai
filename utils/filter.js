/**
 * Builds a Typesense filter from the provided query object.
 * @param {Object} query
 * @returns {Object}
 */
export function buildTypesenseFilter(query) {
    const filters = [];
    const values = {};
    const queryParams = [];
    let usedHiddenFields = false;

    const config = [
        {
            key: "perkanciosiosOrganizacijosKodas",
            apply: (val) => {
                filters.push(`perkanciosiosOrganizacijosKodas:=${val}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "tiekejoKodas",
            apply: (val) => {
                // filter either main code or any in additional codes array
                filters.push(
                    `(tiekejoKodas:=${val} || papildomiTiekejaiKodai:=[${val}])`,
                );
                usedHiddenFields = true;
            },
        },
        {
            key: "sutartiesNumeris",
            apply: (val) => {
                filters.push(`sutartiesNumeris:=${val}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "sudarymoDataNuo",
            apply: (val) => {
                const ts = Math.floor(new Date(val).getTime() / 1000);
                filters.push(`sudarymoData:>=${ts}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "sudarymoDataIki",
            apply: (val) => {
                const ts = Math.floor(new Date(val).getTime() / 1000);
                filters.push(`sudarymoData:<=${ts}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "verteNuo",
            apply: (val) => {
                filters.push(`verte:>=${parseFloat(val.replace(",", "."))}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "verteIki",
            apply: (val) => {
                filters.push(`verte:<=${parseFloat(val.replace(",", "."))}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "sutartiesUnikalusID",
            apply: (val) => {
                const n = Number(val);
                if (Number.isInteger(n)) {
                    filters.push(`sutartiesUnikalusID:=${n}`);
                    usedHiddenFields = true;
                }
            },
        },
        {
            key: "tipas",
            apply: (val) => {
                filters.push(`tipas:=${val}`);
                usedHiddenFields = true;
            },
        },
        {
            key: "tikSuDokumentais",
            apply: () => {
                filters.push(`dokumentuKiekis:>0`);
                usedHiddenFields = true;
            },
            isBoolean: true,
        },
        {
            key: "ignoruotiSp",
            apply: () => {
                // tipas shouldn't be "SP"
                filters.push(`tipas:!=SP`);
                usedHiddenFields = true;
            },
            isBoolean: true,
        },
        {
            key: "pirkimoNumeris",
            apply: (val) => {
                filters.push(`pirkimoNumeris:=${val}`);
                usedHiddenFields = true;
            },
        },
    ];

    for (const { key, apply, isBoolean } of config) {
        if (isBoolean && query[key] !== undefined) {
            apply();
            values[key] = true;
            queryParams.push(`${key}=true`);
        } else if (query[key]?.length > 0) {
            apply(query[key]);
            values[key] = query[key];
            queryParams.push(`${key}=${encodeURIComponent(query[key])}`);
        }
    }

    values.search = query.search || "";

    return {
        filterBy: filters.join(" && "),
        values,
        queryParams: queryParams.length ? "&" + queryParams.join("&") : "",
        usedHiddenFields,
    };
}

/**
 * Builds a PostgreSQL filter from the provided query object.
 * @param {Object} query
 * @returns {Object}
 */
export function buildPostgresFilter(query, limit, page = 1) {
    const whereClauses = [];
    const params = [];
    const values = {};
    const queryParams = [];
    let usedHiddenFields = false;
    let visiIrasai = true;

    const addParam = (key, val) => {
        params.push(val);
        return `$${params.length}`;
    };

    const config = [
        {
            key: "perkanciosiosOrganizacijosKodas",
            apply: (val) => {
                whereClauses.push(
                    `"perkanciosiosOrganizacijosKodas" = ${addParam("perkanciosiosOrganizacijosKodas", val)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "pirkimoNumeris",
            apply: (val) => {
                whereClauses.push(
                    `"pirkimoNumeris" = ${addParam("pirkimoNumeris", val)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "tiekejoKodas",
            apply: (val) => {
                whereClauses.push(
                    `("tiekejoKodas" = ${addParam("tiekejoKodas", val)} OR "papildomiTiekejaiKodai" @> ARRAY[${addParam("tiekejoKodas", val)}])`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "sutartiesNumeris",
            apply: (val) => {
                whereClauses.push(
                    `"sutartiesNumeris" = ${addParam("sutartiesNumeris", val)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "sudarymoDataNuo",
            apply: (val) => {
                whereClauses.push(
                    `"sudarymoData" >= ${addParam("sudarymoDataNuo", val)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "sudarymoDataIki",
            apply: (val) => {
                whereClauses.push(
                    `"sudarymoData" <= ${addParam("sudarymoDataIki", val)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "verteNuo",
            apply: (val) => {
                const num = parseFloat(val.replace(",", "."));
                whereClauses.push(`"verte" >= ${addParam("verteNuo", num)}`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "verteIki",
            apply: (val) => {
                const num = parseFloat(val.replace(",", "."));
                whereClauses.push(`"verte" <= ${addParam("verteIki", num)}`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "sutartiesUnikalusID",
            apply: (val) => {
                const num = Number(val);
                if (!Number.isInteger(num)) return;

                whereClauses.push(
                    `"sutartiesUnikalusId" = ${addParam("sutartiesUnikalusId", num)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "tipas",
            apply: (val) => {
                whereClauses.push(`"tipas" = ${addParam("tipas", val)}`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "tikSuDokumentais",
            apply: () => {
                whereClauses.push(`"dokumentuKiekis" > 0`);
                values["tikSuDokumentais"] = true;
                usedHiddenFields = true;
                visiIrasai = false;
            },
            isBoolean: true,
        },
        {
            key: "bvpzPrefiksas",
            apply: (val) => {
                const prefixes = val
                    .split(" ")
                    .map((p) => p.trim())
                    .filter(Boolean);
                if (prefixes.length > 0) {
                    const ors = prefixes.map((prefix, i) => {
                        const start = prefix;
                        const end = String(parseInt(prefix, 10) + 1).padStart(
                            prefix.length,
                            "0",
                        );
                        const startParam = addParam(
                            `bvpzPrefiksasStart${i}`,
                            start,
                        );
                        const endParam = addParam(`bvpzPrefiksasEnd${i}`, end);
                        return `("bvpzKodas" >= ${startParam} AND "bvpzKodas" < ${endParam})`;
                    });
                    whereClauses.push(`(${ors.join(" OR ")})`);
                    usedHiddenFields = true;
                    visiIrasai = false;
                }
            },
        },
        {
            key: "bvpzPrefiksasKitas",
            apply: (val) => {
                const prefixes = val
                    .split(" ")
                    .map((p) => p.trim())
                    .filter(Boolean);
                if (prefixes.length > 0) {
                    const ors = prefixes.map((prefix, i) => {
                        const start = prefix;
                        const end = String(parseInt(prefix, 10) + 1).padStart(
                            prefix.length,
                            "0",
                        );
                        const startParam = addParam(
                            `bvpzPrefiksasKitasStart${i}`,
                            start,
                        );
                        const endParam = addParam(
                            `bvpzPrefiksasKitasEnd${i}`,
                            end,
                        );
                        return `("bvpzKodas" >= ${startParam} AND "bvpzKodas" < ${endParam})`;
                    });
                    whereClauses.push(`(${ors.join(" OR ")})`);
                    usedHiddenFields = true;
                    visiIrasai = false;
                }
            },
        },
        {
            key: "search",
            apply: (val) => {
                const term = val.replace(/'/g, "''"); // escape single quotes
                const param = addParam("search", term);
                whereClauses.push(
                    `"search_tsv" @@ plainto_tsquery('simple', ${param})`,
                );
                visiIrasai = false;
            },
        },
        {
            key: "ignoruotiSp",
            apply: () => {
                // tipas shouldn't be "SP"
                whereClauses.push(`"tipas" != 'SP'`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
            isBoolean: true,
        },
    ];

    whereClauses.push(`NOT "istrinta"`);

    for (const { key, apply, isBoolean } of config) {
        if (isBoolean && query[key] !== undefined) {
            apply();
            queryParams.push(`${key}=true`);
            values[key] = "true";
        } else if (query[key]?.length > 0) {
            apply(query[key]);
            values[key] = query[key];
            queryParams.push(`${key}=${encodeURIComponent(query[key])}`);
        }
    }

    values.search = query.search || "";

    const where = whereClauses.length
        ? "WHERE " + whereClauses.join(" AND ")
        : "";

    const limitParam = addParam("limit", limit);
    const offsetVal = Math.max((page - 1) * limit, 0);
    const offsetParam = addParam("offset", offsetVal);

    return {
        sql: `SELECT * FROM sutartys ${where} ORDER BY "paskutinioRedagavimoData" DESC LIMIT ${limitParam} OFFSET ${offsetParam};`,
        sqlCount: `SELECT COUNT(*) FROM sutartys ${where};`,
        params,
        values,
        queryParams: queryParams.length ? "&" + queryParams.join("&") : "",
        usedHiddenFields,
        visiIrasai,
    };
}

/**
 * Builds a PostgreSQL file search filter from the provided query object.
 * Supports full-text search with phrase ("...") and plain text queries.
 * @param {Object} query
 * @param {number} limit
 * @param {number} page
 * @returns {Object}
 */
export function buildPostgresFailaiSearchFilter(query, limit, page = 1) {
    const whereClauses = [];
    const params = [];
    const values = {};
    const queryParams = [];
    let usedHiddenFields = false;
    let visiIrasai = true;

    const addParam = (key, val) => {
        params.push(val);
        return `$${params.length}`;
    };

    // Basic filter config
    const config = [
        {
            key: "extension",
            apply: (val) => {
                whereClauses.push(
                    `LOWER("extension") = LOWER(${addParam("extension", val)})`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "md5",
            apply: (val) => {
                whereClauses.push(`"md5" = ${addParam("md5", val)}`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "puslapiaiMin",
            apply: (val) => {
                const num = parseInt(val, 10);
                whereClauses.push(
                    `"puslapiuSkaicius" >= ${addParam("puslapiaiMin", num)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "puslapiaiMax",
            apply: (val) => {
                const num = parseInt(val, 10);
                whereClauses.push(
                    `"puslapiuSkaicius" <= ${addParam("puslapiaiMax", num)}`,
                );
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "saltinis",
            apply: (val) => {
                if (val == "sutartys") {
                    // NULL also counts as "sutartys"
                    whereClauses.push(
                        `("saltinis" = ${addParam("saltinis", val)} OR "saltinis" IS NULL)`,
                    );
                    usedHiddenFields = true;
                    visiIrasai = false;
                    return;
                }

                whereClauses.push(`"saltinis" = ${addParam("saltinis", val)}`);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "telefonas",
            apply: (val) => {
                whereClauses.push(`
                  EXISTS (
                    SELECT 1 FROM "failaiTelefonai" ft
                    WHERE ft.id = f.id AND ft.telefonas = ${addParam("telefonas", val)}
                  )
                `);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "email",
            apply: (val) => {
                whereClauses.push(`
                  EXISTS (
                    SELECT 1 FROM "failaiEmails" fe
                    WHERE fe.id = f.id AND fe.email = ${addParam("email", val)}
                  )
                `);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "domain",
            apply: (val) => {
                whereClauses.push(`
                  EXISTS (
                    SELECT 1 FROM "failaiDomains" fd
                    WHERE fd.id = f.id AND fd.domain = ${addParam("domain", val)}
                  )
                `);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "iban",
            apply: (val) => {
                whereClauses.push(`
                  EXISTS (
                    SELECT 1 FROM "failaiIban" fi
                    WHERE fi.id = f.id AND fi.iban = ${addParam("iban", val)}
                  )
                `);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
        {
            key: "jarKodas",
            apply: (val) => {
                whereClauses.push(`
                  EXISTS (
                    SELECT 1 FROM "failaiJarKodai" fj
                    WHERE fj.id = f.id AND fj.jarKodas = ${addParam("jarKodas", val)}
                  )
                `);
                usedHiddenFields = true;
                visiIrasai = false;
            },
        },
    ];

    // Apply non-search filters
    for (const { key, apply, isBoolean } of config) {
        if (isBoolean && query[key] !== undefined) {
            apply();
            queryParams.push(`${key}=true`);
            values[key] = "true";
        } else if (query[key]?.length > 0) {
            apply(query[key]);
            values[key] = query[key];
            queryParams.push(`${key}=${encodeURIComponent(query[key])}`);
        }
    }

    if (query.location && query.locationRadius != null) {
        const [latStr, lonStr] = query.location.split(","); // expect "lat,lon"
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        const radius = parseFloat(query.locationRadius);

        if (!isNaN(lat) && !isNaN(lon) && !isNaN(radius)) {
            whereClauses.push(`
              location IS NOT NULL AND
              ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint(${addParam("lon", lon)}, ${addParam("lat", lat)}), 4326)::geography,
                ${addParam("radius", radius)}
              )
            `);
            usedHiddenFields = true;
            visiIrasai = false;
        }
    }

    // Full-text search logic
    let tsQueryFunc = null;
    let cleanSearch = null;

    if (query.search?.length > 0) {
        const quoteMatch = query.search.match(/^"(.*)"$/);
        tsQueryFunc = quoteMatch ? "phraseto_tsquery" : "plainto_tsquery";
        cleanSearch = quoteMatch ? quoteMatch[1] : query.search;

        whereClauses.push(
            `f.search_index @@ ${tsQueryFunc}('simple', ${addParam("search", cleanSearch)})`,
        );
        visiIrasai = false;
    }

    values.search = query.search || "";

    //WHERE clause
    let where = whereClauses.length
        ? "WHERE " + whereClauses.join(" AND ")
        : "";

    if (query.search?.length > 0) {
        where = whereClauses.length
            ? "WHERE f.nuskaitytas >= 0 AND " + whereClauses.join(" AND ")
            : "WHERE f.nuskaitytas >= 0";
    }

    // Pagination
    const limitParam = addParam("limit", limit);
    const offsetVal = Math.max((page - 1) * limit, 0);
    const offsetParam = addParam("offset", offsetVal);

    queryParams.push(`search=${encodeURIComponent(query.search || "")}`);

    return {
        sql: `
            SELECT
                f.*,
                CASE
                    WHEN fp.salinti = true THEN '451 – Pašalinta'
                    ELSE f.pavadinimas
                END AS pavadinimas,
                CASE
                    WHEN fp.salinti = true THEN '451 – Pašalinta'
                    ELSE f.tekstas
                END AS tekstas,
                CASE
                    WHEN fp.salinti = true THEN '{}'::jsonb
                    ELSE f.metaduomenys
                END AS metaduomenys
            FROM failai f
            LEFT JOIN "failuPasalinimai" fp
                   ON fp."dokId" = f."dokId"
                  AND fp."fileId" = f."fileId"
                  AND fp.salinti = true
            ${where}
            LIMIT ${limitParam} OFFSET ${offsetParam};
        `,
        sqlCount: `
            SELECT COUNT(*)
            FROM failai f
            ${where};
        `,
        params,
        values,
        queryParams: queryParams.length ? "&" + queryParams.join("&") : "",
        usedHiddenFields,
        visiIrasai,
    };
}

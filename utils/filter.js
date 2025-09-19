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
                filters.push(`tiekejoKodas:=${val}`);
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
                filters.push(`sutartiesUnikalusID:=${parseInt(val, 10)}`);
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
            key: "tiekejoKodas",
            apply: (val) => {
                whereClauses.push(
                    `"tiekejoKodas" = ${addParam("tiekejoKodas", val)}`,
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
                const num = parseInt(val, 10);
                whereClauses.push(
                    `"sutartiesUnikalusId" = ${addParam("sutartiesUnikalusId", num)}`,
                );
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
                const term = `%${val}%`;
                const param = addParam("search", term);
                whereClauses.push(
                    `("pavadinimas" ILIKE ${param} OR "aprasymas" ILIKE ${param})`,
                );
                visiIrasai = false;
            },
        },
    ];

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

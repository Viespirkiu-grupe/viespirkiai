import { postgres } from "../../postgres/postgres.js";

export async function rastiDomenusPagalJarKoda(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit == "max") {
        limit = 10_000_000;
    }

    let [domenaiRes, domenaiCountRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM domenai WHERE "savininkoKodas" = $1 ORDER BY created ASC LIMIT $2;`,
            [jarKodas, limit],
        ),
        postgres.query(
            `SELECT "domainCount" FROM "domenaiCounts" WHERE "savininkoKodas" = $1;`,
            [jarKodas],
        ),
    ]);

    let domenai = [];
    for (let row of domenaiRes.rows) {
        domenai.push({
            domain: row.domain,
            domregData: row.domregData,
            savininkas: row.savininkas,
            savininkoKodas: row.savininkoKodas,
            savininkasAdresas: row.savininkasAdresas,
            technikas: row.technikas,
            technikasAdresas: row.technikasAdresas,
            status: row.status,
            created: row.created,
            expired: row.expired,
            updated: row.updated,
            domregNs: row.domregNs,
        });
    }
    let domenaiCount = parseInt(domenaiCountRes.rows[0].count);

    return {
        limit,
        count: domenaiCount,
        rows: domenai,
    };
}

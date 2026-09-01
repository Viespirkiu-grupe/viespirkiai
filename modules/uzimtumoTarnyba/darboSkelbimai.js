import { postgres } from "../../postgres/postgres.js";

/**
 * Įmonės darbo skelbimai iš `uzt` schemos. Bendras skaičius imamas iš
 * uzt.darbdaviai."skelbimuSkaicius" (trigerio palaikomas), o ne count(*) –
 * lentelėje daugiau nei 3 mln. eilučių.
 *
 * @param {string} jarKodas
 * @param {{limit?: number | string}} [options]
 */
export async function gautiDarboSkelbimus(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    // Run count and fetch in parallel
    const [darboSkelbimaiCountResult, darboSkelbimaiRows] = await Promise.all([
        postgres.query(
            `SELECT "skelbimuSkaicius" AS total
               FROM "uzt"."darbdaviai"
               WHERE "jarKodas" = $1;`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT dv."darboVietosId", dv."ikelimoData", dv."galiojaNuo", dv."galiojaIki",
                    dv."darboAprasymas", dv."darboVietuSkaicius", dv."darboVietosAdresas",
                    dv."prelimDarboUzmokestis", dv."vidDarboUzmokestis", dv."maksDarboUzmokestis",
                    dv."arAktualiSiandien",
                    p."pavadinimas"   AS "profesija",
                    sav."pavadinimas" AS "savivaldybe",
                    val."pavadinimas" AS "valiuta"
           FROM "uzt"."darboVietos" dv
           LEFT JOIN "uzt"."profesijos"   p   ON p.id   = dv."profesijosId"
           LEFT JOIN "uzt"."savivaldybes" sav ON sav.id = dv."savivaldybesId"
           LEFT JOIN "uzt"."valiutos"     val ON val.id = dv."valiutosId"
           WHERE dv."jarKodas" = $1
           ORDER BY dv."ikelimoData" DESC
           ${useLimit ? "LIMIT $2" : ""};`,
            useLimit ? [jarKodas, limit] : [jarKodas],
        ),
    ]);

    return {
        limit: useLimit ? limit : "max",
        rows: darboSkelbimaiCountResult.rows[0]?.total ?? 0,
        skelbimai: darboSkelbimaiRows.rows,
    };
}

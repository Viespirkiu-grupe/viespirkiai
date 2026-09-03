import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

/**
 * Juridinio asmens 2014–2020 m. ES investicijų paraiškos ir projektai.
 *
 * @param {string|number} jarKodas
 * @param {{limit?: number|"max"}} [options]
 * @returns {Promise<{limit: number, count: number, rows: object[]}>}
 */
export async function getEsInvesticijosByJar(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit == "max") {
        limit = 10_000_000;
    }

    const esInvesticijosRes = await postgres.query(
        `SELECT *, ${WINDOW_COUNT_SQL}
         FROM "2014esInvesticijos"."projektaiPilni"
         WHERE "pareiskejoJarKodas" = $1
         ORDER BY "sutartiesData" DESC NULLS LAST, "id" DESC
         LIMIT $2;`,
        [jarKodas, limit],
    );
    const { rows, viso } = splitWindowCount(esInvesticijosRes.rows);

    return {
        limit,
        count: viso,
        rows,
    };
}

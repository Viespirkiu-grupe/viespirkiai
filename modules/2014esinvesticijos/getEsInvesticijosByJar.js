import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

export async function getEsInvesticijosByJar(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit == "max") {
        limit = 10_000_000;
    }

    const esInvesticijosRes = await postgres.query(
        `SELECT *, ${WINDOW_COUNT_SQL} FROM "2014Esinvesticijos" WHERE "pareiskejasJarKodas" = $1 ORDER BY "pabaigosData" DESC LIMIT $2;`,
        [jarKodas, limit],
    );
    const { rows, viso } = splitWindowCount(esInvesticijosRes.rows);

    return {
        limit,
        count: viso,
        rows,
    };
}

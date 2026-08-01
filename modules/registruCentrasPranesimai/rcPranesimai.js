import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

export async function gautiRcPranesimusPagalJarKoda(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    const rcPranesimaiResult = await postgres.query(
        `SELECT *, ${WINDOW_COUNT_SQL}
            FROM "rcInformaciniaiLeidiniaiPranesimai"
            WHERE "jarKodas" = $1
            ORDER BY "leidinioData" DESC
           ${useLimit ? "LIMIT $2" : ""};`,
        useLimit ? [jarKodas, limit] : [jarKodas],
    );
    const { rows: pranesimai, viso } = splitWindowCount(
        rcPranesimaiResult.rows,
    );

    return {
        limit: useLimit ? limit : "max",
        rows: viso,
        pranesimai,
    };
}

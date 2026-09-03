import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

/** Rikiavimo raktai iš UI → SQL išraiškos (baltasis sąrašas). */
const RIKIAVIMAI = {
    data: '"sutartiesData"',
    pavadinimas: '"pavadinimas"',
    priemone: '"priemonesKodas"',
    finansavimas: '"finansavimas"',
    ismoketas: '"ismoketasFinansavimas"',
    busena: '"busena"',
};

const MAX_LIMIT = 500;

/**
 * Juridinio asmens 2014–2020 m. ES investicijų paraiškos ir projektai.
 *
 * Rikiuojama ir puslapiuojama duomenų bazėje – įrašų būna tūkstančiai
 * (didžiausias pareiškėjas turi ~3000), tad visų iš karto nesiunčiame.
 *
 * @param {string|number} jarKodas
 * @param {{limit?: number|"max", offset?: number, sort?: string, kryptis?: string}} [options]
 * @returns {Promise<{limit: number, offset: number, sort: string, kryptis: string, count: number, rows: object[]}>}
 */
export async function getEsInvesticijosByJar(jarKodas, options = {}) {
    const limit = options.limit === "max" || options.limit == null
        ? MAX_LIMIT
        : Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || MAX_LIMIT));
    const offset = Math.max(0, Number(options.offset) || 0);
    const sort = Object.hasOwn(RIKIAVIMAI, options.sort) ? options.sort : "data";
    const kryptis = options.kryptis === "asc" ? "asc" : "desc";
    // Datos ir sumos gali būti NULL – tokios eilutės visada keliauja į galą.
    const eile = `${RIKIAVIMAI[sort]} ${kryptis} NULLS LAST, "id" DESC`;

    const esInvesticijosRes = await postgres.query(
        `SELECT *, ${WINDOW_COUNT_SQL}
         FROM "2014esInvesticijos"."projektaiPilni"
         WHERE "pareiskejoJarKodas" = $1
         ORDER BY ${eile}
         LIMIT $2 OFFSET $3;`,
        [jarKodas, limit, offset],
    );
    const { rows, viso } = splitWindowCount(esInvesticijosRes.rows);

    return {
        limit,
        offset,
        sort,
        kryptis,
        count: viso,
        rows,
    };
}

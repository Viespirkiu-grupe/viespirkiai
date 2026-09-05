import { postgres } from "../../postgres/postgres.js";
import {
    VPM_SUTARTIS_ROW_SELECT,
    VPM_SUTARTIS_ROW_FROM,
} from "./vpmSutartisRow.js";
import { drainIndexQueue, runShardedDrain } from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { foldLithuanian } from "../../utils/text.js";
import { compact, toNumber } from "../../utils/coerce.js";
import { toRfc3339 } from "../../utils/time.js";
import { pathToFileURL } from "node:url";

const logger = new Logger();

const BATCH_SIZE = 2500;
const LENTELE = "sutartys";

export { toRfc3339 };

/**
 * Nusausina vieną `vpmSutartys."indexQueue"` porciją į Quickwit.
 * Karkasas (tranzakcija, dedup, shard'inimas) — `quickwit/indexQueueDrainer.js`.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} `true`, kai buvo darbo.
 */
export async function processSutartysIndexQueue(opts = {}) {
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "indexQueue",
            queueSchema: "vpmSutartys",
            keyColumn: "unikalusId",
            batchSize: BATCH_SIZE,
            commit: "auto",
            rowId: (row) => row.sutartiesUnikalusId,
            buildDoc,
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT ${VPM_SUTARTIS_ROW_SELECT}
                     FROM ${VPM_SUTARTIS_ROW_FROM}
                     WHERE s."unikalusId" = ANY($1::bigint[])
                       AND s.istrinta = false`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

function buildDoc(row) {
    const tiekejai = compact([row.tiekejas, ...(row.papildomiTiekejai ?? [])]);
    const tiekejaiKodai = compact([row.tiekejoKodas, ...(row.papildomiTiekejaiKodai ?? [])]);
    const bvpzKodai = compact([row.bvpzKodas, ...(row.papildomiBvpzKodai ?? [])]);
    const bvpzPavadinimai = compact([row.bvpzPavadinimas, ...(row.papildomiBvpzPavadinimai ?? [])]);
    const tekstas = foldLithuanian(compact([
        row.pavadinimas,
        row.sutartiesNumeris,
        row.pirkimoNumeris,
        row.perkanciojiOrganizacija,
        row.perkanciosiosOrganizacijosKodas,
        ...tiekejai,
        ...tiekejaiKodai,
        ...bvpzPavadinimai,
        row.kategorija,
    ]).join(" "));

    return {
        sutartiesUnikalusId: toNumber(row.sutartiesUnikalusId),
        tekstas,
        pavadinimas: row.pavadinimas,
        perkanciojiOrganizacija: row.perkanciojiOrganizacija,
        tiekejai,
        bvpzPavadinimai,
        sutartiesNumeris: row.sutartiesNumeris,
        pirkimoNumeris: row.pirkimoNumeris,
        tipas: row.tipas,
        kategorija: row.kategorija,
        perkanciosiosOrganizacijosKodas: row.perkanciosiosOrganizacijosKodas,
        tiekejaiKodai,
        bvpzKodai,
        verte: toNumber(row.verte),
        suma: toNumber(row.suma),
        faktineIvykdimoVerte: toNumber(row.faktineIvykdimoVerte),
        dokumentuKiekis: toNumber(row.dokumentuKiekis),
        sudarymoData: toRfc3339(row.sudarymoData),
        paskelbimoData: toRfc3339(row.paskelbimoData),
        galiojimoData: toRfc3339(row.galiojimoData),
        faktineIvykdimoData: toRfc3339(row.faktineIvykdimoData),
        paskutinioRedagavimoData: toRfc3339(row.paskutinioRedagavimoData) ?? new Date().toISOString(),
        paskutinioAtnaujinimoData: toRfc3339(row.paskutinioAtnaujinimoData),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processSutartysIndexQueue,
        label: "sutartys",
        logger,
    });
    await postgres.end();
    process.exit(0);
}

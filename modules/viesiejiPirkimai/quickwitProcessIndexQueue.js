import { postgres } from "../../postgres/postgres.js";
import { drainIndexQueue, runShardedDrain } from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { foldLithuanian } from "../../utils/text.js";
import { compact, toNumber } from "../../utils/coerce.js";
import { toRfc3339 } from "../../utils/time.js";
import { pathToFileURL } from "node:url";

const logger = new Logger();

const BATCH_SIZE = 2500;
const LENTELE = "viesiejiPirkimai";

/**
 * Nusausina vieną `viesiejiPirkimaiIndexQueue` porciją į Quickwit.
 * Karkasas (tranzakcija, dedup, shard'inimas) — `quickwit/indexQueueDrainer.js`.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} `true`, kai buvo darbo.
 */
export async function processViesiejiPirkimaiIndexQueue(opts = {}) {
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "viesiejiPirkimaiIndexQueue",
            keyColumn: "pirkimoId",
            batchSize: BATCH_SIZE,
            commit: "auto",
            toEilutesId,
            rowId: (row) => row.pirkimoId,
            buildDoc,
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT
                        "pirkimoId", pavadinimas, "pirkimoVykdytojas", informacija,
                        "paskelbimoData", "pasiulymuPateikimoTerminas",
                        "pirkimoBudas", statusas, "numatomaBendraPirkimoVerte",
                        zingsnis, type, "numatomaVerteEUR", "bvpzKodai",
                        "pirkimoObjektoTipas", "esFinansavimas",
                        "pirkimoVykdytojasId", "jarKodas"
                     FROM public."viesiejiPirkimai"
                     WHERE "pirkimoId" = ANY($1::int[])`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

export function buildDoc(row) {
    const bvpzKodai = compact(row.bvpzKodai ?? []);
    const tekstas = foldLithuanian(compact([
        row.pavadinimas,
        row.pirkimoId,
        row.pirkimoVykdytojas,
        row.informacija,
        row.jarKodas,
        row.pirkimoVykdytojasId,
        row.pirkimoBudas,
        row.statusas,
        row.zingsnis,
        row.type,
        row.pirkimoObjektoTipas,
        ...bvpzKodai,
    ]).join(" "));

    return {
        pirkimoId: String(row.pirkimoId),
        tekstas,
        pavadinimas: row.pavadinimas,
        pirkimoVykdytojas: row.pirkimoVykdytojas,
        informacija: row.informacija,
        jarKodas: row.jarKodas,
        pirkimoVykdytojasId: row.pirkimoVykdytojasId,
        pirkimoBudas: row.pirkimoBudas,
        statusas: row.statusas,
        zingsnis: row.zingsnis,
        type: row.type,
        pirkimoObjektoTipas: row.pirkimoObjektoTipas,
        bvpzKodai,
        esFinansavimas: row.esFinansavimas,
        numatomaBendraPirkimoVerte: toNumber(row.numatomaBendraPirkimoVerte),
        numatomaVerteEUR: toNumber(row.numatomaVerteEUR),
        paskelbimoData: toRfc3339(row.paskelbimoData) ?? new Date().toISOString(),
        pasiulymuPateikimoTerminas: toRfc3339(row.pasiulymuPateikimoTerminas),
    };
}

function toEilutesId(pirkimoId) {
    if (!/^\d+$/.test(String(pirkimoId))) {
        throw new Error(`viesiejiPirkimai.pirkimoId is not numeric: ${pirkimoId}`);
    }
    return String(pirkimoId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processViesiejiPirkimaiIndexQueue,
        label: "viesiejiPirkimai",
        logger,
    });
    await postgres.end();
    process.exit(0);
}

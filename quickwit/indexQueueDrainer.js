import { postgres } from "../postgres/postgres.js";
import { indexDocs } from "./quickwit.js";
import { fmtBytes } from "../utils/units.js";

/*
Bendras Quickwit indeksavimo eilės nusausintojas.

Anksčiau `dokumentai`, `sutartys` ir `viesiejiPirkimai` turėjo po savo ~250–320 eil.
kopiją tos pačios logikos; kopijos spėjo išsiskirti (skirtingas laiko juostos
traktavimas, vienur buvo shard'inimas ir švarus stabdymas, kitur ne). Čia gyvena
karkasas, o moduliai paduoda tik tai, kas iš tikrųjų skiriasi: eilės/lentelės
pavadinimus, `SELECT` ir `buildDoc`.

Tranzakcijos garantija (nepakitusi): eilutės NEnaikinamos iš anksto — porcija
pasiimama su `SELECT ... FOR UPDATE SKIP LOCKED`, atliekamos šalutinės operacijos ir
tik po sėkmingo `indexDocs` eilutės ištrinamos bei `COMMIT`'inama. Bet kokia klaida →
`ROLLBACK`, eilutės lieka eilėje ir bus apdorotos pakartotinai (duomenys neprarandami).
*/

/** Kuris eilės įrašas nusveria, kai tam pačiam raktui susikaupė keli keitimai. */
const PRIORITY = { delete: 0, patch: 1, insert: 2 };

/**
 * Nusausina vieną indeksavimo eilės porciją į Quickwit.
 *
 * @param {object} cfg
 * @param {string} cfg.lentele - Quickwit lentelės vardas („sutartys", „dokumentai", …).
 * @param {string} cfg.queueTable - eilės lentelė, pvz. `vpmSutartysIndexQueue`.
 * @param {string} cfg.keyColumn - rakto stulpelis eilėje, pvz. `unikalusId`.
 * @param {number} cfg.batchSize - kiek eilės įrašų imti vienu kartu.
 * @param {"auto"|"force"} [cfg.commit] - Quickwit ingest commit režimas.
 * @param {(id: string) => string} [cfg.toEilutesId] - raktas → `quickwitEilutes.eilutesId`.
 * @param {(client: import("pg").ClientBase, ids: string[]) => Promise<object[]>} cfg.fetchRows
 * @param {(row: object) => object|Promise<object>} cfg.buildDoc
 * @param {(row: object) => string|number} cfg.rowId - eilutė → jos raktas (dedupui).
 * @param {{ log: (text: string) => void }} cfg.logger
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 *   Kai `shardCount > 1`, imamos tik tos eilutės, kurių raktas patenka į `shard` hash'o
 *   skiltį — taip vienas objektas visada priklauso vienam darbininkui (išsaugoma
 *   operacijų eilės tvarka, nėra lenktynių).
 * @returns {Promise<boolean>} `true`, jei buvo apdorota eilučių; `false`, jei eilė tuščia.
 */
export async function drainIndexQueue(cfg, { shard, shardCount } = {}) {
    const {
        lentele,
        queueTable,
        keyColumn,
        batchSize,
        commit = "auto",
        toEilutesId = String,
        fetchRows,
        buildDoc,
        rowId,
        logger,
    } = cfg;

    const sharded = shardCount > 1;
    const zyme = sharded ? `[${shard}/${shardCount}]` : "";
    const client = await postgres.connect();

    try {
        await client.query("BEGIN");

        // Pasiimam seniausią porciją, užrakindami eilutes (gretimi darbininkai jas
        // praleidžia). Eilutės lieka eilėje iki COMMIT.
        const claim = sharded
            ? `SELECT id, "${keyColumn}" AS raktas, keitimas
               FROM "${queueTable}"
               WHERE abs(hashtext("${keyColumn}"::text)::bigint) % $2 = $3
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`
            : `SELECT id, "${keyColumn}" AS raktas, keitimas
               FROM "${queueTable}"
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`;
        const { rows: queue } = await client.query(
            claim,
            sharded ? [batchSize, shardCount, shard] : [batchSize],
        );

        if (!queue.length) {
            // Tuščios eilės sąmoningai neloginam: šias funkcijas TaskRunner kviečia
            // nuolat, tad eilutė „tuščia" būtų dažniausias įrašas visame loge.
            await client.query("COMMIT");
            return false;
        }

        logger.log(`${queueTable}${zyme}: paimta ${queue.length} eil.`);

        const claimedIds = queue.map((row) => row.id);

        // Dedup pagal raktą. Pirmenybė: delete > patch > insert. Raktus laikom
        // eilutėmis — bigint iš pg grįžta kaip string, ir taip išvengiam
        // Map'o raktų nesutapimo tarp 123 ir "123".
        const deduped = new Map();
        for (const row of queue) {
            const key = String(row.raktas);
            const existing = deduped.get(key);
            if (!existing || PRIORITY[row.keitimas] < PRIORITY[existing]) {
                deduped.set(key, row.keitimas);
            }
        }

        const toDelete = [];
        const toIndex = [];
        for (const [key, keitimas] of deduped) {
            if (keitimas === "delete") toDelete.push(key);
            else toIndex.push(key);
        }

        // Trynimai — nuimam quickwitEilutes žemėlapį. Paieškos filterLive() po to
        // nustoja matyti našlaitį Quickwit dokumentą (jis guli shard'e, kol
        // deleteDeadIndexes išveda visą shard'ą). quickwitEilutesGyvosDel trigeris
        // sumažina gyvosEilutes, o generuotas mirusiosEilutes pakyla — skaitiklių
        // rankomis liesti nereikia.
        if (toDelete.length) {
            await deleteEilutes(client, lentele, toDelete.map(toEilutesId));
            logger.log(`${lentele}${zyme}: ištrinta ${toDelete.length} iš Quickwit`);
        }

        if (toIndex.length) {
            const rows = await fetchRows(client, toIndex);

            // Objektai, kurių insert/patch metu šaltinio lentelėje jau nebėra —
            // traktuojam kaip delete. Kitaip jų quickwitEilutes įrašas liktų
            // našlaitis: niekas jo nebeišvalytų, o gyvosEilutes rodytų jį gyvą.
            const found = new Set(rows.map((row) => String(rowId(row))));
            const vanished = toIndex.filter((id) => !found.has(id));

            if (rows.length) {
                const items = await Promise.all(
                    rows.map(async (row) => ({
                        eilutesId: toEilutesId(String(rowId(row))),
                        doc: await buildDoc(row),
                    })),
                );

                const t0 = Date.now();
                logger.log(`${lentele}${zyme}: indeksuojama ${items.length}…`);

                // Ne tranzakcinis, bet idempotentiškas: insert/patch pagal doc id,
                // tad pakartotinis indeksavimas (po ROLLBACK/crash) yra saugus.
                const { serializedBytes: totalBytes } = await indexDocs(
                    lentele,
                    items,
                    { commit },
                );

                const elapsedMs = Date.now() - t0;
                const avgBytes = Math.round(totalBytes / items.length);
                const mbPerSec = totalBytes / 1024 / 1024 / (elapsedMs / 1000);
                logger.log(
                    `${lentele}${zyme}: suindeksuota ${items.length} | vid. ${fmtBytes(avgBytes)} / dok. | viso ${fmtBytes(totalBytes)} per ${elapsedMs}ms = ${mbPerSec.toFixed(2)} MiB/s`,
                );
            }

            // NE po `if (rows.length)` — jei dingo visa porcija, žemėlapius vis tiek
            // reikia išvalyti. Toje pačioje tranzakcijoje → atomiška; jei įrašo nėra,
            // DELETE tiesiog nieko neranda (saugu).
            if (vanished.length) {
                await deleteEilutes(client, lentele, vanished.map(toEilutesId));
                logger.log(`${lentele}${zyme}: ištrinta ${vanished.length} dingusių iš Quickwit`);
            }
        }

        // Tik dabar, kai visos šalutinės operacijos pavyko, pašalinam porciją.
        await client.query(
            `DELETE FROM "${queueTable}" WHERE id = ANY($1::bigint[])`,
            [claimedIds],
        );
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function deleteEilutes(client, lentele, eilutesIds) {
    await client.query(
        `DELETE FROM "quickwitEilutes"
         WHERE "lentelesId" = (SELECT id FROM "quickwitLenteles" WHERE "lentele" = $1)
           AND "eilutesId" = ANY($2::bigint[])`,
        [lentele, eilutesIds],
    );
}

/**
 * `--concurrency=N` | `--concurrency N` | `-c N`; numatytoji reikšmė 1.
 * @param {string[]} argv
 * @returns {string}
 */
export function parseConcurrency(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const match = arg.match(/^--concurrency=(.+)$/);
        if (match) return match[1];
        if (arg === "--concurrency" || arg === "-c") return argv[i + 1];
    }
    return "1";
}

/**
 * CLI apvalkalas: paleidžia `work` N lygiagrečių shard'ų, švariai reaguoja į
 * SIGINT/SIGTERM ir po klaidos kartoja praėjus `retryMs`.
 *
 * @param {object} p
 * @param {(opts: { shard?: number, shardCount?: number }) => Promise<boolean>} p.work
 * @param {string[]} [p.argv] - `process.argv.slice(2)`
 * @param {number} [p.retryMs]
 * @param {string} p.label - vardas logams
 * @param {{ log: (text: string) => void }} p.logger
 */
export async function runShardedDrain({
    work,
    argv = process.argv.slice(2),
    retryMs = 60_000,
    label,
    logger,
}) {
    const concurrency = parseInt(parseConcurrency(argv), 10);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        logger.log("Netinkamas --concurrency: turi būti sveikas skaičius >= 1");
        process.exit(1);
    }

    logger.log(`Pradedamas ${label} Quickwit eilės nusausinimas, concurrency=${concurrency}`);

    // Švarus stabdymas: SIGINT/SIGTERM pažymi `stopping`; darbininkai baigia
    // dabartinę porciją (tranzakcija visada užsidaro COMMIT/ROLLBACK) ir išeina.
    let stopping = false;
    const wakeups = new Set(); // pertraukiam laukiančius retry `sleep`'us
    const requestStop = (signal) => {
        if (stopping) {
            logger.log(`gauta ${signal} dar kartą, išeiname iš karto`);
            process.exit(130);
        }
        stopping = true;
        logger.log(`gauta ${signal}, baigiame dabartinį darbą ir išeisime…`);
        for (const resolve of wakeups) resolve();
    };
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

    // Pertraukiamas sleep — pabunda anksčiau, jei paprašyta sustoti.
    const sleep = (ms) =>
        new Promise((resolve) => {
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                wakeups.delete(done);
                resolve();
            }
            wakeups.add(done);
        });

    // Vienas darbininkas sausina savo shard'ą, kol jis ištuštėja arba paprašoma
    // sustoti; klaidos atveju palaukia retryMs (pvz. Quickwit 503) ir kartoja.
    async function worker(shard) {
        const opts = concurrency > 1 ? { shard, shardCount: concurrency } : {};
        while (!stopping) {
            try {
                const didWork = await work(opts);
                if (!didWork) break;
            } catch (error) {
                logger.log(
                    `${label}[${shard}] klaida, kartosime po ${retryMs / 1000}s: ${error.message}`,
                );
                await sleep(retryMs);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
    logger.log(`${label} Quickwit eilės nusausinimas baigtas`);
}

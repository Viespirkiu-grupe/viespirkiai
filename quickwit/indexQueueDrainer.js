import { performance } from "node:perf_hooks";
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

Sakinių tvarka šioje tranzakcijoje NĖRA laisva: nieko, kas paima `quickwit.indeksai`
eilutės lock'ą, negalima daryti prieš `indexDocs` — plačiau žr. komentarą prie
trynimų žemiau.
*/

/** Kuris eilės įrašas nusveria, kai tam pačiam raktui susikaupė keli keitimai. */
const PRIORITY = { delete: 0, patch: 1, insert: 2 };

const ms = (value) => `${Math.round(value)}ms`;

/**
 * Porcijos etapų suvestinė. Iki šiol logas rodė tik `indexDocs` trukmę, todėl
 * viskas, kas vyksta prieš jį — eilės pasiėmimas, SELECT ir `buildDoc` su
 * sidecar'ų skaitymu — buvo nematomas tarpas tarp dviejų eilučių. Būtent ten
 * dažniausiai ir dingsta laikas.
 */
function summarize(phases) {
    const total = Object.values(phases).reduce((sum, value) => sum + value, 0);
    const [topName, topValue] = Object.entries(phases)
        .sort(([, a], [, b]) => b - a)[0] ?? ["-", 0];
    const parts = Object.entries(phases)
        .filter(([, value]) => value >= 1)
        .map(([name, value]) => `${name} ${ms(value)}`)
        .join(" ");
    const share = total > 0 ? Math.round((topValue / total) * 100) : 0;
    return { total, parts, top: `${topName} ${share}%` };
}

/**
 * Nusausina vieną indeksavimo eilės porciją į Quickwit.
 *
 * @param {object} cfg
 * @param {string} cfg.lentele - Quickwit lentelės vardas („sutartys", „dokumentai", …).
 * @param {string} cfg.queueTable - eilės lentelė, pvz. `indexQueue`.
 * @param {string} [cfg.queueSchema] - eilės schema, pagal nutylėjimą `public`.
 * @param {string} cfg.keyColumn - rakto stulpelis eilėje, pvz. `unikalusId`.
 * @param {string} [cfg.changeColumn] - keitimo stulpelis, pagal nutylėjimą `keitimas`.
 * @param {number} cfg.batchSize - kiek eilės įrašų imti vienu kartu.
 * @param {"auto"|"force"} [cfg.commit] - Quickwit ingest commit režimas.
 * @param {(id: string) => string} [cfg.toEilutesId] - raktas → `quickwit.eilutes.eilutesId`.
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
        queueSchema = "public",
        keyColumn,
        changeColumn = "keitimas",
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

    /** Etapų trukmės (ms); išvedamos viena suvestine porcijos gale. */
    const phases = { claim: 0, fetch: 0, build: 0, index: 0, delete: 0, dequeue: 0 };
    let mark = performance.now();
    const lap = (name) => {
        const now = performance.now();
        phases[name] += now - mark;
        mark = now;
    };

    const client = await postgres.connect();

    try {
        await client.query("BEGIN");

        // Pasiimam seniausią porciją, užrakindami eilutes (gretimi darbininkai jas
        // praleidžia). Eilutės lieka eilėje iki COMMIT.
        // Schemą prirašom tik ne `public` atveju — kitoms eilėms SQL nesikeičia.
        const queueRef = queueSchema && queueSchema !== "public"
            ? `"${queueSchema}"."${queueTable}"`
            : `"${queueTable}"`;
        const claim = sharded
            ? `SELECT id, "${keyColumn}" AS raktas, "${changeColumn}" AS keitimas
               FROM ${queueRef}
               WHERE abs(hashtext("${keyColumn}"::text)::bigint) % $2 = $3
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`
            : `SELECT id, "${keyColumn}" AS raktas, "${changeColumn}" AS keitimas
               FROM ${queueRef}
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`;
        const { rows: queue } = await client.query(
            claim,
            sharded ? [batchSize, shardCount, shard] : [batchSize],
        );
        lap("claim");

        if (!queue.length) {
            // Tuščios eilės sąmoningai neloginam: šias funkcijas TaskRunner kviečia
            // nuolat, tad eilutė „tuščia" būtų dažniausias įrašas visame loge.
            await client.query("COMMIT");
            return false;
        }

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

        /** @type {string[]} */
        let vanished = [];
        let indexed = null;

        if (toIndex.length) {
            const rows = await fetchRows(client, toIndex);
            lap("fetch");

            // Objektai, kurių insert/patch metu šaltinio lentelėje jau nebėra —
            // traktuojam kaip delete. Kitaip jų quickwit.eilutes įrašas liktų
            // našlaitis: niekas jo nebeišvalytų, o gyvosEilutes rodytų jį gyvą.
            const found = new Set(rows.map((row) => String(rowId(row))));
            vanished = toIndex.filter((id) => !found.has(id));

            if (rows.length) {
                // Visi `buildDoc` sukasi kartu, tad atskirų trukmių čia
                // nematuojam: jos persidengia, o „lėčiausias" tereikštų, kuris
                // baigė paskutinis — t. y. viso etapo trukmę. Prasmę turi tik
                // bendras langas ir jo vidurkis vienam dokumentui.
                const items = await Promise.all(
                    rows.map(async (row) => ({
                        eilutesId: toEilutesId(String(rowId(row))),
                        doc: await buildDoc(row),
                    })),
                );
                lap("build");

                // Ne tranzakcinis, bet idempotentiškas: insert/patch pagal doc id,
                // tad pakartotinis indeksavimas (po ROLLBACK/crash) yra saugus.
                const { serializedBytes: totalBytes } = await indexDocs(
                    lentele,
                    items,
                    { commit },
                );
                lap("index");

                const avgBytes = Math.round(totalBytes / items.length);
                const mbPerSec = totalBytes / 1024 / 1024 / (phases.index / 1000);
                indexed = {
                    count: items.length,
                    avgBytes,
                    totalBytes,
                    mbPerSec,
                    avgBuildMs: phases.build / items.length,
                };
            }
        }

        // Trynimai — nuimam quickwit.eilutes žemėlapį. Paieškos filterLive() po to
        // nustoja matyti našlaitį Quickwit dokumentą (jis guli shard'e, kol
        // deleteDeadIndexes išveda visą shard'ą). quickwit.gyvos_eilutes_del() trigeris
        // sumažina gyvosEilutes, o generuotas mirusiosEilutes pakyla — skaitiklių
        // rankomis liesti nereikia.
        //
        // SĄMONINGAI po `indexDocs`, ne prieš jį. Tas trigeris daro
        // `UPDATE "quickwit"."indeksai"` ir paima aktyvaus shard'o eilutės lock'ą,
        // kurį ši tranzakcija laikytų iki COMMIT. `indexDocs` gi dirba ATSKIROJE
        // pool'o jungtyje ir toje pačioje eilutėje bumpina `iterptosEilutes` —
        // t. y. lauktų lock'o, kurį laiko jį iškvietusi tranzakcija. Postgres to
        // neaptinka kaip deadlock'o (pusė ciklo yra Node'e: išorinis backend'as
        // būna `idle in transaction` / ClientRead, nelaukdamas jokio lock'o), tad
        // abi jungtys kabo neribotai ir prikala globalų xmin horizontą — vacuum'as
        // nustoja valyti visą duomenų bazę. Kol niekas iš `quickwit.indeksai` eilutės
        // lock'ų nepaimamas prieš `indexDocs`, ciklas nesusidaro.
        //
        // `vanished` — NE po `if (rows.length)`: jei dingo visa porcija, žemėlapius
        // vis tiek reikia išvalyti. Vis dar ta pati tranzakcija → atomiška; jei
        // įrašo nėra, DELETE tiesiog nieko neranda (saugu). `toDelete` ir `toIndex`
        // nesikerta (`deduped` kiekvieną raktą priskiria tik vienam sąrašui), tad
        // trynimų perkėlimas į galą rezultato nekeičia.
        if (toDelete.length) {
            await deleteEilutes(client, lentele, toDelete.map(toEilutesId));
        }
        if (vanished.length) {
            await deleteEilutes(client, lentele, vanished.map(toEilutesId));
        }
        lap("delete");

        // Tik dabar, kai visos šalutinės operacijos pavyko, pašalinam porciją.
        await client.query(
            `DELETE FROM ${queueRef} WHERE id = ANY($1::bigint[])`,
            [claimedIds],
        );
        await client.query("COMMIT");
        lap("dequeue");

        const { total, parts, top } = summarize(phases);
        const kiekis = indexed
            ? `${indexed.count} dok.`
            : `${queue.length} eil.`;
        const trynimai = toDelete.length + vanished.length;
        const apimtis = indexed
            ? ` | ${fmtBytes(indexed.avgBytes)}/dok. ${indexed.mbPerSec.toFixed(2)} MiB/s` +
              ` | build ${ms(indexed.avgBuildMs)}/dok.`
            : "";
        logger.log(
            `${lentele}${zyme}: ${kiekis}${trynimai ? ` (+${trynimai} trinta)` : ""}` +
            ` per ${ms(total)} | stabdo ${top} | ${parts}${apimtis}`,
        );
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
        `DELETE FROM "quickwit"."eilutes"
         WHERE "lentelesId" = (SELECT id FROM "quickwit"."lenteles" WHERE "lentele" = $1)
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

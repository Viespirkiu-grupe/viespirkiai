import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    createSutartysSpintaClient,
    isSutartysSpintaConfigured,
    syncSutartysToSpinta,
} from "./spintaSync.js";

/**
 * Pasiima vieną eilutę VIENU sakiniu ir iš karto atlaisvina jungtį.
 *
 * Anksčiau eilutė būdavo laikoma atviroje transakcijoje visą Spinta sync'o
 * laiką. Tai reiškė, kad jungtis (o prie pgbouncer transaction pooling – ir
 * serverio jungtis) lieka pririšta per visus HTTP round trip'us, o pats
 * sync'as viduje dar prašo ANTROS jungties iš to paties pool'o
 * (`fetchActiveSutartysByIds`). Kai lygiagrečių job'ų tiek pat ar daugiau nei
 * `PG_MAX_CONNECTIONS`, pool'as užsirakina pats: visi laiko po vieną jungtį ir
 * visi laukia antros, kol suveikia `connectionTimeoutMillis`.
 *
 * Toks pats modelis kaip modules/domenai/processAdpQueue.js.
 */
async function claimOne() {
    const { rows } = await postgres.query(
        `DELETE FROM "vpmSutartys"."adpQueue"
         WHERE "unikalusId" = (
             SELECT "unikalusId"
             FROM "vpmSutartys"."adpQueue"
             ORDER BY "queuedAt"
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         RETURNING "unikalusId"`,
    );
    return rows[0] ? Number(rows[0].unikalusId) : null;
}

/** Grąžina eilutę į eilę, jei sync'as nepavyko. */
async function requeue(id) {
    await postgres.query(
        `INSERT INTO "vpmSutartys"."adpQueue" ("unikalusId")
         SELECT $1::bigint
         WHERE NOT EXISTS (
             SELECT 1 FROM "vpmSutartys"."adpQueue" WHERE "unikalusId" = $1::bigint
         )`,
        [id],
    );
}

export async function processSutartysAdpQueue() {
    if (!isSutartysSpintaConfigured()) return false;

    const id = await claimOne();
    if (id === null) return false;

    try {
        const stats = await syncSutartysToSpinta({
            ids: [id],
            spinta: createSutartysSpintaClient(),
        });
        log(
            `vpmSutartys."adpQueue" id=${id} | insert=${stats.insert} patch=${stats.patch} delete=${stats.delete} unchanged=${stats.unchanged}`,
        );
        return true;
    } catch (error) {
        await requeue(id);
        throw error;
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        while (await processSutartysAdpQueue()) {}
    } catch (error) {
        console.error('Klaida apdorojant vpmSutartys."adpQueue":', error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}

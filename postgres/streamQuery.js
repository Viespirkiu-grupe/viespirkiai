import QueryStream from "pg-query-stream";
import { postgres } from "./postgres.js";

/**
 * Srautinė (kursorinė) užklausa su pilnai suvaldytu jungties gyvavimo ciklu.
 *
 * Kodėl to reikia:
 *  1. `pg-query-stream` po apačia yra portalas/kursorius. Jis privalo suktis
 *     EKSPLICITINĖJE transakcijoje – kitaip pgbouncer transaction pooling
 *     režime serverio jungtis atiduodama kitam klientui vidury srauto ir
 *     kursorius dingsta;
 *  2. jungtį atlaisvinti galima tik srautui pasibaigus. Anksčiau kviesdami
 *     `client.release()` iškart po `client.query(qs)` grąžindavom į pool'ą dar
 *     skaitančią jungtį – kitas ją pasiėmęs procesas savo užklausas siųsdavo į
 *     tą patį, dar užimtą ryšį.
 *
 * Grąžinamas `Readable` pats po savęs sutvarko: pasibaigus, nutrūkus ar
 * `destroy()` atveju uždaro transakciją ir atlaisvina klientą. Iškvietėjui
 * jungties liesti nebereikia.
 *
 * Transakcija atidaroma READ ONLY – visi srautai čia yra eksportai.
 * Ilgas eksportas laiko atvirą snapshot'ą, tad `repack`/autovacuum tuo metu
 * nesutvarkys naujesnių eilučių – tai sąmoningas kompromisas, mainais už
 * pastovią atmintį eksportuojant milijonus eilučių.
 *
 * @param {string} sql
 * @param {any[]} [params]
 * @param {{ batchSize?: number }} [options]
 * @returns {Promise<import("stream").Readable>}
 */
export async function streamQuery(sql, params = [], options = {}) {
    const client = await postgres.connect();

    try {
        await client.query("BEGIN READ ONLY");
    } catch (err) {
        client.release();
        throw err;
    }

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        // Skaitymo transakcija – užtenka ROLLBACK'o, jis korektiškas ir po
        // klaidos, ir po nutraukto srauto.
        Promise.resolve()
            .then(() => client.query("ROLLBACK"))
            .catch(() => {})
            .finally(() => client.release());
    };

    const stream = client.query(
        new QueryStream(sql, params, { batchSize: options.batchSize ?? 1000 }),
    );
    // `close` apima ir normalią pabaigą, ir destroy(); `error` – kad jungtis
    // neliktų pakibusi, jei srautas nulūžta nespėjęs užsidaryti.
    stream.on("close", finish);
    stream.on("error", finish);

    return stream;
}

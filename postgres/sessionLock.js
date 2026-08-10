import pkg from "pg";
import config from "../utils/config.js";

const { Client } = pkg;

/**
 * Seanso lygio advisory lock'as ilgiems batch'ams („tik vienas importas vienu
 * metu"), saugus prie pgbouncer.
 *
 * `pg_advisory_lock` gyvena JUNGTYJE, o ne transakcijoje. Transaction pooling
 * režime pool'o klientas tarp transakcijų gauna vis kitą serverio jungtį, tad
 * lock'as liktų pakibęs svetimame ryšyje, o `pg_advisory_unlock` grąžintų
 * `false`. Todėl lock'ui – ATSKIRA tiesioginė jungtis į Postgres (aplenkiant
 * bouncer'į), o pats darbas toliau eina per įprastą pool'ą.
 *
 * Tiesioginės jungties privalumas prieš „lock lentelę": jungčiai nutrūkus –
 * įskaitant proceso nukritimą – Postgres lock'ą atlaisvina pats, tad pakibusio
 * užrakto valymo logikos nereikia.
 *
 * `PG_DIRECT_HOST`/`PG_DIRECT_PORT` nurodo Postgres tiesiogiai. Kol bouncer'io
 * nėra, jų nustatyti nereikia – krenta į `PG_HOST`/`PG_PORT`.
 */

/**
 * @param {string} key - laisvas raktas, hash'inamas per `hashtext`.
 * @returns {Promise<{ release: () => Promise<void> } | null>} null, jei lock'as
 *          jau užimtas kito proceso.
 */
export async function acquireSessionLock(key) {
    const client = new Client({
        host: config.pgDirectHost || config.pgHost,
        port: config.pgDirectPort || config.pgPort,
        user: config.pgUser,
        password: config.pgPassword,
        database: config.pgDatabase,
    });

    await client.connect();

    try {
        const { rows } = await client.query(
            "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked",
            [key],
        );
        if (!rows[0]?.locked) {
            await client.end();
            return null;
        }
    } catch (err) {
        await client.end().catch(() => {});
        throw err;
    }

    let released = false;
    return {
        async release() {
            if (released) return;
            released = true;
            // Jungties uždarymo Postgres'ui užtenka, bet unlock'inam eksplicitiškai,
            // kad elgesys būtų aiškus ir logs'uose matomas.
            await client
                .query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [key])
                .catch(() => {});
            await client.end().catch(() => {});
        },
    };
}

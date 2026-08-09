import pkg from "pg";
import config from "../utils/config.js";

const { Pool } = pkg;

/**
 * Tiesioginė jungtis į Postgres, aplenkiant pgbouncer'į.
 *
 * Reikalinga toms užklausoms, kurioms svarbu, PRIE KO iš tikrųjų prisijungta:
 * bouncer'io transaction pooling režime kiekviena transakcija gali nukeliauti į
 * kitą serverio jungtį, o dalis `pg_*` rodinių (pvz. `pg_stat_replication`,
 * `pg_current_wal_lsn()`) yra prasmingi tik pirminėje DB ir tik tada, kai
 * jungtis tikrai jos, o ne bouncer'io pusėje.
 *
 * `PG_DIRECT_HOST`/`PG_DIRECT_PORT` nurodo Postgres tiesiogiai. Kol bouncer'io
 * nėra, jų nustatyti nereikia – krenta į `PG_HOST`/`PG_PORT` (žr.
 * utils/configSchema.js).
 *
 * Pool'as mažas ir kuriamas tik pareikalavus: tiesioginės užklausos yra retos
 * (statistika, monitoringas), o jungtys neturi „valgyti" bouncer'io aplenkiančio
 * limito be reikalo. Šio pool'o užklausos NEPATENKA į SQL logą – logavimas
 * apgaubia tik `postgres` pool'ą (žr. postgres/postgres.js).
 */

/** Bendri tiesioginės jungties parametrai (naudoja ir postgres/sessionLock.js). */
export function directConnectionConfig() {
    return {
        host: config.pgDirectHost || config.pgHost,
        port: config.pgDirectPort || config.pgPort,
        user: config.pgUser,
        password: config.pgPassword,
        database: config.pgDatabase,
    };
}

/** @type {import("pg").Pool | null} */
let directPool = null;

/** Lazy tiesioginis pool'as. */
export function getDirectPool() {
    if (!directPool) {
        directPool = new Pool({
            ...directConnectionConfig(),
            max: 2,
            idleTimeoutMillis: 10_000,
            connectionTimeoutMillis: 10_000,
        });
        // Be šito idle kliento klaida (pvz. nutrūkus tinklui) virsta neapdorota
        // proceso lygio išimtimi.
        directPool.on("error", (err) => {
            console.warn(`[pgDirect] pool'o klaida: ${err.message}`);
        });
    }
    return directPool;
}

/**
 * Užklausa tiesiogine jungtimi.
 * @param {string} text
 * @param {any[]} [values]
 */
export function queryDirect(text, values) {
    return getDirectPool().query(text, values);
}

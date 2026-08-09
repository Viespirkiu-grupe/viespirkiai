import { connect } from "nats";
import config from "./config.js";

/**
 * Bendra NATS signalų magistralė (pakeitė PostgreSQL LISTEN/NOTIFY hub'ą).
 *
 * Procese laikoma VIENA jungtis, kurią dalinasi visi prenumeratoriai: N žiūrovų
 * / M kanalų = 1 jungtis. Skirtingai nuo pg_notify, DB jungties ji neužima, tad
 * niekas nebetrukdo `postgres` pool'ui eiti per pgbouncer transaction pooling
 * režimu.
 *
 * Semantikos skirtumas nuo pg_notify, į kurį reikia atsižvelgti:
 *  - pristatymas yra *at-most-once* – jei prenumeratorius tuo metu atsijungęs,
 *    žinutė dingsta be pėdsako. Visi kanalai privalo turėti atsarginę priemonę
 *    (SSE persijungęs persikrauna, baneris pollinamas);
 *  - publish NĖRA transakcinis. `pg_notify` išsiųsdavo tik po COMMIT; čia
 *    publish'inti privalu PO to, kai transakcija jau commit'inta, kitaip
 *    gavėjas perskaitys dar nematomą eilutę.
 *
 * Jungtis kuriama tinginiu būdu – procesai, kurie nieko neprenumeruoja ir
 * nepublish'ina (dauguma batch'ų), su NATS nesijungia visai.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** @type {import("nats").NatsConnection | null} */
let nc = null;
/** @type {Promise<import("nats").NatsConnection> | null} */
let connecting = null;

async function ensureConnected() {
    if (!config.natsUrl) throw new Error("natsHub: NATS_URL nenurodytas");
    if (nc) return nc;
    if (connecting) return connecting;

    connecting = connect({
        servers: config.natsUrl,
        token: config.natsToken || undefined,
        name: `viespirkiai-${process.pid}`,
        // Begalinis reconnect: signalų magistralės neveikimas neturi versti
        // proceso mirti, o nats.js persijungęs PATS atkuria visas prenumeratas.
        maxReconnectAttempts: -1,
        reconnectTimeWait: 500,
    })
        .then((c) => {
            nc = c;
            connecting = null;
            void c.closed().then(() => {
                if (nc === c) nc = null;
            });
            return c;
        })
        .catch((err) => {
            connecting = null;
            throw err;
        });

    return connecting;
}

/**
 * Prenumeruoti kanalą. Grąžina `unsubscribe` funkciją.
 *
 * @param {string} channel - kanalo (NATS subject'o) pavadinimas.
 * @param {(payload: unknown, raw: string) => void} onMessage - kviečiama gavus
 *        žinutę; `payload` – JSON.parse'inta reikšmė (arba pati eilutė, jei ne JSON).
 * @returns {() => void}
 */
export function subscribe(channel, onMessage) {
    /** @type {import("nats").Subscription | null} */
    let sub = null;
    let stopped = false;

    void ensureConnected()
        .then((c) => {
            if (stopped) return;
            sub = c.subscribe(channel);
            void (async () => {
                for await (const m of sub) {
                    const raw = dec.decode(m.data);
                    let parsed = raw;
                    if (raw) {
                        try {
                            parsed = JSON.parse(raw);
                        } catch {
                            parsed = raw;
                        }
                    }
                    try {
                        onMessage(parsed, raw);
                    } catch {
                        // Prenumeratoriaus klaida neturi nutraukti fan-out'o kitiems.
                    }
                }
            })();
        })
        .catch(() => {
            // Jungties nėra – kanalas tyliai neveikia, gavėjai turi fallback'ą.
        });

    return () => {
        stopped = true;
        sub?.unsubscribe();
        sub = null;
    };
}

/**
 * Paskelbti žinutę kanale. Fire-and-forget: niekada nemeta ir nelaukia
 * pristatymo, nes signalo praradimas yra nekritinis.
 *
 * @param {string} channel
 * @param {unknown} [payload] - serializuojama į JSON; be argumento – tuščia žinutė.
 */
export function publish(channel, payload) {
    void ensureConnected()
        .then((c) => {
            c.publish(
                channel,
                enc.encode(payload === undefined ? "" : JSON.stringify(payload)),
            );
        })
        .catch(() => {});
}

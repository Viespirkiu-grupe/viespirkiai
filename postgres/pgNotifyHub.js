import config from "../utils/config.js";
import pkg from "pg";

const { Client } = pkg;

/**
 * Bendras PostgreSQL LISTEN/NOTIFY hub'as.
 *
 * Vietoj to, kad kiekvienas prenumeratorius (pvz. kiekvienas OCR SSE prisijungimas)
 * imtų atskirą pool klientą ir laikytų jį visą laiką su LISTEN, čia turim VIENĄ
 * dedikuotą, ilgaamžį `Client` ryšį, kuris multipleksuoja visus kanalus ir per
 * in-process callback'us fan-out'ina notifikacijas visiems prenumeratoriams.
 *
 * Taigi N žiūrovų / M kanalų = 1 DB jungtis, nepriklausomai nuo apkrovos.
 * Ryšys nenaudoja bendro `postgres` pool'o (kad neužimtų jo sloto ir kad LISTEN
 * niekada nebūtų nutrauktas idle timeout'o). Krentant — automatiškai persijungia
 * ir iš naujo LISTEN'ina visus turinčius prenumeratorių kanalus.
 */

/** @type {Map<string, Set<(payload: unknown, raw: string) => void>>} */
const channels = new Map();

/** @type {import("pg").Client | null} */
let client = null;
let connecting = null;
let reconnectTimer = null;
let reconnectDelayMs = 500;
const RECONNECT_MAX_MS = 15_000;

function quoteChannel(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`pgNotifyHub: netinkamas kanalo pavadinimas: ${name}`);
  }
  return `"${name}"`;
}

function dispatch(msg) {
  const subs = channels.get(msg.channel);
  if (!subs || subs.size === 0) return;
  const raw = msg.payload ?? "";
  let parsed = raw;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  for (const cb of subs) {
    try {
      cb(parsed, raw);
    } catch {
      // Prenumeratoriaus klaida neturi nutraukti fan-out'o kitiems.
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureConnected();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

async function ensureConnected() {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = new Client({
      host: config.pgHost,
      user: config.pgUser,
      password: config.pgPassword,
      database: config.pgDatabase,
      port: config.pgPort,
    });
    c.on("notification", dispatch);
    c.on("error", () => {
      // 'end' apačioje sutvarkys reconnect.
    });
    c.on("end", () => {
      if (client === c) {
        client = null;
        if (channels.size > 0) scheduleReconnect();
      }
    });

    await c.connect();
    client = c;
    connecting = null;
    reconnectDelayMs = 500;

    // Iš naujo LISTEN'inam visus kanalus, kurie dar turi prenumeratorių.
    for (const channel of channels.keys()) {
      await c.query(`LISTEN ${quoteChannel(channel)}`);
    }
    return c;
  })().catch((err) => {
    connecting = null;
    if (channels.size > 0) scheduleReconnect();
    throw err;
  });

  return connecting;
}

/**
 * Prenumeruoti pg_notify kanalą. Grąžina `unsubscribe` funkciją.
 *
 * @param {string} channel - kanalo pavadinimas (lowercase, kaip pg_notify pirmas argumentas)
 * @param {(payload: unknown, raw: string) => void} onNotify - kviečiama gavus notifikaciją;
 *        `payload` – JSON.parse'inta reikšmė (arba pati eilutė, jei ne JSON).
 * @returns {() => void}
 */
export function subscribe(channel, onNotify) {
  let subs = channels.get(channel);
  const isNewChannel = !subs;
  if (!subs) {
    subs = new Set();
    channels.set(channel, subs);
  }
  subs.add(onNotify);

  void ensureConnected()
    .then((c) => {
      if (isNewChannel && channels.get(channel) === subs) {
        return c.query(`LISTEN ${quoteChannel(channel)}`);
      }
    })
    .catch(() => {
      // reconnect logika pati pakartos LISTEN persijungusi.
    });

  return () => {
    const set = channels.get(channel);
    if (!set) return;
    set.delete(onNotify);
    if (set.size === 0) {
      channels.delete(channel);
      if (client) {
        client.query(`UNLISTEN ${quoteChannel(channel)}`).catch(() => {});
      }
    }
  };
}

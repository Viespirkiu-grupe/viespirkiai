import config from "../utils/config.js";
import { QW_URL } from "./qwHttp.js";
import { SQL_LOG_INDEX_CONFIG } from "./sqlLogIndexConfig.js";

/**
 * SQL logo rašymas TIESIAI į Quickwit – be Postgres, be shard'ų, be versijų.
 *
 * Sąmoningai atsietas nuo `quickwit/quickwit.js`: tas API kiekvienam įrašui
 * eina per `quickwitLenteles`/`quickwitIndeksai`/`quickwitEilutes`, o čia to
 * nereikia. Kiekviena diena turi savo indeksą (`sqlLogV2_2026-08-01`), tad
 * senienų valymas yra paprastas indekso ištrynimas, o ne split'ų retention.
 *
 * Svarbiausia savybė: logavimas NIEKADA nestabdo ir negriauna užklausų.
 * `enqueueSqlLog()` yra sinchroninis, dokumentai kaupiami buferyje ir siunčiami
 * paketais fone. Perpildžius buferį – seniausi metami (skaičius pranešamas
 * kitame siuntime), o siuntimo klaidos loginamos retai.
 *
 * Rekursijos rizikos nėra: čia naudojamas tik `fetch`, jokių DB užklausų.
 */

/**
 * Dienos indekso vardo priešdėlis; pilnas vardas – `sqlLogV2_YYYY-MM-DD`.
 *
 * V2 – nuo tada, kai dokumentuose nebeliko `sql` ir `path` laukų (tekstas
 * perkeltas į Postgres `sqlLogTekstai`). Seni `sqlLog_*` indeksai paliekami
 * ramybėje: jie nebeatitinka naujo šablono, tad į paiešką nemaišosi ir
 * `pruneSqlLogIndexes()` jų neliečia.
 */
export const SQL_LOG_INDEX_PREFIX = "sqlLogV2_";
/** Paieškai per visas dienas – indeksų šablonas `sqlLogV2_*`. */
export const SQL_LOG_INDEX_PATTERN = `${SQL_LOG_INDEX_PREFIX}*`;

/** Kiek dokumentų sukaupus siunčiama nelaukiant taimerio. */
const BATCH_SIZE = 500;
/** Kas kiek laiko išsiunčiamas nepilnas paketas. */
const FLUSH_INTERVAL_MS = 1_000;
/** Buferio riba – virš jos metami seniausi įrašai (atmintis svarbiau už logą). */
const MAX_BUFFER = 20_000;
/** HTTP timeout'as vienam ingest'ui. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Kaip dažnai pranešama apie siuntimo klaidas (kad logas neužsipiltų). */
const ERROR_LOG_INTERVAL_MS = 60_000;

let buffer = [];
let dropped = 0;
let flushing = false;
let timer = null;
let lastErrorLoggedAt = 0;
/** indexId → Promise, kad indekso sukūrimas būtų tikrinamas po kartą. */
const ensuredIndexes = new Map();

/** Ar SQL logas rašomas į Quickwit (SQL_LOG_QUICKWIT). */
export const sqlLogQuickwitEnabled =
    config.sqlLogQuickwit === true && config.quickwitUp !== false;

/**
 * Dienos indekso vardas pagal dokumento `ts` (UTC).
 * @param {string | Date} ts
 */
export function sqlLogIndexId(ts) {
    const iso = typeof ts === "string" ? ts : new Date(ts).toISOString();
    return `${SQL_LOG_INDEX_PREFIX}${iso.slice(0, 10)}`;
}

async function ensureIndex(indexId) {
    const existing = await fetch(`${QW_URL}/api/v1/indexes/${indexId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (existing.ok) return;
    if (existing.status !== 404) {
        throw new Error(`Quickwit GET indexes/${indexId} → ${existing.status}`);
    }

    const yaml = SQL_LOG_INDEX_CONFIG.replace(
        /^index_id:.*$/m,
        `index_id: ${indexId}`,
    );
    // Apsauga nuo tylaus placeholder'io pralindimo: toks indeksas atsidurtų
    // šalia dienos indeksų ir su sena schema griautų `sqlLog_*` užklausas.
    if (!yaml.includes(`index_id: ${indexId}`)) {
        throw new Error(`nepavyko įrašyti index_id (${indexId}) į schemą`);
    }
    const created = await fetch(`${QW_URL}/api/v1/indexes`, {
        method: "POST",
        headers: { "Content-Type": "application/yaml" },
        body: yaml,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 400 dažniausiai reiškia, kad indeksą ką tik sukūrė kitas procesas.
    if (!created.ok && created.status !== 400) {
        throw new Error(
            `Quickwit create index ${indexId} → ${created.status}: ${await created.text()}`,
        );
    }
}

function noteError(error) {
    const now = Date.now();
    if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLoggedAt = now;
    console.warn(`[sqlLog→quickwit] ${error?.message ?? error}`);
}

async function ingestDay(indexId, docs) {
    let ready = ensuredIndexes.get(indexId);
    if (!ready) {
        ready = ensureIndex(indexId);
        ensuredIndexes.set(indexId, ready);
    }
    try {
        await ready;
    } catch (error) {
        // Kitas siuntimas bandys sukurti iš naujo (pvz. Quickwit buvo nukritęs).
        ensuredIndexes.delete(indexId);
        throw error;
    }

    const res = await fetch(`${QW_URL}/api/v1/${indexId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: docs.map((doc) => JSON.stringify(doc)).join("\n"),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(
            `ingest ${indexId} → ${res.status}: ${await res.text()}`,
        );
    }
}

/**
 * Išsiunčia sukauptus dokumentus, suskirstytus pagal dienos indeksą (per
 * vidurnaktį viename pakete gali būti dvi dienos). Nesėkmės atveju paketas
 * prarandamas sąmoningai – kartoti nėra prasmės, o kaupti atmintyje pavojinga.
 */
export async function flushSqlLog() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer;
    buffer = [];
    const droppedNow = dropped;
    dropped = 0;

    try {
        const pagalDiena = new Map();
        for (const doc of batch) {
            const indexId = sqlLogIndexId(doc.ts);
            const dienosDokai = pagalDiena.get(indexId);
            if (dienosDokai) dienosDokai.push(doc);
            else pagalDiena.set(indexId, [doc]);
        }

        for (const [indexId, docs] of pagalDiena) {
            await ingestDay(indexId, docs);
        }

        if (droppedNow) {
            noteError(
                new Error(`buferis perpildytas, prarasta ${droppedNow} įrašų`),
            );
        }
    } catch (error) {
        noteError(error);
    } finally {
        flushing = false;
    }
}

/** @param {Record<string, unknown>} doc */
export function enqueueSqlLog(doc) {
    if (!sqlLogQuickwitEnabled) return;

    buffer.push(doc);
    if (buffer.length > MAX_BUFFER) {
        dropped += buffer.length - MAX_BUFFER;
        buffer = buffer.slice(-MAX_BUFFER);
    }

    if (buffer.length >= BATCH_SIZE) {
        void flushSqlLog();
        return;
    }
    if (!timer) {
        timer = setInterval(() => {
            void flushSqlLog();
        }, FLUSH_INTERVAL_MS);
        // Kad neluktų proceso pabaigos.
        timer.unref?.();
    }
}

/**
 * Senų dienos indeksų valymas – vietoj retention politikos. Ištrina visus
 * `sqlLogV2_YYYY-MM-DD` indeksus, senesnius nei `keepDays` dienų.
 *
 * @param {{ keepDays?: number, dryRun?: boolean }} [options]
 * @returns {Promise<{ deleted: string[], kept: string[] }>}
 */
export async function pruneSqlLogIndexes({ keepDays = 30, dryRun = false } = {}) {
    const res = await fetch(`${QW_URL}/api/v1/indexes`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Quickwit GET indexes → ${res.status}`);
    const indexes = await res.json();

    const riba = new Date(Date.now() - keepDays * 86_400_000)
        .toISOString()
        .slice(0, 10);

    const deleted = [];
    const kept = [];
    for (const item of indexes) {
        const indexId = item.index_config?.index_id ?? item.index_id;
        if (typeof indexId !== "string") continue;
        const data = indexId.startsWith(SQL_LOG_INDEX_PREFIX)
            ? indexId.slice(SQL_LOG_INDEX_PREFIX.length)
            : null;
        // Tik `sqlLogV2_YYYY-MM-DD` – kitokių vardų (ir senų `sqlLog_*`) neliečiam.
        if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;

        if (data >= riba) {
            kept.push(indexId);
            continue;
        }
        if (!dryRun) {
            const del = await fetch(`${QW_URL}/api/v1/indexes/${indexId}`, {
                method: "DELETE",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!del.ok && del.status !== 404) {
                throw new Error(
                    `Quickwit DELETE ${indexId} → ${del.status}: ${await del.text()}`,
                );
            }
        }
        deleted.push(indexId);
    }
    return { deleted, kept };
}

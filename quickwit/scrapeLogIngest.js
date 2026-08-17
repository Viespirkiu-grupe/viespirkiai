import fs from "node:fs";
import config from "../utils/config.js";
import { QW_URL } from "./qwHttp.js";
import { SCRAPE_LOG_INDEX_CONFIG } from "./scrapeLogIndexConfig.js";

export const SCRAPE_LOG_INDEX_PREFIX = "scrapeLogV1_";
export const SCRAPE_LOG_INDEX_PATTERN = `${SCRAPE_LOG_INDEX_PREFIX}*`;

const BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 1_000;
const MAX_BUFFER = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

const fileStream = config.scrapeLogFile
    ? fs.createWriteStream(config.scrapeLogFile, { flags: "a" })
    : null;
export const scrapeLogQuickwitEnabled =
    config.scrapeLogQuickwit === true && config.quickwitUp !== false;
export const scrapeLogEnabled = Boolean(fileStream) || scrapeLogQuickwitEnabled;

let buffer = [];
let dropped = 0;
let flushing = false;
let timer = null;
let lastErrorLoggedAt = 0;
const ensuredIndexes = new Map();

export function scrapeLogIndexId(ts) {
    const iso = typeof ts === "string" ? ts : new Date(ts).toISOString();
    return `${SCRAPE_LOG_INDEX_PREFIX}${iso.slice(0, 10)}`;
}

async function ensureIndex(indexId) {
    const existing = await fetch(`${QW_URL}/api/v1/indexes/${indexId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (existing.ok) return;
    if (existing.status !== 404) throw new Error(`Quickwit GET indexes/${indexId} → ${existing.status}`);

    const yaml = SCRAPE_LOG_INDEX_CONFIG.replace(/^index_id:.*$/m, `index_id: ${indexId}`);
    const created = await fetch(`${QW_URL}/api/v1/indexes`, {
        method: "POST",
        headers: { "Content-Type": "application/yaml" },
        body: yaml,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!created.ok && created.status !== 400) {
        throw new Error(`Quickwit create index ${indexId} → ${created.status}: ${await created.text()}`);
    }
    if (created.status === 400) {
        // 400 gali būti lenktynės su kitu procesu, bet gali būti ir bloga schema.
        // Patikrinam, ar indeksas po atsakymo iš tiesų egzistuoja.
        const raced = await fetch(`${QW_URL}/api/v1/indexes/${indexId}`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!raced.ok) {
            throw new Error(`Quickwit create index ${indexId} → 400: ${await created.text()}`);
        }
    }
}

function noteError(error) {
    const now = Date.now();
    if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLoggedAt = now;
    console.warn(`[scrapeLog→quickwit] ${error?.message ?? error}`);
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
        ensuredIndexes.delete(indexId);
        throw error;
    }
    const res = await fetch(`${QW_URL}/api/v1/${indexId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: docs.map((doc) => JSON.stringify(doc)).join("\n"),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ingest ${indexId} → ${res.status}`);
}

export async function flushScrapeLog() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer;
    buffer = [];
    const droppedNow = dropped;
    dropped = 0;
    try {
        const byDay = new Map();
        for (const doc of batch) {
            const indexId = scrapeLogIndexId(doc.ts);
            const docs = byDay.get(indexId);
            if (docs) docs.push(doc);
            else byDay.set(indexId, [doc]);
        }
        for (const [indexId, docs] of byDay) await ingestDay(indexId, docs);
        if (droppedNow) noteError(new Error(`buferis perpildytas, prarasta ${droppedNow} įrašų`));
    } catch (error) {
        noteError(error);
    } finally {
        flushing = false;
    }
}

export function enqueueScrapeLog(doc) {
    if (fileStream) fileStream.write(JSON.stringify(doc) + "\n");
    if (!scrapeLogQuickwitEnabled) return;
    buffer.push(doc);
    if (buffer.length > MAX_BUFFER) {
        dropped += buffer.length - MAX_BUFFER;
        buffer = buffer.slice(-MAX_BUFFER);
    }
    if (buffer.length >= BATCH_SIZE) void flushScrapeLog();
    if (!timer) {
        timer = setInterval(() => void flushScrapeLog(), FLUSH_INTERVAL_MS);
        timer.unref?.();
    }
}

export async function pruneScrapeLogIndexes({ keepDays = 30, dryRun = false } = {}) {
    const res = await fetch(`${QW_URL}/api/v1/indexes`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Quickwit GET indexes → ${res.status}`);
    const indexes = await res.json();
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
    const deleted = [];
    const kept = [];
    for (const item of indexes) {
        const indexId = item.index_config?.index_id ?? item.index_id;
        const date = typeof indexId === "string" && indexId.startsWith(SCRAPE_LOG_INDEX_PREFIX)
            ? indexId.slice(SCRAPE_LOG_INDEX_PREFIX.length)
            : null;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (date >= cutoff) kept.push(indexId);
        else {
            if (!dryRun) {
                const del = await fetch(`${QW_URL}/api/v1/indexes/${indexId}`, {
                    method: "DELETE",
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
                if (!del.ok && del.status !== 404) throw new Error(`Quickwit DELETE ${indexId} → ${del.status}`);
            }
            deleted.push(indexId);
        }
    }
    return { deleted, kept };
}

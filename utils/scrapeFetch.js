import crypto from "node:crypto";
import net from "node:net";
import { Transform } from "node:stream";
import { APP_ENV, APP_ROLE } from "./runtimeContext.js";
import {
    enqueueScrapeLog,
    scrapeLogEnabled,
} from "../quickwit/scrapeLogIngest.js";

const MAX_PATH_LENGTH = 4_096;
const SECRET_QUERY_KEY = /(?:^|[_-])(api[_-]?key|access[_-]?token|token|secret|signature|sig|password|pass|auth|code)(?:$|[_-])/i;

function registrableDomain(hostname) {
    const value = String(hostname ?? "").replace(/^\[|\]$/g, "").toLowerCase();
    if (!value || value === "localhost" || net.isIP(value)) return value;
    const parts = value.split(".").filter(Boolean);
    return parts.length > 1 ? parts.slice(-2).join(".") : value;
}

function safePath(url) {
    for (const key of [...new Set(url.searchParams.keys())]) {
        if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    const path = url.pathname + url.search;
    return path.length > MAX_PATH_LENGTH
        ? path.slice(0, MAX_PATH_LENGTH - 1) + "…"
        : path;
}

/**
 * Išskaido URL į saugius, Quickwit'e patogiai grupuojamus laukus.
 * Pilnas URL sąmoningai nesaugomas.
 */
export function scrapeAddressParts(input) {
    const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;
    try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        return {
            scheme: url.protocol.replace(/:$/, ""),
            host: url.host,
            domain: registrableDomain(url.hostname),
            path: safePath(url),
        };
    } catch {
        return { scheme: "", host: "", domain: "", path: String(raw ?? "").slice(0, MAX_PATH_LENGTH) };
    }
}

function numericContentLength(response) {
    const raw = response.headers?.get?.("content-length");
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function chunkBytes(chunk) {
    if (typeof chunk === "string") return Buffer.byteLength(chunk);
    return chunk?.byteLength ?? chunk?.length ?? 0;
}

function errorFields(error) {
    const code = error?.code ?? error?.cause?.code;
    return {
        errorName: String(error?.name || "Error").slice(0, 100),
        ...(code ? { errorCode: String(code).slice(0, 100) } : {}),
    };
}

function responseProxy(original, body) {
    const wrapped = new original.constructor(body, {
        status: original.status,
        statusText: original.statusText,
        headers: original.headers,
        size: original.size,
        counter: original.counter,
        highWaterMark: original.highWaterMark,
    });
    return new Proxy(wrapped, {
        get(target, property) {
            if (["url", "redirected", "type"].includes(property)) {
                return Reflect.get(original, property, original);
            }
            if (!(property in target) && property in original) {
                const value = Reflect.get(original, property, original);
                return typeof value === "function" ? value.bind(original) : value;
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function webCountingBody(body, addBytes, finish) {
    const reader = body.getReader();
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    finish();
                    controller.close();
                    return;
                }
                addBytes(chunkBytes(value));
                controller.enqueue(value);
            } catch (error) {
                finish({ error });
                controller.error(error);
            }
        },
        async cancel(reason) {
            try {
                await reader.cancel(reason);
            } finally {
                finish({ cancelled: true });
            }
        },
    });
}

function nodeCountingBody(body, addBytes, finish) {
    const counter = new Transform({
        transform(chunk, encoding, callback) {
            addBytes(chunkBytes(chunk));
            callback(null, chunk);
        },
        flush(callback) {
            finish();
            callback();
        },
        destroy(error, callback) {
            if (error) finish({ error });
            else if (!counter.readableEnded) finish({ cancelled: true });
            callback(error);
        },
    });
    body.on("error", (error) => finish({ error }));
    return body.pipe(counter);
}

/**
 * Sukuria scrape fetch wrapperį. `options` skirtas testams ir nestandartiniam
 * transportui; įprastame kode naudojamas žemiau eksportuojamas `scrapeFetch`.
 */
const dynamicGlobalFetch = (...args) => globalThis.fetch(...args);

/** @param {(...args: any[]) => Promise<any>} [fetchImpl] */
export function createScrapeFetch(fetchImpl = dynamicGlobalFetch, {
    enabled = scrapeLogEnabled,
    emit = enqueueScrapeLog,
    defaultMeta = {},
} = {}) {
    return async function scrapeFetchWithContext(input, init, meta = {}) {
        if (!enabled) return fetchImpl(input, init);

        const startedAt = new Date();
        const started = performance.now();
        const context = { ...defaultMeta, ...meta };
        const base = {
            ts: startedAt.toISOString(),
            requestId: crypto.randomUUID(),
            env: APP_ENV,
            role: APP_ROLE,
            scraper: String(context.scraper || "unknown").slice(0, 100),
            operation: String(context.operation || "request").slice(0, 100),
            ...(context.item != null ? { item: String(context.item).slice(0, 500) } : {}),
            method: String(init?.method ?? input?.method ?? "GET").toUpperCase(),
            ...scrapeAddressParts(input),
        };

        let response;
        try {
            response = await fetchImpl(input, init);
        } catch (error) {
            emit({
                ...base,
                status: null,
                ok: false,
                ttfbMs: Number((performance.now() - started).toFixed(1)),
                ms: Number((performance.now() - started).toFixed(1)),
                bytes: 0,
                ...errorFields(error),
            });
            throw error;
        }

        const ttfbMs = performance.now() - started;
        const finalAddress = scrapeAddressParts(response.url || input);
        const addressChanged = finalAddress.scheme !== base.scheme
            || finalAddress.host !== base.host
            || finalAddress.path !== base.path;
        let bytes = 0;
        let finished = false;
        const finish = ({ error, cancelled = false } = {}) => {
            if (finished) return;
            finished = true;
            emit({
                ...base,
                status: response.status,
                ok: response.ok && !error && !cancelled,
                redirected: Boolean(response.redirected),
                ...(addressChanged ? {
                    finalScheme: finalAddress.scheme,
                    finalHost: finalAddress.host,
                    finalDomain: finalAddress.domain,
                    finalPath: finalAddress.path,
                } : {}),
                ttfbMs: Number(ttfbMs.toFixed(1)),
                ms: Number((performance.now() - started).toFixed(1)),
                bytes,
                ...(numericContentLength(response) != null
                    ? { contentLength: numericContentLength(response) }
                    : {}),
                ...(cancelled ? { cancelled: true } : {}),
                ...(error ? errorFields(error) : {}),
            });
        };
        const addBytes = (count) => { bytes += count; };

        if (!response.body) {
            finish();
            return response;
        }

        try {
            if (typeof response.body.getReader === "function") {
                return responseProxy(response, webCountingBody(response.body, addBytes, finish));
            }
            if (typeof response.body.pipe === "function") {
                return responseProxy(response, nodeCountingBody(response.body, addBytes, finish));
            }
        } catch (error) {
            // Nesuderinamas Response konstruktorius neturi griauti scraperio.
            finish({ error });
            return response;
        }

        finish();
        return response;
    };
}

export const scrapeFetch = createScrapeFetch();

/** Patogus standartinės fetch signatūros klientas vienam scraperio moduliui. */
export function createScraperFetch(scraper, {
    operation = "request",
    fetchImpl = dynamicGlobalFetch,
} = {}) {
    return createScrapeFetch(fetchImpl, { defaultMeta: { scraper, operation } });
}

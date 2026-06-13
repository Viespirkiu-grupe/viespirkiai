import config from "../../utils/config.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const TOKEN_REFRESH_MARGIN_S = 30;

function joinUrl(base, path) {
    const b = base.replace(/\/+$/, "");
    const p = path.replace(/^\/+/, "");
    return `${b}/${p}`;
}

function defaultScopes() {
    return [
        "spinta_getone",
        "spinta_getall",
        "spinta_search",
        "spinta_changes",
        "spinta_insert",
        "spinta_upsert",
        "spinta_update",
        "spinta_patch",
        "spinta_delete",
        "spinta_set_meta_fields",
    ];
}

/**
 * Spinta / Stalčius API client.
 *
 * Both servers share the same write protocol (NDJSON `_op` batches, `_where`
 * upserts, ref `{_id}`), differing only in authentication:
 *   - Spinta:   OAuth client-credentials token, cached and auto-refreshed.
 *   - Stalčius: a single static API key sent as `Authorization: Bearer …`.
 *
 * If an API key is configured it is used directly and the OAuth token endpoint
 * is never touched; otherwise the OAuth client-credentials flow is used.
 *
 * - JSON helpers for `getone`, `insert`, `patch`, `delete`.
 * - NDJSON helper for bulk `_op` batches.
 * - Retries transient failures (network, 5xx, 429).
 */
export function createSpintaClient(options = {}) {
    const server   = options.server    || config.spintaServer;
    const apiKey   = options.apiKey    || config.spintaApiKey || "";
    const client   = options.client    || config.spintaClient;
    const secret   = options.secret    || config.spintaSecret;
    const namespace = (options.namespace ?? config.spintaNamespace ?? "").replace(/^\/+|\/+$/g, "");
    const scopes   = options.scopes && options.scopes.length
        ? options.scopes
        : (config.spintaScopes?.length ? config.spintaScopes : defaultScopes());
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? 5;

    if (!server) throw new Error("Spinta: spintaServer not configured");
    if (!apiKey && (!client || !secret)) {
        throw new Error("Spinta/Stalčius: configure spintaApiKey (Stalčius) or spintaClient/spintaSecret (Spinta OAuth)");
    }

    let cachedToken = null;          // { accessToken, expiresAt } — OAuth tik

    async function fetchToken() {
        const body = new URLSearchParams({
            grant_type: "client_credentials",
            scope: scopes.join(" "),
        });
        const auth = Buffer.from(`${client}:${secret}`).toString("base64");
        const res = await fetch(joinUrl(server, "auth/token"), {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Spinta auth failed: ${res.status} ${text}`);
        }
        const json = await res.json();
        const expiresIn = Number(json.expires_in) || 3600;
        cachedToken = {
            accessToken: json.access_token,
            expiresAt: Date.now() + (expiresIn - TOKEN_REFRESH_MARGIN_S) * 1000,
        };
        return cachedToken.accessToken;
    }

    async function getToken({ forceRefresh = false } = {}) {
        if (apiKey) return apiKey;
        if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
            return cachedToken.accessToken;
        }
        return fetchToken();
    }

    function modelPath(model) {
        if (model.startsWith("/")) return model.slice(1);
        if (model.includes("/")) return model;
        return namespace ? `${namespace}/${model}` : model;
    }

    async function request(method, path, { body, contentType, query, retries = maxRetries } = {}) {
        const url = new URL(joinUrl(server, path));
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
            }
        }

        let attempt = 0;
        let lastError;
        while (attempt <= retries) {
            const token = await getToken({ forceRefresh: attempt > 0 && lastError?.status === 401 });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, {
                    method,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "application/json",
                        ...(contentType ? { "Content-Type": contentType } : {}),
                    },
                    body,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (res.status === 401 && attempt < retries && !apiKey) {
                    cachedToken = null;
                    lastError = Object.assign(new Error("401 Unauthorized"), { status: 401 });
                    attempt++;
                    continue;
                }
                if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                    const backoff = Math.min(30_000, 500 * 2 ** attempt);
                    await new Promise((r) => setTimeout(r, backoff));
                    attempt++;
                    continue;
                }

                const text = await res.text();
                const json = text ? safeJson(text) : null;
                if (!res.ok) {
                    const err = new Error(`Spinta ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
                    err.status = res.status;
                    err.body = json ?? text;
                    throw err;
                }
                return json;
            } catch (err) {
                clearTimeout(timer);
                const code = err.code || err.cause?.code;
                const transient =
                    err.name === "AbortError" ||
                    err.name === "TypeError" && /fetch failed/i.test(err.message) ||
                    code === "ECONNRESET" ||
                    code === "ETIMEDOUT" ||
                    code === "ECONNREFUSED" ||
                    code === "EAI_AGAIN" ||
                    code === "UND_ERR_SOCKET" ||
                    code === "UND_ERR_CONNECT_TIMEOUT";
                if (transient && attempt < retries) {
                    const backoff = Math.min(30_000, 1000 * 2 ** attempt);
                    await new Promise((r) => setTimeout(r, backoff));
                    attempt++;
                    lastError = err;
                    continue;
                }
                throw err;
            }
        }
        throw lastError || new Error("Spinta: exhausted retries");
    }

    function safeJson(text) {
        try { return JSON.parse(text); } catch { return null; }
    }

    return {
        get server() { return server; },
        get namespace() { return namespace; },
        getToken,
        request,

        async getOne(model, id) {
            return request("GET", `${modelPath(model)}/${id}`);
        },

        async getAll(model, filters = {}) {
            return request("GET", modelPath(model), { query: filters });
        },

        async insert(model, data) {
            return request("POST", modelPath(model), {
                body: JSON.stringify(data),
                contentType: "application/json",
            });
        },

        async patch(model, id, revision, data) {
            return request("PATCH", `${modelPath(model)}/${id}`, {
                body: JSON.stringify({ _revision: revision, ...data }),
                contentType: "application/json",
            });
        },

        async delete(model, id) {
            return request("DELETE", `${modelPath(model)}/${id}`);
        },

        /**
         * Send a batch of NDJSON operations to a model endpoint.
         * `ops` is an array of objects; each must include `_op` (insert/upsert/patch/delete/update).
         * Returns the server response (HTTP 207 with per-row statuses).
         */
        async batch(model, ops) {
            if (!ops.length) return { _data: [] };
            const ndjson = ops.map((op) => JSON.stringify(op)).join("\n") + "\n";
            return request("POST", modelPath(model), {
                body: ndjson,
                contentType: "application/x-ndjson",
            });
        },

        modelPath,
    };
}

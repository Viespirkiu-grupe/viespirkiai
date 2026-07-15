import { WebSocket, WebSocketServer } from "ws";
import config from "../../utils/config.js";
import {
    countSutartys,
    countSutartysQuickwit,
    iterateSutartysQuickwitExport,
    searchSutartys,
} from "./searchSutartys.js";
import {
    buildAnalizeXlsx,
    canExportAnalizeXlsx,
    XLSX_EXPORT_LIMIT,
} from "./analize.js";

const EXPORT_PATH = "/ws/sutartys/export";
const FRAME = { progress: 1, fileStart: 2, fileChunk: 3, complete: 4, error: 5 };
const encoder = new TextEncoder();

function frame(type, payload = new Uint8Array()) {
    const body = payload instanceof Uint8Array
        ? payload
        : encoder.encode(typeof payload === "string" ? payload : JSON.stringify(payload));
    const result = new Uint8Array(5 + body.byteLength);
    result[0] = type;
    new DataView(result.buffer).setUint32(1, body.byteLength, false);
    result.set(body, 5);
    return result;
}

function send(ws, type, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new DOMException("Eksporto jungtis nutrūko", "AbortError"));
    }
    return new Promise((resolve, reject) => {
        ws.send(frame(type, payload), { binary: true }, (error) => error ? reject(error) : resolve());
    });
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}

function csvRow(row) {
    return {
        "Tipas": row.tipas ?? "",
        "Kategorija": row.kategorija ?? "",
        "Pavadinimas": row.pavadinimas ?? "",
        "Numatyta vertė": row.verte ?? "",
        "Faktinė vertė": row.faktineVerte ?? "",
        "Pirkėjo pavadinimas": row.perkanciojiOrganizacija ?? "",
        "Pirkėjo kodas": row.perkanciosiosOrganizacijosKodas ?? "",
        "Tiekėjų pavadinimai": Array.isArray(row.tiekejai) ? row.tiekejai.join("; ") : "",
        "Tiekėjų kodai": Array.isArray(row.tiekejaiKodai) ? row.tiekejaiKodai.join("; ") : "",
        "Sudarymo data": formatDate(row.sudarymoData),
        "Faktinė įvykdymo data": formatDate(row.faktineIvykdymoData),
        "Redagavimo data": formatDate(row.paskutinioRedagavimoData),
        "BVPZ kodai": Array.isArray(row.bvpzKodai) ? row.bvpzKodai.filter(Boolean).join("; ") : "",
        "Sutarties numeris": row.sutartiesNumeris ?? "",
        "Unikalus ID": row.sutartiesUnikalusId ?? "",
    };
}

function csvLine(values) {
    return values.map((value) => {
        const text = value == null ? "" : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(",") + "\n";
}

function requestUrl(request) {
    const protocol = String(request.headers["x-forwarded-proto"] || "http").split(",")[0];
    return new URL(request.url || EXPORT_PATH, `${protocol}://${request.headers.host || "localhost"}`);
}

function hasAllowedOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        const originHost = new URL(origin).host;
        const requestHost = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
        return originHost === requestHost;
    } catch {
        return false;
    }
}

function exportQuery(url) {
    const query = Object.fromEntries([...url.searchParams].filter(([, value]) => value !== ""));
    ["format", "jsonl", "csv", "xlsx", "exportStream", "limit", "page"].forEach((key) => delete query[key]);
    if (query.sort?.includes(":")) {
        const [field, direction] = query.sort.split(":");
        query.sort = field;
        if (direction) query.sortDir = direction;
    }
    return query;
}

async function runExport(ws, request, signal) {
    const url = requestUrl(request);
    const requestedFormat = url.searchParams.get("format")
        || (url.searchParams.has("xlsx") ? "xlsx" : url.searchParams.has("csv") ? "csv" : "jsonl");
    if (!["jsonl", "csv", "xlsx"].includes(requestedFormat)) {
        throw new Error("Nežinomas eksporto formatas.");
    }

    const format = requestedFormat;
    const query = exportQuery(url);
    const engine = config.quickwitUp ? "quickwit" : "postgres";
    const total = engine === "quickwit"
        ? await countSutartysQuickwit(query)
        : await countSutartys(query);
    if (!canExportAnalizeXlsx(total)) {
        throw new Error(`Eksportas galimas iki ${XLSX_EXPORT_LIMIT.toLocaleString("lt-LT")} sutarčių. Pagal pasirinktus filtrus rasta ${total.toLocaleString("lt-LT")}.`);
    }

    const contentType = format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8";
    const filename = format === "xlsx"
        ? `viespirkiai-analize-${new Date().toISOString()}.xlsx`
        : `viespirkiai-${new Date().toISOString()}.${format}`;

    await send(ws, FRAME.progress, { phase: "searching", processed: 0, total, percent: 0 });
    if (format !== "xlsx") await send(ws, FRAME.fileStart, { filename, contentType });

    const rows = [];
    let processed = 0;
    let csvHeaders = null;
    let textBuffer = "";
    let transferredBytes = 0;
    const source = engine === "quickwit"
        ? iterateSutartysQuickwitExport(query, { limit: XLSX_EXPORT_LIMIT, signal })
        : (async function* () {
            const result = await searchSutartys(query, {
                limit: XLSX_EXPORT_LIMIT,
                page: 1,
                stream: true,
                sort: false,
                engine,
            });
            try {
                for await (const row of result.stream) {
                    if (signal.aborted) throw new DOMException("Exportas atšauktas", "AbortError");
                    yield row;
                }
            } finally {
                result.stream?.destroy();
                result.client?.release();
            }
        })();

    for await (const row of source) {
        if (signal.aborted) throw new DOMException("Exportas atšauktas", "AbortError");
        processed++;
        if (format === "xlsx") {
            rows.push(row);
        } else if (format === "jsonl") {
            textBuffer += JSON.stringify(row) + "\n";
        } else {
            const mapped = csvRow(row);
            if (!csvHeaders) {
                csvHeaders = Object.keys(mapped);
                textBuffer += csvLine(csvHeaders);
            }
            textBuffer += csvLine(csvHeaders.map((key) => mapped[key]));
        }

        if (processed % 500 === 0) {
            if (textBuffer) {
                const chunk = encoder.encode(textBuffer);
                transferredBytes += chunk.byteLength;
                await send(ws, FRAME.fileChunk, chunk);
                textBuffer = "";
            }
            await send(ws, FRAME.progress, {
                phase: "searching",
                processed,
                total,
                percent: total ? Math.min(99, Math.round(processed / total * 100)) : 0,
                downloadedBytes: transferredBytes || undefined,
            });
        }
    }

    if (textBuffer) {
        const chunk = encoder.encode(textBuffer);
        transferredBytes += chunk.byteLength;
        await send(ws, FRAME.fileChunk, chunk);
    }
    await send(ws, FRAME.progress, {
        phase: "collected",
        processed,
        total: processed,
        percent: 100,
        downloadedBytes: transferredBytes || undefined,
    });

    if (format === "xlsx") {
        await send(ws, FRAME.progress, { phase: "formatting", processed, total, percent: 100 });
        const viewUrl = new URL(url);
        viewUrl.pathname = "/";
        ["format", "xlsx", "csv", "jsonl", "exportStream", "limit", "page"].forEach((key) => viewUrl.searchParams.delete(key));
        const xlsx = new Uint8Array(buildAnalizeXlsx(rows, {
            exportedAt: new Date(),
            viewUrl: viewUrl.toString(),
            filters: viewUrl.searchParams.toString(),
        }));
        if (signal.aborted) throw new DOMException("Exportas atšauktas", "AbortError");
        await send(ws, FRAME.fileStart, { filename, contentType, size: xlsx.byteLength });
        for (let offset = 0; offset < xlsx.byteLength; offset += 64 * 1024) {
            const chunk = xlsx.subarray(offset, offset + 64 * 1024);
            await send(ws, FRAME.fileChunk, chunk);
            const downloaded = Math.min(offset + chunk.byteLength, xlsx.byteLength);
            await send(ws, FRAME.progress, {
                phase: "downloading",
                processed,
                total,
                percent: Math.round(downloaded / xlsx.byteLength * 100),
                downloadedBytes: downloaded,
                totalBytes: xlsx.byteLength,
            });
        }
    }

    await send(ws, FRAME.progress, { phase: "complete", processed, total: processed, percent: 100 });
    await send(ws, FRAME.complete);
}

export function attachSutartysExportWebSocket(server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

    server.on("upgrade", (request, socket, head) => {
        let url;
        try {
            url = requestUrl(request);
        } catch {
            socket.destroy();
            return;
        }
        if (url.pathname !== EXPORT_PATH) return;
        if (!hasAllowedOrigin(request)) {
            socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    });

    wss.on("connection", (ws, request) => {
        const abort = new AbortController();
        let awaitingPong = false;
        ws.on("pong", () => { awaitingPong = false; });
        ws.once("close", () => abort.abort());
        ws.once("error", () => abort.abort());

        const heartbeat = setInterval(() => {
            if (awaitingPong) {
                ws.terminate();
                return;
            }
            awaitingPong = true;
            ws.ping();
        }, 15_000);

        void runExport(ws, request, abort.signal)
            .then(() => {
                if (ws.readyState === WebSocket.OPEN) ws.close(1000, "Eksportas baigtas");
            })
            .catch(async (error) => {
                if (!abort.signal.aborted && ws.readyState === WebSocket.OPEN) {
                    await send(ws, FRAME.error, {
                        message: error instanceof Error ? error.message : "Eksporto klaida",
                    }).catch(() => {});
                    ws.close(1011, "Eksporto klaida");
                }
            })
            .finally(() => clearInterval(heartbeat));
    });

    return wss;
}

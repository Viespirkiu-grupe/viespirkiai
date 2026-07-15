import { parentPort } from "node:worker_threads";
import { parseSutartysHtml } from "./parsePage.js";

if (!parentPort) throw new Error("parsePageWorker must run in a worker thread");

parentPort.on("message", ({ id, html, htmlBuffer }) => {
    try {
        const source = htmlBuffer
            ? new TextDecoder().decode(htmlBuffer)
            : html;
        parentPort.postMessage({ id, result: parseSutartysHtml(source) });
    } catch (error) {
        parentPort.postMessage({
            id,
            error: {
                name: error?.name ?? "Error",
                message: error?.message ?? String(error),
                stack: error?.stack,
            },
        });
    }
});

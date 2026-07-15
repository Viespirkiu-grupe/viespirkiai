import { Worker } from "node:worker_threads";

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function rejectPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
}

function getWorker() {
    if (worker) return worker;

    const instance = new Worker(new URL("./parsePageWorker.js", import.meta.url), {
        type: "module",
    });
    worker = instance;
    instance.unref();

    instance.on("message", ({ id, result, error }) => {
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);

        if (error) {
            const parsedError = new Error(error.message);
            parsedError.name = error.name;
            if (error.stack) parsedError.stack = error.stack;
            request.reject(parsedError);
        } else {
            request.resolve(result);
        }

        if (pending.size === 0) instance.unref();
    });

    instance.on("error", (error) => {
        if (worker === instance) worker = null;
        rejectPending(error);
    });

    instance.on("exit", (code) => {
        if (worker === instance) worker = null;
        if (pending.size > 0) {
            rejectPending(new Error(`Sutarčių HTML parser worker exited with code ${code}`));
        }
    });

    return instance;
}

/** Parse one contracts page away from the main Node.js event loop. */
export function parseSutartysHtmlInWorker(html) {
    const isString = typeof html === "string";
    const isArrayBuffer = html instanceof ArrayBuffer;
    if (!isString && !isArrayBuffer) {
        return Promise.reject(new TypeError("HTML must be a string or ArrayBuffer"));
    }

    const instance = getWorker();
    const id = nextRequestId++;
    instance.ref();

    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
            if (isArrayBuffer) {
                instance.postMessage({ id, htmlBuffer: html }, [html]);
            } else {
                instance.postMessage({ id, html });
            }
        } catch (error) {
            pending.delete(id);
            if (pending.size === 0) instance.unref();
            reject(error);
        }
    });
}

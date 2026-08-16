import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createScraperFetch } from "../../../utils/scrapeFetch.js";

const scrapeFetch = createScraperFetch("juridiniai", {
    operation: "importJarPapildomiDuomenys",
});

function requestHeaders() {
    return {
        accept: "text/csv, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Mozilla/5.0 (compatible; viespirkiai.org JAR importer)",
    };
}

function responseMetadata(response) {
    const rawSize = response.headers.get("content-length");
    const size = rawSize == null ? null : Number(rawSize);
    return {
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    };
}

export function metadataUnchanged(previous, current) {
    if (!previous) return false;
    if (previous.etag && current.etag) return previous.etag === current.etag;
    if (previous.lastModified && current.lastModified) {
        return new Date(previous.lastModified).getTime() ===
            new Date(current.lastModified).getTime() &&
            (previous.size == null || current.size == null ||
                Number(previous.size) === Number(current.size));
    }
    return false;
}

export async function fetchMetadata(source) {
    const response = await scrapeFetch(source.url, {
        method: "HEAD",
        headers: requestHeaders(),
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        if (response.status === 405 || response.status === 501) {
            return { etag: null, lastModified: null, size: null };
        }
        throw new Error(`${source.file}: HEAD HTTP ${response.status}`);
    }
    return responseMetadata(response);
}

export async function downloadSource(source, path) {
    const response = await scrapeFetch(source.url, {
        headers: requestHeaders(),
        signal: AbortSignal.timeout(60 * 60_000),
    });
    if (!response.ok || !response.body) {
        throw new Error(`${source.file}: HTTP ${response.status}`);
    }
    const hash = createHash("sha256");
    const hasher = new Transform({
        transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(response.body), hasher, createWriteStream(path));
    return { sha256: hash.digest("hex"), ...responseMetadata(response) };
}


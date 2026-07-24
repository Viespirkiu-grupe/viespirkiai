import { execFile } from "child_process";
import { promisify } from "util";
import { createInterface } from "readline";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import config from "../../utils/config.js";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { iEile } from "./nuskaitymoEile.js";

const execFileAsync = promisify(execFile);

const MIME_TO_EXTENSION = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        "docx",
    "application/msword": "doc",
    "image/jpeg": "jpeg",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.ms-excel": "xls",
    "application/x-7z-compressed": "7z",
    "image/tiff": "tiff",
    "image/x-portable-bitmap": "bmp",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        "pptx",
    "video/quicktime": "mp4",
    "image/png": "png",
    "video/mp4": "mp4",
    "image/bmp": "bmp",
    "image/vnd.dwg": "dwg",
    "application/zip": "zip",
    "application/x-rar": "rar",
    "text/rtf": "rtf",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "text/xml": "xml"
};

const EBVPD_ESPD_RE = /(ebvpd|espd)/i;
const EBVPD_ESPD_MIME_TO_EXTENSION = {
    "application/xml": "xml",
    "text/xml": "xml",
    "application/zip": "zip",
    "application/x-zip": "zip",
    "application/x-zip-compressed": "zip",
};

const MIME_DETECT_BYTES = 1024 * 1024; // 1MB
const APPLY = process.argv.includes("--apply");
const ASK = process.argv.includes("--ask");
const BOTTOM_UP = process.argv.includes("--bottom-up");
const arg = process.argv.find((a) => a.startsWith("--extension="));
const EXTENSION = arg !== undefined ? arg.slice("--extension=".length) : undefined;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((resolve) => rl.question(q, resolve));
async function ask(question) {
    const answer = await prompt(`${question} [y/n] `);
    return answer.trim().toLowerCase() === "y";
}

async function detectMimeType(id) {
    const url = `${config.internalFileBase}/${id}`;
    let tmpPath = null;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            logger.log(`SKIP  id=${id} — HTTP ${response.status}`);
            return null;
        }
        const contentLength = Number(
            response.headers.get("content-length") ?? 0,
        );
        if (contentLength === 0) {
            logger.log(`SKIP  id=${id} — 0 bytes`);
            await response.body?.cancel();
            return null;
        }
        const reader = response.body.getReader();
        let bytes = new Uint8Array(0);
        while (bytes.length < MIME_DETECT_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            const merged = new Uint8Array(bytes.length + value.length);
            merged.set(bytes);
            merged.set(value, bytes.length);
            bytes = merged;
        }
        await reader.cancel();
        tmpPath = join(tmpdir(), `viespirkiai_mime_${id}`);
        await writeFile(tmpPath, bytes.slice(0, MIME_DETECT_BYTES));
        const { stdout } = await execFileAsync("file", [
            "--mime-type",
            "-b",
            tmpPath,
        ]);
        return stdout.trim();
    } catch (err) {
        logger.log(`SKIP  id=${id} — ${err.message}`);
        return null;
    } finally {
        if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
}

let totalInspected = 0;
let totalFixed = 0;
let totalSkipped = 0;
const unknownMimes = new Map();

const { rows: extRows } = await postgres.query(
    `SELECT lower(extension) AS extension, count
     FROM "failaiStatsExtension"
     WHERE count <= 10
     ORDER BY count ${BOTTOM_UP ? "ASC" : "DESC"}`,
);
const uniqueExts = extRows.map((r) => r.extension);

async function processRows(rows) {
    for (const row of rows) {
        const currentExt = (row.extension ?? "").replace(/^\./, "");
        const isEbvpdOrEspd = EBVPD_ESPD_RE.test(row.pavadinimas ?? "");
        logger.log(
            `Processing id=${row.id} "${row.pavadinimas}" (extension: "${currentExt}")`,
        );

        const mime = await detectMimeType(row.id);
        if (!mime) {
            totalSkipped++;
            continue;
        }
        logger.log(`id=${row.id} — detected mime: ${mime}`);

        const detectedExt =
            MIME_TO_EXTENSION[mime] ??
            (isEbvpdOrEspd ? EBVPD_ESPD_MIME_TO_EXTENSION[mime] : undefined);
        if (!detectedExt) {
            unknownMimes.set(mime, (unknownMimes.get(mime) ?? 0) + 1);
            totalSkipped++;
            continue;
        }

        if (currentExt === detectedExt) {
            logger.log(`SKIP  id=${row.id} — extension already correct`);
            totalSkipped++;
            continue;
        }

        logger.log(
            `FIX   id=${row.id} "${row.pavadinimas}" — "${currentExt || "(none)"}" → "${detectedExt}"${APPLY ? "" : " [dry-run]"}`,
        );

        if (APPLY) {
            if (ASK && !(await ask(`  Apply fix for id=${row.id}?`))) {
                logger.log(`SKIP  id=${row.id} — skipped by user`);
                totalSkipped++;
                continue;
            }
            await postgres.query(
                `UPDATE failai SET extension = $1 WHERE id = $2`,
                [detectedExt, row.id],
            );
            // Pasikeitęs plėtinys gali failą padaryti nuskaitomu
            await iEile([row.id]);
        }

        totalFixed++;
    }
}

if (BOTTOM_UP) {
    for (const extRow of extRows) {
        const ext = extRow.extension;
        const { rows } = await postgres.query(
            `SELECT id, pavadinimas, lower(extension) AS extension
             FROM failai
             WHERE (parsiustas = 1 OR parsiustas = -5)
               AND lower(extension) = $1`,
            [ext],
        );
        if (rows.length === 0) continue;

        logger.log(`\nExtension "${ext}" — ${rows.length} file(s):`);
        for (const r of rows) logger.log(`  id=${r.id} "${r.pavadinimas}"`);

        totalInspected += rows.length;
        await processRows(rows);
    }
} else if (EXTENSION !== undefined) {
    const { rows } = await postgres.query(
        `SELECT id, pavadinimas, lower(extension) AS extension
         FROM failai
         WHERE (parsiustas = 1 OR parsiustas = -5)
           AND lower(extension) = $1`,
        [EXTENSION.toLowerCase()],
    );
    totalInspected = rows.length;
    logger.log(
        `Found ${rows.length} files to inspect (extension filter: "${EXTENSION}")`,
    );
    await processRows(rows);
} else {
    const { rows } = await postgres.query(
        `SELECT id, pavadinimas, lower(extension) AS extension
         FROM failai
         WHERE (parsiustas = 1 OR parsiustas = -5)
           AND lower(extension) = ANY($1)`,
        [uniqueExts],
    );
    totalInspected = rows.length;
    logger.log(`Found ${rows.length} files to inspect`);
    await processRows(rows);
}

rl.close();

if (unknownMimes.size > 0) {
    logger.log(`Unrecognised mimes:`);
    for (const [mime, count] of [...unknownMimes.entries()].sort(
        (a, b) => b[1] - a[1],
    )) {
        logger.log(`  ${count}x ${mime}`);
    }
}
logger.log(
    `Done. inspected=${totalInspected} fixed=${totalFixed} skipped=${totalSkipped}`,
);

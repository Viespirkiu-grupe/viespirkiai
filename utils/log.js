import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const currentFile = fileURLToPath(import.meta.url);

function normalizeFileName(fileName) {
    if (typeof fileName !== "string") return null;
    return fileName.startsWith("file://") ? fileURLToPath(fileName) : fileName;
}

/**
 * Generate a pastel color based on a seed string.
 * Uses HSL to ensure pastel shades.
 * @param {string} seed - The seed string to generate the color from.
 * @returns {string} - The ANSI escape code for the generated color.
 */
function pastelColor(seed) {
    const hash = crypto
        .createHash("md5")
        .update("viespirkiai" + seed)
        .digest("hex");
    const num = parseInt(hash.slice(0, 6), 16);

    // Generate pastel HSL
    const hue = num % 360;
    const saturation = 60 + (num % 20); // 60–79%
    const lightness = 70 + (num % 10); // 70–79% (slight variation)

    return `\x1b[38;2;${hslToRgb(hue, saturation / 100, lightness / 100).join(
        ";",
    )}m`;
}

/**
 * Convert HSL to RGB.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-1)
 * @param {number} l - Lightness (0-1)
 * @returns {number[]} - Array of RGB values [r, g, b] (0-255)
 */
function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let [r, g, b] = [0, 0, 0];

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

/**
 * Get the filename of the caller function.
 * @returns {string} - The filename of the caller.
 */
function getCallerFile() {
    const origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    // stack[0] = this function, stack[1] = log(), stack[2] = caller
    const caller = stack.find((frame) => {
        const fileName = normalizeFileName(frame.getFileName());
        return typeof fileName === "string" && fileName !== currentFile;
    });
    const fileName = normalizeFileName(caller?.getFileName());
    return typeof fileName === "string" ? path.basename(fileName) : "unknown";
}

/**
 * Get the caller filename prefixed with its folder.
 * @returns {string} - folder/filename of the caller.
 */
function getCallerFileFolder() {
    const origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;

    const err = new Error();
    const stack = err.stack;

    Error.prepareStackTrace = origPrepareStackTrace;

    const caller = stack.find((frame) => {
        const fileName = normalizeFileName(frame.getFileName());
        return typeof fileName === "string" && fileName !== currentFile;
    });
    const filePath = normalizeFileName(caller?.getFileName());

    return folderFileFromPath(filePath);
}

/**
 * Build the "folder/file" label from a filesystem path (or file:// URL).
 * @param {string|null|undefined} filePath
 * @returns {string}
 */
function folderFileFromPath(filePath) {
    const normalized = normalizeFileName(filePath);
    if (typeof normalized !== "string") return "unknown";

    const dir = path.basename(path.dirname(normalized));
    const file = path.basename(normalized);
    return `${dir}/${file}`;
}

// Pastel colors are deterministic per label, so compute each once and reuse.
const colorCache = new Map();
function colorFor(caller) {
    let color = colorCache.get(caller);
    if (!color) {
        color = pastelColor(caller);
        colorCache.set(caller, color);
    }
    return color;
}

/**
 * Print one formatted line: [time] [caller] text.
 * @param {string} caller - folder/file label.
 * @param {string} color - ANSI color for the label.
 * @param {string} text - The message to log.
 */
function emit(caller, color, text) {
    // Manual HH:MM:SS (local time) — much cheaper than toLocaleTimeString/Intl.
    const now = new Date();
    const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const reset = "\x1b[0m";
    const gray = "\x1b[90m";

    console.log(`${gray}[${time}]${reset} ${color}[${caller}]${reset} ${text}`);
}

/**
 * Pad a 0–59 number to two digits without Intl/String.padStart overhead.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

/**
 * Logger bound to a single file. Resolve the "folder/file" label and its color
 * once in the constructor, then reuse them on every call — so the ~0.2ms
 * stack-trace walk happens a single time at module load, not per `log()` call.
 *
 * The caller is detected automatically from the stack at construction. Pass
 * `import.meta.url` explicitly only if you want to skip even that one-time walk.
 *
 * @example
 *   const log = new Logger();
 *   log.log("labas");
 */
export class Logger {
    /** @param {string} [metaUrl] - Optional import.meta.url to skip auto-detection. */
    constructor(metaUrl) {
        this.caller = metaUrl ? folderFileFromPath(metaUrl) : getCallerFileFolder();
        this.color = colorFor(this.caller);
    }

    /** @param {string} text - The message to log. */
    log(text) {
        emit(this.caller, this.color, text);
    }
}

/**
 * Backwards-compatible logger: infers the caller from the stack on every call.
 * Prefer `new Logger()` in hot paths — that pays the stack-trace walk once at
 * construction, whereas this variant pays it on every call.
 *
 * @param {string} text - The message to log.
 * @param {object} options - Additional options (currently unused).
 */
export function log(text, options = {}) {
    const caller = getCallerFileFolder();
    emit(caller, colorFor(caller), text);
}

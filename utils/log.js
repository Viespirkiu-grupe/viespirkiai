// logger.js
import path from "path";
import crypto from "crypto";

// Pick a pastel color based on caller filename
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

// Convert HSL → RGB
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

// Extract caller file name
function getCallerFile() {
    const origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    // stack[0] = this function, stack[1] = log(), stack[2] = caller
    const caller = stack[2];
    return path.basename(caller.getFileName());
}

export function log(text, options = {}) {
    const time = new Date().toLocaleTimeString("lt-LT", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const caller = getCallerFile();
    const color = pastelColor(caller);
    const reset = "\x1b[0m";
    const gray = "\x1b[90m";

    console.log(`${gray}[${time}]${reset} ${color}[${caller}]${reset} ${text}`);
}

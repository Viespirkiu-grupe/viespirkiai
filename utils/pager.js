// Minimalus `less` pakaitalas konsolinėms komandoms: išveda tekstą puslapiais, kai
// stdin/stdout yra TTY, kitu atveju tiesiog išspausdina viską (pipe'as, CI, testai).

const PAGER_STYLE = "\x1b[7m";
const ANSI_RESET = "\x1b[0m";
const CLEAR_LINE = "\r\x1b[2K";

function readKey(input) {
    return new Promise((resolve) => input.once("data", resolve));
}

/**
 * @param {string} text
 * @param {Object} [opts]
 * @param {{isTTY?: boolean, isRaw?: boolean, once(event: string, listener: (value: any) => void): any, setRawMode(value: boolean): any, resume(): any, pause(): any}} [opts.input]
 * @param {{isTTY?: boolean, rows?: number, write(value: string): any}} [opts.output]
 * @param {boolean} [opts.enabled] - `false` išjungia puslapiavimą priverstinai
 * @param {number|null} [opts.pageSize] - eilučių puslapyje (numatyta – terminalo aukštis)
 * @param {boolean} [opts.hasMore] - ar iškvietėjas turi dar duomenų po šio gabalo
 * @returns {Promise<boolean>} ar tęsti (false – vartotojas nutraukė arba nebėra ko rodyti)
 */
export async function writeWithPager(
    text,
    {
        input = process.stdin,
        output = process.stdout,
        enabled = true,
        pageSize = null,
        hasMore = false,
    } = {},
) {
    const lines = text.split("\n");
    const size = pageSize ?? Math.max(1, (output.rows ?? 24) - 2);
    const interactive = enabled
        && input.isTTY
        && output.isTTY
        && typeof input.setRawMode === "function"
        && (lines.length > size || hasMore);

    if (!interactive) {
        output.write(`${text}\n`);
        return hasMore;
    }

    const wasRaw = input.isRaw === true;
    let cursor = 0;
    let count = size;
    input.setRawMode(true);
    input.resume();

    try {
        while (cursor < lines.length) {
            const end = Math.min(lines.length, cursor + count);
            output.write(`${lines.slice(cursor, end).join("\n")}\n`);
            cursor = end;
            if (cursor >= lines.length && !hasMore) break;

            const percent = Math.min(
                99,
                Math.floor((cursor / lines.length) * 100),
            );
            output.write(
                `${PAGER_STYLE}-- Daugiau (${percent}%) -- `
                + `(tarpas: puslapis, Enter: eilutė, q: baigti)${ANSI_RESET}`,
            );
            const key = await readKey(input);
            output.write(CLEAR_LINE);
            const value = key.toString();
            if (value === "q" || value === "Q" || value === "\u0003") {
                return false;
            }
            if (cursor >= lines.length) return true;
            count = value === "\r" || value === "\n" ? 1 : size;
        }
    } finally {
        input.setRawMode(wasRaw);
        if (!wasRaw) input.pause();
    }
    return false;
}

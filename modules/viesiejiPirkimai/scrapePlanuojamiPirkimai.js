import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("viesiejiPirkimai", { operation: "scrapePlanuojamiPirkimai" });
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../utils/config.js";
import { log } from "../../utils/log.js";

const defaultLogger = { log };

const ENDPOINT_PATH = "/epps/app/searchPlan.do";

// Pirmas EPPS paieškoje aptiktas paskelbimas. Apatinė riba yra stabili, o
// viršutinė kiekvieno paleidimo metu nustatoma pagal Lietuvos kalendoriaus dieną.
export const FIRST_PUBLICATION_MINUTE = "2024-11-11T00:00";
export const DEFAULT_EXPORT_LIMIT = 9_000;
export const MINUTE_MS = 60_000;

const CSV_HEADERS = [
    "Pirkimo vykdytojas",
    "Pirkimo pavadinimas",
    "Aprašymas",
    "Pirkimo tipas",
    "Direktyva",
    "Pirkimo būdas",
    "BVPŽ kodai",
    "Apskaičiuota kaina",
    "Kiekiai",
    "Pirkimo pradžios data",
    "Pasiūlymų teikimo pabaigos/pradžios data",
    "Numatomos pirkimo sutarties trukmė (mėnesiais)",
    "Ketinamos sudaryti pirkimo sutarties trukmė (matavimo vienetas)",
    "Preliminari pirkimo sukūrimo data",
];

function pad(value) {
    return String(value).padStart(2, "0");
}

/** EPPS laikas laikomas Lietuvos vietiniu laiku, be UTC konvertavimo. */
export function parseLocalMinute(value) {
    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
    );
    if (!match) throw new Error(`Blogas datos formatas: ${value}`);
    const [, year, month, day, hour, minute] = match;
    const date = new Date(
        Date.UTC(+year, +month - 1, +day, +hour, +minute),
    );
    if (
        date.getUTCFullYear() !== +year ||
        date.getUTCMonth() !== +month - 1 ||
        date.getUTCDate() !== +day ||
        date.getUTCHours() !== +hour ||
        date.getUTCMinutes() !== +minute
    ) {
        throw new Error(`Negaliojanti data: ${value}`);
    }
    return date.getTime();
}

export function formatLocalMinute(timestamp) {
    const date = new Date(timestamp);
    return (
        `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-` +
        `${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:` +
        pad(date.getUTCMinutes())
    );
}

function eppsDateParts(timestamp) {
    const date = new Date(timestamp);
    return {
        date:
            `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/` +
            date.getUTCFullYear(),
        hours: pad(date.getUTCHours()),
        minutes: pad(date.getUTCMinutes()),
    };
}

function todayEndMinute(timeZone = "Europe/Vilnius", now = new Date()) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        })
            .formatToParts(now)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );
    return parseLocalMinute(`${parts.year}-${parts.month}-${parts.day}T23:59`);
}

function baseFields(mode, start, end) {
    const from = eppsDateParts(start);
    const to = eppsDateParts(end);
    return {
        mode,
        scrollPosition: "",
        searchType: "advanced",
        department: "",
        "title.value": "",
        "description.value": "",
        "contractType.value": "",
        "directiveType.value": "",
        "procedureType.value": "",
        "commencementDateRange.start.date": "",
        "commencementDateRange.start.hours": "00",
        "commencementDateRange.start.minutes": "00",
        "commencementDateRange.end.date": "",
        "commencementDateRange.end.hours": "00",
        "commencementDateRange.end.minutes": "00",
        "openingDateRange.start.date": "",
        "openingDateRange.start.hours": "00",
        "openingDateRange.start.minutes": "00",
        "openingDateRange.end.date": "",
        "openingDateRange.end.hours": "00",
        "openingDateRange.end.minutes": "00",
        "submissionDateRange.start.date": from.date,
        "submissionDateRange.start.hours": from.hours,
        "submissionDateRange.start.minutes": from.minutes,
        "submissionDateRange.end.date": to.date,
        "submissionDateRange.end.hours": to.hours,
        "submissionDateRange.end.minutes": to.minutes,
    };
}

function visibleText(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&times;/gi, "×")
        .replace(/\s+/g, " ");
}

export function parseResultCount(html) {
    const text = visibleText(html);
    if (/Rezultatų nerasta/i.test(text)) return 0;

    const paged = text.match(/([\d,. ]+)\s+rezultatai iš viso/i);
    if (paged) return Number(paged[1].replace(/\D/g, ""));

    const all = text.match(/Rodomos visos\s+([\d,. ]+)\s+atitiktys/i);
    if (all) return Number(all[1].replace(/\D/g, ""));

    if (/Rodomas\s+1\s+atitikimas/i.test(text)) return 1;

    throw new Error("EPPS atsakyme nepavyko rasti rezultatų skaičiaus");
}

/** RFC 4180 parseris; EPPS CSV gali turėti kabutes ir kelių eilučių laukus. */
export function parseCsvText(csv) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const text = String(csv).replace(/^\uFEFF/, "");

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === "," && !quoted) {
            row.push(field);
            field = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && text[index + 1] === "\n") index += 1;
            row.push(field);
            field = "";
            if (row.some((value) => value !== "")) rows.push(row);
            row = [];
        } else {
            field += char;
        }
    }
    if (quoted) throw new Error("Neuždarytos kabutės CSV atsakyme");
    if (field !== "" || row.length) {
        row.push(field);
        if (row.some((value) => value !== "")) rows.push(row);
    }
    if (!rows.length) return [];

    const headers = rows.shift();
    if (
        headers.length !== CSV_HEADERS.length ||
        headers.some((header, index) => header !== CSV_HEADERS[index])
    ) {
        throw new Error(`Netikėta EPPS CSV antraštė: ${headers.join(" | ")}`);
    }
    return rows.map((values, rowIndex) => {
        if (values.length !== headers.length) {
            throw new Error(
                `CSV eilutė ${rowIndex + 2} turi ${values.length}, o ne ${headers.length} laukų`,
            );
        }
        return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    });
}

function nullable(value) {
    const cleaned = String(value ?? "").trim();
    return !cleaned || cleaned.toLowerCase() === "null" ? null : cleaned;
}

export function normalizeVykdytojoPavadinimas(value) {
    const name = nullable(value);
    return name?.replace(/\s*\(?\s*pv\s*\)?\s*$/i, "").trim() || null;
}

function numberOrNull(value) {
    const cleaned = nullable(value);
    if (cleaned == null) return null;
    const normalized = cleaned.replace(/\s/g, "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function parsePortalDateTime(value) {
    const cleaned = nullable(value);
    if (!cleaned) return null;
    const match = cleaned.match(
        /^(\d{2})\/(\d{2})\/(\d{4,}) (\d{2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (!match) return null;

    const [, day, month, year, hour, minute, second = "00"] = match;
    const date = new Date(
        Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
    );
    const valid =
        +year >= 2000 &&
        +year <= 2200 &&
        date.getUTCFullYear() === +year &&
        date.getUTCMonth() === +month - 1 &&
        date.getUTCDate() === +day &&
        date.getUTCHours() === +hour &&
        date.getUTCMinutes() === +minute &&
        date.getUTCSeconds() === +second;
    if (!valid) return null;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function normalizePlanRow(row) {
    const rawCpv = nullable(row["BVPŽ kodai"]);
    const commencement = parsePortalDateTime(row["Pirkimo pradžios data"]);
    const tenders = parsePortalDateTime(
        row["Pasiūlymų teikimo pabaigos/pradžios data"],
    );
    const preliminary = parsePortalDateTime(
        row["Preliminari pirkimo sukūrimo data"],
    );
    const record = {
        pirkimoVykdytojas: normalizeVykdytojoPavadinimas(
            row["Pirkimo vykdytojas"],
        ),
        pirkimoPavadinimas: nullable(row["Pirkimo pavadinimas"]),
        aprasymas: nullable(row["Aprašymas"]),
        pirkimoTipas: nullable(row["Pirkimo tipas"]),
        direktyva: nullable(row["Direktyva"]),
        pirkimoBudas: nullable(row["Pirkimo būdas"]),
        bvpzKodai: rawCpv?.match(/\b\d{8}(?:-\d)?\b/g) ?? [],
        bvpzKodaiRaw: rawCpv,
        apskaiciuotaKaina: numberOrNull(row["Apskaičiuota kaina"]),
        kiekiai: nullable(row.Kiekiai),
        pirkimoPradziosData: commencement,
        pasiulymuTeikimoData: tenders,
        numatomaSutartiesTrukmeMenesiais: numberOrNull(
            row["Numatomos pirkimo sutarties trukmė (mėnesiais)"],
        ),
        sutartiesTrukmesMatavimoVienetas: nullable(
            row[
                "Ketinamos sudaryti pirkimo sutarties trukmė (matavimo vienetas)"
            ],
        ),
        preliminariPirkimoSukurimoData: preliminary,
    };
    record.md5 = createHash("md5")
        .update(JSON.stringify(record))
        .digest("hex");
    return record;
}

function splitOversizedInterval(interval) {
    const minutes = (interval.end - interval.start) / MINUTE_MS + 1;
    if (minutes <= 1) return null;

    // Parenkame žmogui suprantamus gabalus: diena -> valanda -> 15 -> 5 -> 1 min.
    const partMinutes =
        minutes > 24 * 60
            ? 24 * 60
            : minutes > 60
              ? 60
              : minutes > 15
                ? 15
                : minutes > 5
                  ? 5
                  : 1;
    const parts = [];
    for (let start = interval.start; start <= interval.end; ) {
        const end = Math.min(
            interval.end,
            start + (partMinutes - 1) * MINUTE_MS,
        );
        parts.push({ start, end });
        start = end + MINUTE_MS;
    }
    return parts;
}

/** Suskaido bendras ribas į kalendorinius mėnesius, išlaikydama kraštines minutes. */
export function splitIntoMonths({ start, end }) {
    const parts = [];
    for (let cursor = start; cursor <= end; ) {
        const date = new Date(cursor);
        const monthEnd =
            Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth() + 1,
                1,
            ) - MINUTE_MS;
        const partEnd = Math.min(end, monthEnd);
        parts.push({ start: cursor, end: partEnd });
        cursor = partEnd + MINUTE_MS;
    }
    return parts;
}

/** Per didelį mėnesį suskaido kalendorinėmis dienomis. */
function splitIntoDays({ start, end }) {
    const parts = [];
    for (let cursor = start; cursor <= end; ) {
        const date = new Date(cursor);
        const dayEnd = Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            23,
            59,
        );
        const partEnd = Math.min(end, dayEnd);
        parts.push({ start: cursor, end: partEnd });
        cursor = partEnd + MINUTE_MS;
    }
    return parts;
}

export async function planExportIntervals({ start, end, limit, count }) {
    const accepted = [];
    // Scraperis čia perduoda visą mėnesį. Tik viršijusį limitą skaidome į
    // dienas, valandas, vėliau 15, 5 ir 1 minutės gabalus.
    const queue = [{ start, end }];
    while (queue.length) {
        const interval = queue.shift();
        const resultCount = await count(interval);
        if (resultCount === 0) continue;
        if (resultCount <= limit) {
            accepted.push({ ...interval, count: resultCount });
            continue;
        }
        const minutes = (interval.end - interval.start) / MINUTE_MS + 1;
        const parts =
            minutes > 24 * 60
                ? splitIntoDays(interval)
                : splitOversizedInterval(interval);
        if (!parts) {
            throw new Error(
                `${formatLocalMinute(interval.start)} minutėje yra ${resultCount} įrašų; ` +
                    `EPPS nepalaiko sekundžių filtro, todėl saugiai eksportuoti negalima`,
            );
        }
        queue.unshift(...parts);
    }
    return accepted.sort((a, b) => a.start - b.start);
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PlannedProcurementsClient {
    constructor({ baseUrl = config.viesiejiPirkimaiUrl, delayMs = 250 } = {}) {
        this.endpoint = new URL(ENDPOINT_PATH, baseUrl);
        this.delayMs = delayMs;
        this.cookies = new Map();
    }

    updateCookies(response) {
        for (const cookie of response.headers.getSetCookie?.() ?? []) {
            const pair = cookie.split(";", 1)[0];
            const separator = pair.indexOf("=");
            if (separator > 0) {
                this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
            }
        }
    }

    cookieHeader() {
        return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    }

    async request(url, options = {}) {
        if (this.delayMs) await sleep(this.delayMs);
        const headers = new Headers(options.headers);
        const cookie = this.cookieHeader();
        if (cookie) headers.set("cookie", cookie);
        const response = await scrapeFetch(url, { ...options, headers });
        this.updateCookies(response);
        if (!response.ok) throw new Error(`EPPS HTTP ${response.status}`);
        return response;
    }

    async ensureSession() {
        if (this.cookies.size) return;
        await this.request(this.endpoint);
    }

    async count(interval) {
        const url = new URL(this.endpoint);
        const fields = baseFields("search", interval.start, interval.end);
        fields.T01_ps = "10";
        for (const [key, value] of Object.entries(fields)) {
            url.searchParams.set(key, value);
        }
        const response = await this.request(url);
        return parseResultCount(await response.text());
    }

    async export(interval) {
        await this.ensureSession();
        const form = new FormData();
        for (const [key, value] of Object.entries(
            baseFields("exportResults", interval.start, interval.end),
        )) {
            form.set(key, value);
        }
        const response = await this.request(this.endpoint, {
            method: "POST",
            headers: { referer: this.endpoint.href },
            body: form,
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/csv")) {
            throw new Error(`Tikėtasi CSV, gauta ${contentType || "be Content-Type"}`);
        }
        return parseCsvText(await response.text());
    }
}

export async function processPlanuojamiPirkimai({
    from = FIRST_PUBLICATION_MINUTE,
    to,
    limit = DEFAULT_EXPORT_LIMIT,
    delayMs = 250,
    client = new PlannedProcurementsClient({ delayMs }),
    logger = defaultLogger,
    onRecords,
} = {}) {
    if (typeof onRecords !== "function") {
        throw new Error("onRecords callback yra privalomas");
    }
    const start = parseLocalMinute(from);
    const end = to ? parseLocalMinute(to) : todayEndMinute();
    if (end < start) throw new Error("Pabaigos data yra ankstesnė už pradžios datą");

    logger.log(
        `[planai] Ribos ${formatLocalMinute(start)}–${formatLocalMinute(end)}, limitas ${limit}`,
    );
    let total = 0;
    let intervalCount = 0;
    // Pirmiausia bandome visą mėnesį. Tik >9000 rezultatų turintį mėnesį
    // planuotojas skaido dienomis ir toliau smulkina pagal poreikį.
    for (const month of splitIntoMonths({ start, end })) {
        const intervals = await planExportIntervals({
            ...month,
            limit,
            count: async (interval) => {
                const count = await client.count(interval);
                logger.log(
                    `[planai] ${formatLocalMinute(interval.start)}–${formatLocalMinute(interval.end)}: ${count}`,
                );
                return count;
            },
        });
        for (const interval of intervals) {
            const rows = await client.export(interval);
            if (rows.length !== interval.count) {
                throw new Error(
                    `${formatLocalMinute(interval.start)}–${formatLocalMinute(interval.end)}: ` +
                        `paieška rodė ${interval.count}, CSV turi ${rows.length}`,
                );
            }
            const records = rows.map((row) => normalizePlanRow(row));
            await onRecords(records);
            total += records.length;
            intervalCount += 1;
            logger.log(
                `[planai] eksportuota ${records.length}, iš viso ${total}`,
            );
        }
    }
    return { total, intervals: intervalCount };
}

export async function scrapePlanuojamiPirkimai({
    outFile = path.resolve("exports/planuojami-pirkimai.jsonl"),
    ...options
} = {}) {
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    const temporaryFile = `${outFile}.tmp-${process.pid}`;
    const handle = await fs.open(temporaryFile, "w");
    try {
        const result = await processPlanuojamiPirkimai({
            ...options,
            onRecords: async (records) => {
                await handle.write(
                    records.map((record) => JSON.stringify(record)).join("\n") +
                        "\n",
                );
            },
        });
        await handle.close();
        await fs.rename(temporaryFile, outFile);
        return { outFile, ...result };
    } catch (error) {
        await handle.close().catch(() => {});
        await fs.unlink(temporaryFile).catch(() => {});
        throw error;
    }
}

function cliOptions(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === "--out") options.outFile = path.resolve(value), index += 1;
        else if (argument === "--from") options.from = value, index += 1;
        else if (argument === "--to") options.to = value, index += 1;
        else if (argument === "--limit") options.limit = Number(value), index += 1;
        else if (argument === "--delay-ms") options.delayMs = Number(value), index += 1;
        else throw new Error(`Nežinomas argumentas: ${argument}`);
    }
    return options;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
    scrapePlanuojamiPirkimai(cliOptions(process.argv.slice(2)))
        .then(({ outFile, total, intervals }) => {
            log(`[planai] Baigta: ${total} įrašų, ${intervals} CSV dalys, ${outFile}`);
        })
        .catch((error) => {
            log(error?.stack ?? String(error));
            process.exitCode = 1;
        });
}

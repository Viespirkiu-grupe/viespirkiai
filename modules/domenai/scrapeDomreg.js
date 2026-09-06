import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("domenai", { operation: "scrapeDomreg", fetchImpl: nodeFetch });
import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { findSingleJuridinis } from "../juridiniai/search.js";
import { sleep } from "../../utils/time.js";
import nodeFetch from "node-fetch";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const SCRAPE_API = "https://www.domreg.lt/api/whois/details/";

const STATUS = {
    SCRAPED: 1,
    NOT_FOUND: -404,
    ERROR: -1,
};

const RATE_LIMIT_MS = 500;
const TOR_WAIT_MS = 5000;
// Ribojame Tor identiteto rotacijas vienam domenui, kad rate limit'as negalėtų
// neribotai laikyti job'o gyvo ir taip blokuoti graceful shutdown'o.
const MAX_RATE_LIMIT_ATTEMPTS = 20;
const FETCH_TIMEOUT_MS = 30_000;
const TOR_CONTROL_TIMEOUT_MS = 10_000;

const proxyAgent = new SocksProxyAgent(config.torAddress);

// Tinklo klaidų kodai, kuriuos domreg'as grąžina blokuodamas exit node'ą.
// EPROTO — kai užblokuotas exit node'as į TLS jungtį atsako plaintext HTTP
// ("HTTP/1.1 400 Bad Request" vietoje TLS record), ir OpenSSL tai praneša kaip
// "wrong version number". Ne domeno klaida, o tos pačios grandinės problema:
// tokį atvejį irgi sprendžia nauja Tor tapatybė.
const RATE_LIMIT_ERROR_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "EPROTO",
]);

/**
 * Signalizuoja, kad domreg'as blokuoja dabartinį IP (captcha, 429, nutraukta
 * jungtis). Domenas dėl to nežymimas klaida — reikia tik pakeisti Tor tapatybę.
 */
class RateLimitError extends Error {
    /** @param {string} reason */
    constructor(reason) {
        super(reason);
        this.name = "RateLimitError";
    }
}

/**
 * Ar HTTP atsakymas iš tikrųjų yra užmaskuotas rate limit'as.
 * Domreg'as, pasiekus limitą, bando parodyti captcha; jų pačių paveiksliuko
 * generatorius dažnai nulūžta ir vietoj `{"error":100}` grįžta HTTP 400 su
 * `captchaImage generation failed`.
 * @param {number} status
 * @param {string} body
 * @returns {boolean}
 */
function isRateLimitResponse(status, body) {
    if (status === 429 || status === 403) return true;
    return status === 400 && /captcha/i.test(body);
}

/**
 * @typedef {object} DbDomainRow
 * @property {number} id
 * @property {string} domain
 */

/**
 * @typedef {object} DomainSnapshot
 * @property {string} domain
 * @property {Date} domregData
 * @property {object} domreg
 * @property {string | null} savininkas
 * @property {string | null} savininkasAdresas
 * @property {string | null} status
 * @property {string | null} created
 * @property {string | null} expired
 * @property {string | null} updated
 * @property {string[] | null} domregNs
 * @property {string | null} savininkoKodas
 * @property {boolean | null} kodasIeskotas
 */

/**
 * Requests a new Tor identity via the control port.
 * @param {string} [password=config.torPassword]
 * @returns {Promise<void>}
 */
export function newTorIdentity(password = config.torPassword) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(9051, "127.0.0.1");
        let authenticated = false;
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            fn(value);
        };

        socket.setTimeout(TOR_CONTROL_TIMEOUT_MS);

        socket.on("connect", () => {
            socket.write(`AUTHENTICATE "${password}"\r\n`);
        });

        socket.on("data", (data) => {
            const msg = data.toString().trim();

            if (!authenticated) {
                if (msg.startsWith("250")) {
                    authenticated = true;
                    socket.write("SIGNAL NEWNYM\r\n");
                    return;
                }

                finish(reject, new Error("Tor authentication failed: " + msg));
                return;
            }

            if (msg.startsWith("250")) {
                finish(resolve);
                return;
            }

            finish(reject, new Error("Tor NEWNYM failed: " + msg));
        });

        socket.on("timeout", () => {
            finish(
                reject,
                new Error(`Tor control timeout after ${TOR_CONTROL_TIMEOUT_MS}ms`),
            );
        });

        socket.on("error", (error) => finish(reject, error));
        socket.on("end", () => {
            if (!settled) {
                finish(reject, new Error("Tor control connection ended unexpectedly"));
            }
        });
    });
}

/**
 * Current timestamp helper for DB writes.
 * @returns {Date}
 */
function now() {
    return new Date();
}

/**
 * Fetches WHOIS details for one domain.
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function fetchDomainDetails(domain) {
    const url = `${SCRAPE_API}${domain}?_=${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;

    try {
        response = await scrapeFetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "application/json",
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
            },
            agent: proxyAgent,
            signal: controller.signal,
        });
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms for ${domain}`);
        }

        const code = error.code ?? error.cause?.code;
        if (RATE_LIMIT_ERROR_CODES.has(code)) {
            throw new RateLimitError(`tinklo klaida ${code}`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }

    const body = await response.text();

    if (!response.ok) {
        if (isRateLimitResponse(response.status, body)) {
            throw new RateLimitError(`HTTP ${response.status} (captcha/blokas)`);
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`Netinkamas JSON atsakymas (HTTP ${response.status})`);
    }
}

/**
 * Builds a normalized snapshot used by both current and historical tables.
 * @param {DbDomainRow} domenas
 * @param {object} data
 * @param {Date} scrapedAt
 * @returns {DomainSnapshot}
 */
/**
 * @param {string | null} savininkas
 * @returns {Promise<{ kodas: string | null, status: number }>}
 */
async function resolveSavininkoKodas(savininkas) {
    if (!savininkas) return { kodas: null, status: 2 };
    const j = await findSingleJuridinis(savininkas);
    return { kodas: j?.jarKodas ?? null, status: 2 };
}

function buildSnapshot(domenas, data, scrapedAt, resolved) {
    return {
        domain: domenas.domain,
        domregData: scrapedAt,
        domreg: data,
        savininkas: data.details?.registrant?.org ?? null,
        savininkasAdresas: data.details?.registrant?.addr ?? null,
        status: data.domainstatus ?? null,
        created: data.details?.domain?.created ?? null,
        expired: data.details?.domain?.expired ?? null,
        updated: data.details?.domain?.updated ?? null,
        domregNs: data.details?.nameservers ?? null,
        savininkoKodas: resolved?.kodas ?? null,
        // `resolved.status` visada 2, taip pat ir tada, kai kodas nerastas —
        // reikšmė reiškia „jau ieškota", ne „nustatyta".
        kodasIeskotas: resolved == null ? null : true,
    };
}

/**
 * Updates domenai.domenai and inserts a full historical row into domenai.scrapes.
 * @param {DbDomainRow} domenas
 * @param {object} data
 * @param {number} scrapeStatus
 * @param {Date} scrapedAt
 * @returns {Promise<void>}
 */
async function saveDomainData(domenas, data, scrapeStatus, scrapedAt) {
    const resolved = await resolveSavininkoKodas(
        data.details?.registrant?.org ?? null,
    );
    const s = buildSnapshot(domenas, data, scrapedAt, resolved);

    await postgres.query(
        `UPDATE domenai.domenai
         SET "domregNuskaitymas" = $1,
             "domregData" = $2,
             "domregId" = domenai.domreg_id($3),
             "savininkasId" = domenai.savininkas_id($4, $5, $6),
             "busenaId" = domenai.busena_id($7),
             created = $8,
             expired = $9,
             updated = $10,
             "nsId" = domenai.ns_id($11),
             "kodasIeskotas" = $12
         WHERE id = $13`,
        [
            scrapeStatus,
            s.domregData,
            s.domreg,
            s.savininkas,
            s.savininkasAdresas,
            s.savininkoKodas,
            s.status,
            s.created,
            s.expired,
            s.updated,
            s.domregNs,
            s.kodasIeskotas,
            domenas.id,
        ],
    );

    await postgres.query(
        `INSERT INTO domenai.scrapes (
            "domainId",
            "domregData",
            "domregId",
            "savininkasId",
            "busenaId",
            created,
            expired,
            updated,
            "nsId",
            "kodasIeskotas"
         )
         VALUES ($1, $2, domenai.domreg_id($3), domenai.savininkas_id($4, $5, $6),
                 domenai.busena_id($7), $8, $9, $10, domenai.ns_id($11), $12)`,
        [
            domenas.id,
            s.domregData,
            s.domreg,
            s.savininkas,
            s.savininkasAdresas,
            s.savininkoKodas,
            s.status,
            s.created,
            s.expired,
            s.updated,
            s.domregNs,
            s.kodasIeskotas,
        ],
    );

    signalWork(WORK_SIGNALS.DOMENAI_ADP_READY, {
        source: "scrapeDomreg",
        domain: domenas.domain,
    });
}

/**
 * Pakeičia Tor tapatybę po rate limit'o ir palaukia, kol pakils naujas grandinės kelias.
 * @param {string} domain
 * @param {string} reason
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
async function rotateAfterRateLimit(domain, reason, signal) {
    logger.log(`Rate limited for ${domain} (${reason}); rotating Tor identity`);

    try {
        await newTorIdentity();
    } catch (error) {
        logger.log(`Tor identity rotation failed: ${error.message}`);
    }

    await sleep(TOR_WAIT_MS, signal);
}

/**
 * Scrapes and persists one oldest domain record.
 * @param {AbortSignal} [signal] Nutraukia rate limit retry ciklą per shutdown'ą.
 * @returns {Promise<boolean>} True when a domain was processed.
 */
export async function nuskaitytiDomregDomena(signal) {
    const result = await postgres.query(
        `SELECT id, domain
         FROM domenai.domenai
         WHERE COALESCE("domregNuskaitymas", 0) <> $1
         ORDER BY "domregData" ASC NULLS FIRST
         LIMIT 1`,
        [STATUS.NOT_FOUND],
    );

    /** @type {DbDomainRow | undefined} */
    const domenas = result.rows[0];
    if (!domenas) {
        logger.log("No domains to scrape");
        return false;
    }

    logger.log(`Scraping: ${domenas.domain}`);

    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
        if (signal?.aborted) {
            logger.log(`Aborted while scraping ${domenas.domain}`);
            return false;
        }

        try {
            const data = await fetchDomainDetails(domenas.domain);
            const scrapedAt = now();

            if (data.error === 100) {
                await rotateAfterRateLimit(domenas.domain, "error 100", signal);
                continue;
            }

            if (data.error === 0) {
                const savininkas = data.details?.registrant?.org ?? "unknown";
                await saveDomainData(domenas, data, STATUS.SCRAPED, scrapedAt);
                logger.log(`Scraped successfully: ${domenas.domain}; savininkas: ${savininkas}`);
                return true;
            }

            if (data.error === 2) {
                await saveDomainData(domenas, data, STATUS.NOT_FOUND, scrapedAt);
                logger.log(`Domain not found: ${domenas.domain}`);
                return true;
            }

            await saveDomainData(domenas, data, STATUS.ERROR, scrapedAt);
            logger.log(`Unexpected API error ${data.error} for ${domenas.domain}`);
            return true;
        } catch (error) {
            if (error instanceof RateLimitError) {
                await rotateAfterRateLimit(domenas.domain, error.message, signal);
                continue;
            }

            logger.log(`Fetch error for ${domenas.domain}: ${error.message}`);
            await postgres.query(
                `UPDATE domenai.domenai
                 SET "domregNuskaitymas" = $1,
                     "domregData" = $2
                 WHERE id = $3`,
                [STATUS.ERROR, now(), domenas.id],
            );
            signalWork(WORK_SIGNALS.DOMENAI_ADP_READY, {
                source: "scrapeDomreg-error",
                domain: domenas.domain,
            });
            return true;
        }
    }

    // Domenas lieka nepažymėtas — jį pasiims kitas ciklas. `false` grąžinimas
    // nuleidžia darbininką į cooldown'ą, t. y. veikia kaip rate limit backoff.
    logger.log(`Giving up on ${domenas.domain} after ${MAX_RATE_LIMIT_ATTEMPTS} rate limited attempts`);
    return false;
}

/**
 * Main loop: continuously scrapes oldest domains.
 * @returns {Promise<void>}
 */
async function main() {
    logger.log("Starting domain scraper...");

    while (true) {
        try {
            const processed = await nuskaitytiDomregDomena();
            await sleep(processed ? RATE_LIMIT_MS : 30000);
        } catch (err) {
            logger.log(`Fatal loop error: ${err.message}`);
            await sleep(5000);
        }
    }
}

const isDirectRun = (() => {
    if (!process.argv[1]) return false;

    return (
        path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    );
})();

if (isDirectRun) {
    await main();
}

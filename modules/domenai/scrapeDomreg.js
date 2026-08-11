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

const SCRAPE_API = "https://www.domreg.lt/api/whois/details/";

const STATUS = {
    SCRAPED: 1,
    NOT_FOUND: -404,
    ERROR: -1,
};

const RATE_LIMIT_MS = 500;
const TOR_WAIT_MS = 5000;
const FETCH_TIMEOUT_MS = 30_000;
const TOR_CONTROL_TIMEOUT_MS = 10_000;

const proxyAgent = new SocksProxyAgent(config.torAddress);

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
 * @property {string | null} technikas
 * @property {string | null} technikasAdresas
 * @property {string | null} status
 * @property {string | null} created
 * @property {string | null} expired
 * @property {string | null} updated
 * @property {string[] | null} domregNs
 * @property {string | null} savininkoKodas
 * @property {number | null} savininkoKodasStatus
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

        throw error;
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
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
        technikas: data.details?.technical?.org ?? null,
        technikasAdresas: data.details?.technical?.addr ?? null,
        status: data.domainstatus ?? null,
        created: data.details?.domain?.created ?? null,
        expired: data.details?.domain?.expired ?? null,
        updated: data.details?.domain?.updated ?? null,
        domregNs: data.details?.nameservers ?? null,
        savininkoKodas: resolved?.kodas ?? null,
        savininkoKodasStatus: resolved?.status ?? null,
    };
}

/**
 * Updates public.domenai and inserts a full historical row into public."domenaiScrapes".
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
        `UPDATE public.domenai
         SET "domregNuskaitymas" = $1,
             "domregData" = $2,
             domreg = $3,
             savininkas = $4,
             "savininkasAdresas" = $5,
             technikas = $6,
             "technikasAdresas" = $7,
             status = $8,
             created = $9,
             expired = $10,
             updated = $11,
             "domregNs" = $12,
             "savininkoKodas" = $13,
             "savininkoKodasStatus" = $14
         WHERE id = $15`,
        [
            scrapeStatus,
            s.domregData,
            s.domreg,
            s.savininkas,
            s.savininkasAdresas,
            s.technikas,
            s.technikasAdresas,
            s.status,
            s.created,
            s.expired,
            s.updated,
            s.domregNs,
            s.savininkoKodas,
            s.savininkoKodasStatus,
            domenas.id,
        ],
    );

    await postgres.query(
        `INSERT INTO public."domenaiScrapes" (
            "domainId",
            domain,
            "domregData",
            domreg,
            savininkas,
            "savininkasAdresas",
            technikas,
            "technikasAdresas",
            status,
            created,
            expired,
            updated,
            "domregNs",
            "savininkoKodas",
            "savininkoKodasStatus"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
            domenas.id,
            s.domain,
            s.domregData,
            s.domreg,
            s.savininkas,
            s.savininkasAdresas,
            s.technikas,
            s.technikasAdresas,
            s.status,
            s.created,
            s.expired,
            s.updated,
            s.domregNs,
            s.savininkoKodas,
            s.savininkoKodasStatus,
        ],
    );
}

/**
 * Scrapes and persists one oldest domain record.
 * @returns {Promise<boolean>} True when a domain was processed.
 */
export async function nuskaitytiDomregDomena() {
    const result = await postgres.query(
        `SELECT id, domain
         FROM public.domenai
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

    try {
        const data = await fetchDomainDetails(domenas.domain);
        const scrapedAt = now();

        if (data.error === 100) {
            logger.log(`Rate limited for ${domenas.domain}; rotating Tor identity`);
            await newTorIdentity();
            await sleep(TOR_WAIT_MS);
            return nuskaitytiDomregDomena();
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
        logger.log(`Fetch error for ${domenas.domain}: ${error.message}`);
        await postgres.query(
            `UPDATE public.domenai
             SET "domregNuskaitymas" = $1,
                 "domregData" = $2
             WHERE id = $3`,
            [STATUS.ERROR, now(), domenas.id],
        );
        return true;
    }
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

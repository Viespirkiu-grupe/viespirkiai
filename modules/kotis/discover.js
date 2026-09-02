#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { acquireSessionLock } from "../../postgres/sessionLock.js";
import { positiveInteger } from "../../utils/cliArgs.js";
import { log } from "../../utils/log.js";
import { closeNats } from "../../utils/natsHub.js";
import { fetchKotisHtml, kotisListUrl, prepareKotisSession } from "./api.js";
import { parseListPage } from "./parse.js";
import {
    assertKotisQueueSchema,
    cancelStaleDiscoveries,
    createDiscovery,
    finishDiscovery,
    storeDiscoveredPage,
} from "./discoveryStore.js";

const LOCK_KEY = "kotis-discovery-v4";
const FIRST_KOTIS_DATE = "2016-01-01";

function isoDate(value, option) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")
        || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
        throw new Error(`${option} turi būti YYYY-MM-DD formato kalendorinė data`);
    }
    return value;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function daysBefore(day, count) {
    return new Date(Date.parse(`${day}T00:00:00Z`) - count * 86_400_000).toISOString().slice(0, 10);
}

export function splitRange(from, to) {
    if (from === to) return null;
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const middle = start + Math.floor((end - start) / 2 / 86_400_000) * 86_400_000;
    const leftTo = new Date(middle).toISOString().slice(0, 10);
    const rightFrom = new Date(middle + 86_400_000).toISOString().slice(0, 10);
    return [{ from, to: leftTo }, { from: rightFrom, to }];
}

const MAX_AMOUNT_CENTS = 10n ** 20n - 1n;

function amountText(cents) {
    return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function initialAmountRanges() {
    const ranges = [];
    let from = 0n;
    let to = 10_000n;
    while (from <= MAX_AMOUNT_CENTS) {
        const cappedTo = to > MAX_AMOUNT_CENTS ? MAX_AMOUNT_CENTS : to;
        ranges.push({ amountFrom: from, amountTo: cappedTo });
        from = cappedTo + 1n;
        to *= 10n;
    }
    return ranges;
}

function splitAmountRange(range) {
    if (range.amountFrom === range.amountTo) return null;
    const middle = (range.amountFrom + range.amountTo) / 2n;
    return [
        { ...range, amountTo: middle },
        { ...range, amountFrom: middle + 1n },
    ];
}

function listUrl(range, page) {
    return kotisListUrl(range.from, page, range.to, {
        amountFrom: range.amountFrom == null ? null : amountText(range.amountFrom),
        amountTo: range.amountTo == null ? null : amountText(range.amountTo),
        ordering: range.ordering,
    });
}

function rangeLabel(range) {
    const dates = `${range.from}..${range.to}`;
    const label = range.amountFrom == null
        ? dates
        : `${dates}, suma ${amountText(range.amountFrom)}..${amountText(range.amountTo)}`;
    return range.ordering ? `${label}, ${range.ordering}` : label;
}

export function parseDiscoverArgs(argv) {
    const allowed = new Set(["--mode", "--from", "--to", "--days", "--wait-lock", "--help"]);
    for (const arg of argv) {
        if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`Nežinomas argumentas: ${arg}`);
    }
    const value = (name) => {
        const index = argv.indexOf(name);
        if (index < 0) return undefined;
        if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
            throw new Error(`${name} trūksta reikšmės`);
        }
        return argv[index + 1];
    };
    if (argv.includes("--help")) return { help: true };
    const mode = value("--mode") ?? "fullReconcile";
    if (!["incremental", "recentReconcile", "fullReconcile"].includes(mode)) {
        throw new Error("--mode: incremental, recentReconcile arba fullReconcile");
    }
    const to = isoDate(value("--to") ?? today(), "--to");
    const days = value("--days") ? positiveInteger(value("--days"), "--days") : 30;
    const from = isoDate(
        value("--from") ?? (mode === "fullReconcile" ? FIRST_KOTIS_DATE : daysBefore(to, days - 1)),
        "--from",
    );
    if (from > to) throw new Error("--from negali būti vėlesnė už --to");
    return { help: false, mode, from, to, waitLock: argv.includes("--wait-lock") };
}

function printHelp() {
    console.log(`Naudojimas: node modules/kotis/discover.js [parametrai]

  --mode incremental|recentReconcile|fullReconcile (numatyta fullReconcile)
  --from YYYY-MM-DD       Intervalo pradžia
  --to YYYY-MM-DD         Intervalo pabaiga
  --days N                Dienų skaičius atgal (numatyta 30)
  --wait-lock             Laukti kito sąrašo proceso
  --help`);
}

export async function discoverKotis(options, { db = postgres, fetchHtml = fetchKotisHtml } = {}) {
    await assertKotisQueueSchema(db);
    const lock = await acquireSessionLock(LOCK_KEY, { wait: options.waitLock });
    if (!lock) throw new Error("Kitas KOTIS sąrašo procesas jau veikia");
    let importId;
    let count = 0;
    let importError;
    try {
        log("KOTIS sąrašas: nustatoma sesija po 1000 įrašų puslapyje");
        await prepareKotisSession();
        await cancelStaleDiscoveries(db);
        importId = await createDiscovery(options, db);
        let storedPage = 0;
        let authoritativeTotal = null;
        const seen = new Set();
        const ranges = [{ from: options.from, to: options.to }];
        log(`KOTIS sąrašas ${importId}: ${options.from}..${options.to}`);
        while (ranges.length) {
            const range = ranges.shift();
            const firstUrl = listUrl(range, 1);
            const first = parseListPage(await fetchHtml(firstUrl), firstUrl);
            if (first.total == null) throw new Error("KOTIS puslapyje nerastas bendras įrašų skaičius");
            if (first.pageSize != null && first.pageSize !== 1_000) {
                throw new Error(`KOTIS sesijoje yra ${first.pageSize}, o ne 1000 įrašų puslapyje`);
            }
            if (authoritativeTotal == null && range.from === options.from && range.to === options.to
                && range.amountFrom == null) {
                authoritativeTotal = first.total;
            }
            if (first.total > 10_000 && !range.window) {
                const dateParts = splitRange(range.from, range.to);
                let parts;
                if (dateParts) {
                    parts = dateParts.map((part) => ({ ...part }));
                } else if (range.amountFrom == null) {
                    parts = [
                        ...initialAmountRanges().map((amount) => ({ ...range, ...amount })),
                        // Sumos intervalai neapima NULL ar nestandartinių sumų.
                        // Abu kraštiniai langai jas surenka, o ID deduplikuojami.
                        { ...range, window: true, ordering: "aid_amount.asc" },
                        { ...range, window: true, ordering: "aid_amount.desc" },
                    ];
                } else {
                    parts = splitAmountRange(range);
                }
                if (!parts) {
                    if (first.total > 20_000) {
                        throw new Error(`${rangeLabel(range)} turi ${first.total} vienodos sumos įrašų`);
                    }
                    parts = [
                        { ...range, window: true, ordering: "id.asc" },
                        { ...range, window: true, ordering: "id.desc" },
                    ];
                }
                log(`KOTIS sąrašas: ${rangeLabel(range)} turi ${first.total}, intervalas dalijamas`);
                ranges.unshift(...parts);
                continue;
            }

            const rangeSeen = new Set();
            let page = 1;
            let list = first;
            while (true) {
                if (list.total !== first.total) {
                    throw new Error(
                        `${range.from}..${range.to} įrašų skaičius pasikeitė (${first.total} -> ${list.total})`,
                    );
                }
                const duplicate = list.rows.find((row) => rangeSeen.has(row.id)
                    || (!range.window && seen.has(row.id)));
                if (duplicate) throw new Error(`KOTIS ID ${duplicate.id} pasikartojo keliuose intervaluose`);
                list.rows.forEach((row) => {
                    rangeSeen.add(row.id);
                    seen.add(row.id);
                });
                storedPage++;
                await storeDiscoveredPage(importId, storedPage, list.rows, db);
                count = seen.size;
                log(
                    `KOTIS sąrašas ${range.from}..${range.to}: puslapis ${page}, `
                    + `intervale ${rangeSeen.size}/${first.total}, iš viso ${count}`,
                );
                if (!list.nextUrl || (range.window && page === 10)) break;
                page++;
                if (page > 10) throw new Error(`${range.from}..${range.to} viršyta KOTIS 10000 rezultatų riba`);
                const url = listUrl(range, page);
                list = parseListPage(await fetchHtml(url), url);
            }
            const expectedInRange = range.window ? Math.min(first.total, 10_000) : first.total;
            if (rangeSeen.size !== expectedInRange) {
                throw new Error(`${rangeLabel(range)}: rasta ${rangeSeen.size}, tikėtasi ${expectedInRange}`);
            }
        }
        if (authoritativeTotal != null && count !== authoritativeTotal) {
            throw new Error(`Po intervalų skaidymo rasta ${count}, visas KOTIS intervalas skelbia ${authoritativeTotal}`);
        }
    } catch (error) {
        importError = error;
    } finally {
        if (importId) await finishDiscovery(importId, { count, error: importError }, db).catch((error) => {
            importError = importError
                ? new AggregateError([importError, error], "Nepavyko sąrašas ir audito užbaigimas") : error;
        });
        await lock.release();
    }
    if (importError) throw importError;
    return { importId, count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const options = parseDiscoverArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else discoverKotis(options).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(async () => {
        await closeNats().catch(() => {});
        await postgres.end();
    });
}

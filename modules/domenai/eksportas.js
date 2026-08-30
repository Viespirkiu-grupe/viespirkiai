/**
 * Bendra domenų eksporto logika Spintai.
 *
 * Naudojama: modules/domenai/pushToSpinta.js
 */
import { postgres } from "../../postgres/postgres.js";

export const DEFAULT_BATCH_SIZE = 500;

function toStringOrNull(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s.length ? s : null;
}

function toIsoTimestamp(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
        return `${text.replace(" ", "T")}${text.includes(".") ? "" : ".000"}Z`;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function extractNsHost(entry) {
    if (entry == null) return null;
    if (typeof entry === "string") {
        const s = entry.trim();
        if (s.startsWith("{")) {
            try {
                return toStringOrNull(JSON.parse(s)?.nsname);
            } catch {
                return null;
            }
        }
        return s.length ? s : null;
    }
    if (typeof entry === "object") {
        return toStringOrNull(entry.nsname);
    }
    return null;
}

function nsArray(value) {
    if (!Array.isArray(value)) return [];
    const hosts = value.map(extractNsHost).filter(Boolean);
    return [...new Set(hosts)];
}

export function buildDomenasRecord(row) {
    return {
        parent: {
            domain: row.domain,
            status: toStringOrNull(row.status),
            created: toIsoTimestamp(row.created),
            expired: toIsoTimestamp(row.expired),
            updated: toIsoTimestamp(row.updated),
            savininkas: toStringOrNull(row.savininkas),
            tiketinasSavininkoKodas: toStringOrNull(row.savininkoKodas),
        },
        ns: nsArray(row.domregNs),
    };
}

export function buildIstorijaRecord(row) {
    return {
        parent: {
            scrapeId: Number(row.scrapeId),
            domain: row.domain,
            domregData: toIsoTimestamp(row.domregData),
            status: toStringOrNull(row.status),
            expired: toIsoTimestamp(row.expired),
            savininkas: toStringOrNull(row.savininkas),
            tiketinasSavininkoKodas: toStringOrNull(row.savininkoKodas),
        },
        ns: nsArray(row.domregNs),
    };
}

export async function* iterateDomenai({ batchSize = DEFAULT_BATCH_SIZE, startAfterId = 0 } = {}) {
    let afterId = startAfterId;
    while (true) {
        const { rows } = await postgres.query(
            `SELECT id, domain, status, created, expired, updated,
                    "domregNs", savininkas, "savininkoKodas"
             FROM domenai."domenaiPilni"
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [afterId, batchSize],
        );
        if (!rows.length) return;
        afterId = Number(rows[rows.length - 1].id);
        yield { rows, afterId };
    }
}

export async function fetchScrapesForDomains(domainIds) {
    if (!domainIds.length) return [];
    const { rows } = await postgres.query(
        `SELECT "scrapeId", "domainId", domain, "domregData", status, expired,
                "domregNs", savininkas, "savininkoKodas"
         FROM domenai."scrapesPilni"
         WHERE "domainId" = ANY($1::int[])
         ORDER BY "domainId" ASC, "scrapeId" ASC`,
        [domainIds],
    );
    return rows;
}

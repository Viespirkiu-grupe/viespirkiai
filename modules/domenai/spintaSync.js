import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { createSpintaClient } from "../spinta/index.js";
import { buildDomenasRecord, buildIstorijaRecord } from "./eksportas.js";

const DATASET = "domenai";
const VALID_NS_HOST = /^[a-zA-Z0-9.-]+$/;
const META_FIELDS = new Set(["_id", "_revision", "_type", "_created"]);

function resultRows(result) {
    return Array.isArray(result?._data) ? result._data : [];
}

function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !META_FIELDS.has(key))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, comparable(item)]),
        );
    }
    return value;
}

function equal(a, b) {
    return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

export function buildPatch(current, desired, ignored = []) {
    const skip = new Set(ignored);
    return Object.fromEntries(
        Object.entries(desired).filter(
            ([key, value]) => !skip.has(key) && !equal(current?.[key], value),
        ),
    );
}

function deleteOp(row) {
    return {
        _op: "delete",
        _id: row._id,
        ...(row._revision ? { _revision: row._revision } : {}),
    };
}

export function diffRows(currentRows, desiredRows, key, parentField, parentId) {
    const current = new Map();
    const deletes = [];
    for (const row of currentRows) {
        const value = row?.[key];
        if (value == null || current.has(String(value))) {
            if (row?._id) deletes.push(deleteOp(row));
        } else {
            current.set(String(value), row);
        }
    }

    const inserts = [];
    const patches = [];
    for (const desired of desiredRows) {
        const value = desired?.[key];
        if (value == null) continue;
        const existing = current.get(String(value));
        if (!existing) {
            inserts.push({
                _op: "insert",
                ...(parentField ? { [parentField]: { _id: parentId } } : {}),
                ...desired,
            });
            continue;
        }
        current.delete(String(value));
        const patch = buildPatch(existing, desired, [key, parentField]);
        if (Object.keys(patch).length) {
            patches.push({
                _op: "patch",
                _id: existing._id,
                ...(existing._revision ? { _revision: existing._revision } : {}),
                ...patch,
            });
        }
    }
    for (const row of current.values()) deletes.push(deleteOp(row));
    return { inserts, patches, deletes, ops: [...inserts, ...patches, ...deletes] };
}

async function checkedBatch(spinta, model, ops, dryRun) {
    if (!ops.length || dryRun) return { _data: [] };
    const result = await spinta.batch(model, ops);
    const errors = resultRows(result).flatMap((row) => row?._errors ?? []);
    if (errors.length) {
        throw new Error(`${model}: ${errors.length} Spintos batch klaidos: ${JSON.stringify(errors.slice(0, 3))}`);
    }
    return result;
}

export function createDomenaiSpintaClient() {
    const org = (config.spintaNamespace || "").replace(/\/+$/, "");
    if (!org) throw new Error("Spinta: config.spintaNamespace not set.");
    return createSpintaClient({ namespace: `${org}/${DATASET}` });
}

export function isDomenaiSpintaConfigured() {
    return Boolean(
        config.spintaServer &&
        config.spintaNamespace &&
        (config.spintaApiKey || (config.spintaClient && config.spintaSecret)),
    );
}

async function fetchLocal(domain) {
    const { rows } = await postgres.query(
        `SELECT id, domain, status, created, expired, updated,
                "domregNs", savininkas, "savininkoKodas"
         FROM public.domenai
         WHERE domain = $1`,
        [domain],
    );
    const row = rows[0] ?? null;
    if (!row) return { row: null, scrapes: [] };
    const scrapeResult = await postgres.query(
        `SELECT "scrapeId", "domainId", domain, "domregData", status, expired,
                "domregNs", savininkas, "savininkoKodas"
         FROM public."domenaiScrapes"
         WHERE "domainId" = $1
         ORDER BY "scrapeId"`,
        [row.id],
    );
    return { row, scrapes: scrapeResult.rows };
}

async function fetchRemote(spinta, domain) {
    const quotedDomain = `'${String(domain).replaceAll("'", "''")}'`;
    const parent = resultRows(await spinta.getAll("Domenas", { domain: quotedDomain }))[0] ?? null;
    if (!parent) return { parent: null, ns: [], history: [], historyNs: new Map() };
    const [ns, history] = await Promise.all([
        spinta.getAll("DomenoNs", { domain: `'${parent._id}'` }).then(resultRows),
        spinta.getAll("DomenoIstorija", { domain: `'${parent._id}'` }).then(resultRows),
    ]);
    const historyNs = new Map();
    await Promise.all(history.map(async (entry) => {
        historyNs.set(
            String(entry.scrapeId),
            resultRows(await spinta.getAll("DomenoIstorijosNs", { scrapeId: `'${entry._id}'` })),
        );
    }));
    return { parent, ns, history, historyNs };
}

async function findRemoteDomainId(spinta, domain) {
    const quotedDomain = `'${String(domain).replaceAll("'", "''")}'`;
    return resultRows(await spinta.getAll("Domenas", { domain: quotedDomain }))[0]?._id ?? null;
}

async function findRemoteHistoryId(spinta, scrapeId) {
    return resultRows(
        await spinta.getAll("DomenoIstorija", { scrapeId: Number(scrapeId) }),
    )[0]?._id ?? null;
}

function nsRows(ns) {
    return ns.filter((host) => VALID_NS_HOST.test(host)).map((host) => ({ ns: host }));
}

function addStats(total, diff) {
    total.insert += diff.inserts.length;
    total.patch += diff.patches.length;
    total.delete += diff.deletes.length;
}

async function deleteRemote(spinta, remote, dryRun) {
    const stats = { insert: 0, patch: 0, delete: 0, unchanged: 0 };
    for (const rows of remote.historyNs.values()) {
        const ops = rows.filter((row) => row?._id).map(deleteOp);
        await checkedBatch(spinta, "DomenoIstorijosNs", ops, dryRun);
        stats.delete += ops.length;
    }
    for (const [model, rows] of [
        ["DomenoIstorija", remote.history],
        ["DomenoNs", remote.ns],
        ["Domenas", remote.parent ? [remote.parent] : []],
    ]) {
        const ops = rows.filter((row) => row?._id).map(deleteOp);
        await checkedBatch(spinta, model, ops, dryRun);
        stats.delete += ops.length;
    }
    return stats;
}

export async function syncDomenasToSpinta({
    domain,
    spinta = createDomenaiSpintaClient(),
    dryRun = false,
    skipScrapes = false,
}) {
    const [local, remote] = await Promise.all([fetchLocal(domain), fetchRemote(spinta, domain)]);
    if (!local.row) return deleteRemote(spinta, remote, dryRun);

    const desired = buildDomenasRecord(local.row);
    const stats = { insert: 0, patch: 0, delete: 0, unchanged: 0 };
    let parentId = remote.parent?._id;
    if (!remote.parent) {
        const result = await checkedBatch(spinta, "Domenas", [{ _op: "insert", ...desired.parent }], dryRun);
        parentId = dryRun
            ? `dry-${local.row.id}`
            : resultRows(result)[0]?._id ?? await findRemoteDomainId(spinta, domain);
        if (!parentId) throw new Error(`Domenas ${domain}: Spinta negrąžino parent _id`);
        stats.insert++;
    } else {
        const patch = buildPatch(remote.parent, desired.parent, ["domain"]);
        if (Object.keys(patch).length) {
            await checkedBatch(spinta, "Domenas", [{
                _op: "patch",
                _id: remote.parent._id,
                ...(remote.parent._revision ? { _revision: remote.parent._revision } : {}),
                ...patch,
            }], dryRun);
            stats.patch++;
        } else {
            stats.unchanged++;
        }
    }

    const nsDiff = diffRows(remote.ns, nsRows(desired.ns), "ns", "domain", parentId);
    await checkedBatch(spinta, "DomenoNs", nsDiff.ops, dryRun);
    addStats(stats, nsDiff);

    if (skipScrapes) return stats;

    const desiredHistory = new Map(local.scrapes.map((row) => {
        const record = buildIstorijaRecord(row);
        const { domain: _domain, ...parent } = record.parent;
        return [String(parent.scrapeId), { parent, ns: record.ns }];
    }));
    const currentHistory = new Map(remote.history.map((row) => [String(row.scrapeId), row]));

    for (const [scrapeId, record] of desiredHistory) {
        let historyId = currentHistory.get(scrapeId)?._id;
        const current = currentHistory.get(scrapeId);
        if (!current) {
            const result = await checkedBatch(spinta, "DomenoIstorija", [{
                _op: "insert",
                ...record.parent,
                domain: { _id: parentId },
            }], dryRun);
            historyId = dryRun
                ? `dry-history-${scrapeId}`
                : resultRows(result)[0]?._id ?? await findRemoteHistoryId(spinta, scrapeId);
            if (!historyId) throw new Error(`Domeno istorija ${scrapeId}: Spinta negrąžino _id`);
            stats.insert++;
        } else {
            currentHistory.delete(scrapeId);
            const patch = buildPatch(current, record.parent, ["scrapeId", "domain"]);
            if (Object.keys(patch).length) {
                await checkedBatch(spinta, "DomenoIstorija", [{
                    _op: "patch",
                    _id: current._id,
                    ...(current._revision ? { _revision: current._revision } : {}),
                    ...patch,
                }], dryRun);
                stats.patch++;
            } else {
                stats.unchanged++;
            }
        }
        const historyNsDiff = diffRows(
            remote.historyNs.get(scrapeId) ?? [],
            nsRows(record.ns),
            "ns",
            "scrapeId",
            historyId,
        );
        await checkedBatch(spinta, "DomenoIstorijosNs", historyNsDiff.ops, dryRun);
        addStats(stats, historyNsDiff);
    }

    for (const [scrapeId, history] of currentHistory) {
        const nsOps = (remote.historyNs.get(scrapeId) ?? []).filter((row) => row?._id).map(deleteOp);
        await checkedBatch(spinta, "DomenoIstorijosNs", nsOps, dryRun);
        await checkedBatch(spinta, "DomenoIstorija", [deleteOp(history)], dryRun);
        stats.delete += nsOps.length + 1;
    }
    return stats;
}

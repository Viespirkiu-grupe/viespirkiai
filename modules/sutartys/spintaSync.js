import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { createSpintaClient } from "../spinta/index.js";
import { buildSpintaRecords, fetchMd5Lookup } from "./eksportas.js";
import {
    VPM_SUTARTIS_ROW_SELECT,
    VPM_SUTARTIS_ROW_FROM,
} from "./vpmSutartisRow.js";

const DATASET = "sutartys";
const CHILD_MODELS = [
    { model: "Bvpz", key: "kodas", field: "bvpz" },
    { model: "Tiekejas", key: "kodas", field: "tiekejai" },
    { model: "Dokumentas", key: "fileId", field: "dokumentai" },
];
const META_FIELDS = new Set(["_id", "_revision", "_type", "_created"]);

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
    const patch = {};
    for (const [key, value] of Object.entries(desired)) {
        if (skip.has(key)) continue;
        if (!equal(current?.[key], value)) patch[key] = value;
    }
    return patch;
}

function deleteOp(row) {
    return {
        _op: "delete",
        _id: row._id,
        ...(row._revision ? { _revision: row._revision } : {}),
    };
}

export function diffChildren(currentRows, desiredRows, key, parentId) {
    const current = new Map();
    const deletes = [];
    for (const row of currentRows) {
        const value = row?.[key];
        if (value == null || current.has(String(value))) {
            if (row?._id) deletes.push(deleteOp(row));
            continue;
        }
        current.set(String(value), row);
    }

    const desired = new Map();
    for (const row of desiredRows) {
        const value = row?.[key];
        if (value != null) desired.set(String(value), row);
    }

    const inserts = [];
    const patches = [];
    for (const [value, row] of desired) {
        const existing = current.get(value);
        if (!existing) {
            inserts.push({
                _op: "insert",
                sutartis: { _id: parentId },
                ...row,
            });
            continue;
        }
        current.delete(value);
        const patch = buildPatch(existing, row, [key, "sutartis"]);
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

function rows(result) {
    return Array.isArray(result?._data) ? result._data : [];
}

async function checkedBatch(spinta, model, ops, dryRun) {
    if (!ops.length || dryRun) return { _data: [] };
    const result = await spinta.batch(model, ops);
    const errors = rows(result).flatMap((row) => row?._errors ?? []);
    if (errors.length) {
        throw new Error(`${model}: ${errors.length} Spintos batch klaidos: ${JSON.stringify(errors.slice(0, 3))}`);
    }
    return result;
}

function namespace() {
    const org = (config.spintaNamespace || "").replace(/\/+$/, "");
    if (!org) throw new Error("Spinta: config.spintaNamespace not set.");
    return `${org}/${DATASET}`;
}

export function createSutartysSpintaClient() {
    return createSpintaClient({ namespace: namespace() });
}

export function isSutartysSpintaConfigured() {
    return Boolean(
        config.spintaServer &&
        config.spintaNamespace &&
        (config.spintaApiKey || (config.spintaClient && config.spintaSecret)),
    );
}

export async function fetchActiveSutartysByIds(ids) {
    if (!ids.length) return [];
    const { rows } = await postgres.query(
        `SELECT ${VPM_SUTARTIS_ROW_SELECT},
            a."tiekPavPatikslinimas",
            a."tiekSalis",
            ai."tiekSbjPatikslinimas" AS "tiekPavPatikslinimasImp",
            ai."tiekSalis" AS "tiekSalisImp"
         FROM ${VPM_SUTARTIS_ROW_FROM}
         LEFT JOIN public."sutartysAtviriDuomenys" a
           ON a."dokId" = s."unikalusId"
         LEFT JOIN public."sutartysAtviriDuomenysImp" ai
           ON ai."dokId" = s."unikalusId"
         WHERE s."unikalusId" = ANY($1::bigint[])
           AND s.istrinta = false`,
        [ids],
    );
    return rows;
}

async function getRemoteState(spinta, externalId) {
    const parents = rows(await spinta.getAll("Sutartis", { id: Number(externalId) }));
    const parent = parents[0] ?? null;
    if (!parent) return { parent: null, children: {} };

    const children = {};
    await Promise.all(CHILD_MODELS.map(async ({ model }) => {
        children[model] = rows(await spinta.getAll(model, {
            sutartis: `'${parent._id}'`,
        }));
    }));
    return { parent, children };
}

async function findRemoteSutartisId(spinta, externalId) {
    return rows(await spinta.getAll("Sutartis", { id: Number(externalId) }))[0]?._id ?? null;
}

async function removeRemoteSutartis(spinta, state, dryRun) {
    if (!state.parent) return { insert: 0, patch: 0, delete: 0, unchanged: 1 };
    let deleted = 0;
    for (const { model } of CHILD_MODELS) {
        const ops = (state.children[model] ?? []).filter((row) => row?._id).map(deleteOp);
        await checkedBatch(spinta, model, ops, dryRun);
        deleted += ops.length;
    }
    await checkedBatch(spinta, "Sutartis", [deleteOp(state.parent)], dryRun);
    return { insert: 0, patch: 0, delete: deleted + 1, unchanged: 0 };
}

export async function syncSutartisToSpinta({
    id,
    row = null,
    md5Lookup = new Map(),
    spinta = createSutartysSpintaClient(),
    dryRun = false,
}) {
    const state = await getRemoteState(spinta, id);
    if (!row) return removeRemoteSutartis(spinta, state, dryRun);

    const desired = buildSpintaRecords(row, md5Lookup);
    let parentId = state.parent?._id;
    const stats = { insert: 0, patch: 0, delete: 0, unchanged: 0 };

    if (!state.parent) {
        const op = { _op: "insert", ...desired.parent };
        const result = await checkedBatch(spinta, "Sutartis", [op], dryRun);
        parentId = dryRun ? `dry-${id}` : rows(result)[0]?._id ?? await findRemoteSutartisId(spinta, id);
        if (!parentId) throw new Error(`Sutartis ${id}: Spinta negrąžino parent _id`);
        stats.insert++;
    } else {
        const patch = buildPatch(state.parent, desired.parent, ["id"]);
        if (Object.keys(patch).length) {
            await checkedBatch(spinta, "Sutartis", [{
                _op: "patch",
                _id: state.parent._id,
                ...(state.parent._revision ? { _revision: state.parent._revision } : {}),
                ...patch,
            }], dryRun);
            stats.patch++;
        } else {
            stats.unchanged++;
        }
    }

    for (const { model, key, field } of CHILD_MODELS) {
        const diff = diffChildren(state.children[model] ?? [], desired[field], key, parentId);
        await checkedBatch(spinta, model, diff.ops, dryRun);
        stats.insert += diff.inserts.length;
        stats.patch += diff.patches.length;
        stats.delete += diff.deletes.length;
        stats.unchanged += desired[field].length - diff.inserts.length - diff.patches.length;
    }
    return stats;
}

export async function syncSutartysToSpinta({ ids, spinta, dryRun = false }) {
    const activeRows = await fetchActiveSutartysByIds(ids);
    const byId = new Map(activeRows.map((row) => [Number(row.sutartiesUnikalusId), row]));
    const md5Lookup = await fetchMd5Lookup(activeRows);
    const total = { insert: 0, patch: 0, delete: 0, unchanged: 0 };
    for (const rawId of ids) {
        const id = Number(rawId);
        const stats = await syncSutartisToSpinta({
            id,
            row: byId.get(id) ?? null,
            md5Lookup,
            spinta,
            dryRun,
        });
        for (const key of Object.keys(total)) total[key] += stats[key];
    }
    return total;
}

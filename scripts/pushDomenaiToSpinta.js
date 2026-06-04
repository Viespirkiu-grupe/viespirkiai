/**
 * Domenų pumpavimas į Spintos API.
 *
 * Pagal kiekvieną `domenai` batch'ą iš PG:
 *   1) upsert Domenas + DomenoNs
 *   2) iš `domenaiScrapes` ištraukia visus to batch'o domenų snapshot'us
 *   3) upsert DomenoIstorija + DomenoIstorijosNs naudojant ką tik gautus _id
 *
 * Tokia tvarka leidžia žemėlapį `domain → Spinta _id` laikyti tik vienam batch'ui
 * (≤ batchSize įrašų), todėl RAM nesikaupia visam domenų sąrašui.
 *
 * Idempotencija: upsert pagal natūralius raktus.
 *   - Domenas: domain
 *   - DomenoNs: (domain, ns)
 *   - DomenoIstorija: scrapeId
 *   - DomenoIstorijosNs: (scrapeId, ns)
 */
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { createSpintaClient } from "../modules/spinta/index.js";
import {
    iterateDomenai,
    fetchScrapesForDomains,
    buildDomenasRecord,
    buildIstorijaRecord,
} from "../modules/domenai/eksportas.js";

const DOMENAI_DATASET = "domenai";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};

const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 500));
const skipScrapes = flag("--skip-scrapes");
const dryRun = flag("--dry-run");

const orgNamespace = (config.spintaNamespace || "").replace(/\/+$/, "");
if (!orgNamespace) {
    throw new Error("Spinta: config.spintaNamespace not set.");
}
const spinta = createSpintaClient({ namespace: `${orgNamespace}/${DOMENAI_DATASET}` });

const CHILD_SUB_BATCH = 100;
const SUB_BATCH_CONCURRENCY = 4;
const BATCH_CONCURRENCY = 4;

const t0 = Date.now();
const log = (msg) => {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`[${dt}s] ${msg}\n`);
};

async function upsertBatch(model, ops) {
    if (!ops.length) return [];
    if (dryRun) {
        process.stdout.write(`[dry-run] ${model} × ${ops.length}\n`);
        return ops.map((_, i) => ({ _id: `dry-${model}-${i}` }));
    }
    const slices = [];
    for (let i = 0; i < ops.length; i += CHILD_SUB_BATCH) {
        slices.push({ i, slice: ops.slice(i, i + CHILD_SUB_BATCH) });
    }

    const results = new Array(slices.length);
    let next = 0;
    async function worker() {
        while (true) {
            const idx = next++;
            if (idx >= slices.length) return;
            const { i, slice } = slices[idx];
            const res = await spinta.batch(model, slice);
            const rows = Array.isArray(res?._data) ? res._data : [];
            const errors = rows.flatMap((r) => r?._errors ?? []);
            if (errors.length) {
                console.warn(`${model} sub-batch ${i}-${i + slice.length}: ${errors.length} klaidos.`, errors.slice(0, 3));
            }
            results[idx] = rows;
        }
    }
    await Promise.all(Array.from({ length: SUB_BATCH_CONCURRENCY }, worker));
    return results.flat();
}

const VALID_NS_HOST = /^[a-zA-Z0-9.\-]+$/;

function buildNsOps(parentRef, parentKey, ns) {
    const ops = [];
    for (const host of ns) {
        if (!VALID_NS_HOST.test(host)) {
            log(`praleista netinkamas NS host: ${JSON.stringify(host)}`);
            continue;
        }
        ops.push({
            _op: "upsert",
            _where: `${parentKey}._id="${parentRef}"&ns="${host}"`,
            [parentKey]: { _id: parentRef },
            ns: host,
        });
    }
    return ops;
}

async function processDomenaiBatch(rows) {
    const records = rows.map(buildDomenasRecord);

    const parentOps = records.map((r) => ({
        _op: "upsert",
        _where: `domain="${r.parent.domain}"`,
        ...r.parent,
    }));
    const parentRes = await upsertBatch("Domenas", parentOps);

    /** domain → Spinta _id, gyvas tik šio batch'o apimtyje */
    const domainToId = new Map();
    /** dbId (domenai.id) → Spinta _id */
    const dbIdToSpintaId = new Map();
    const nsOps = [];
    for (let i = 0; i < records.length; i++) {
        const internalId = parentRes[i]?._id;
        if (!internalId) continue;
        domainToId.set(records[i].parent.domain, internalId);
        dbIdToSpintaId.set(Number(rows[i].id), internalId);
        nsOps.push(...buildNsOps(internalId, "domain", records[i].ns));
    }
    await upsertBatch("DomenoNs", nsOps);

    return { domainCount: records.length, dbIdToSpintaId };
}

async function processScrapesForBatch(dbIdToSpintaId) {
    if (skipScrapes) return { total: 0, skipped: 0 };
    const domainIds = [...dbIdToSpintaId.keys()];
    const scrapeRows = await fetchScrapesForDomains(domainIds);
    if (!scrapeRows.length) return { total: 0, skipped: 0 };

    const records = scrapeRows.map(buildIstorijaRecord);
    const parentOps = [];
    const parentMeta = [];
    let skipped = 0;
    for (let i = 0; i < records.length; i++) {
        const parentDomainId = dbIdToSpintaId.get(Number(scrapeRows[i].domainId));
        if (!parentDomainId) {
            skipped++;
            continue;
        }
        const { domain: _drop, ...rest } = records[i].parent;
        parentOps.push({
            _op: "upsert",
            _where: `scrapeId=${records[i].parent.scrapeId}`,
            ...rest,
            domain: { _id: parentDomainId },
        });
        parentMeta.push(records[i]);
    }

    const parentRes = await upsertBatch("DomenoIstorija", parentOps);

    const nsOps = [];
    for (let i = 0; i < parentMeta.length; i++) {
        const internalId = parentRes[i]?._id;
        if (!internalId) continue;
        nsOps.push(...buildNsOps(internalId, "scrapeId", parentMeta[i].ns));
    }
    await upsertBatch("DomenoIstorijosNs", nsOps);

    return { total: parentOps.length, skipped };
}

async function main() {
    console.log(
        `Spinta server: ${spinta.server}; namespace: ${spinta.namespace}; ` +
        `batch=${batchSize}; startAfter=${startAfterId}${dryRun ? "; DRY-RUN" : ""}` +
        `${skipScrapes ? "; SKIP-SCRAPES" : ""}`,
    );

    let totalDomenai = 0;
    let totalScrapes = 0;
    let totalSkipped = 0;
    let lastId = startAfterId;
    let batchNo = 0;

    const iter = iterateDomenai({ batchSize, startAfterId });

    async function batchWorker() {
        while (true) {
            const { value, done } = await iter.next();
            if (done) return;
            const { rows, afterId } = value;
            const myNo = ++batchNo;
            log(`#${myNo} fetched ${rows.length} domenų (id ≤ ${afterId})`);

            const { domainCount, dbIdToSpintaId } = await processDomenaiBatch(rows);
            const scrapeRes = await processScrapesForBatch(dbIdToSpintaId);

            totalDomenai += domainCount;
            totalScrapes += scrapeRes.total;
            totalSkipped += scrapeRes.skipped;
            if (afterId > lastId) lastId = afterId;

            const dt = (Date.now() - t0) / 1000;
            const rate = (totalDomenai / dt).toFixed(1);
            log(`#${myNo} ✓ viso ${totalDomenai} domenų (+${scrapeRes.total} snapshot'ų), ${rate} dom/s, last id ${lastId}`);
        }
    }

    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, batchWorker));

    console.log(
        `Baigta per ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
        `${totalDomenai} domenų, ${totalScrapes} istorijos įrašų` +
        (totalSkipped ? ` (praleista ${totalSkipped})` : "") + ".",
    );
    console.log(`Tęsti nuo: --after ${lastId}`);
}

main()
    .catch((error) => {
        console.error("Failed to push domenai to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });

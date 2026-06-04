/**
 * Sutarčių pumpavimas į Spintos API.
 *
 * Skaito tiesiai iš PG (per modules/sutartys/eksportas.js), transformuoja į
 * 4 modelius (Sutartis + Bvpz + Tiekejas + Dokumentas) ir POST'ina batch'ais
 * NDJSON formatu.
 *
 * Idempotencija: upsert pagal natūralius raktus.
 *   - Sutartis: id (mūsų CVP IS sutarties unikalus ID)
 *   - Bvpz:     (sutartis, kodas)
 *   - Tiekejas: (sutartis, kodas)   — eilutės be kodo praleidžiamos
 *   - Dokumentas: (sutartis, fileId)
 */
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { createSpintaClient } from "../modules/spinta/index.js";
import { buildSpintaRecords, iterateBatches } from "../modules/sutartys/eksportas.js";

const SUTARTYS_DATASET = "sutartys";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};

const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 200));
const dryRun = flag("--dry-run");

const orgNamespace = (config.spintaNamespace || "").replace(/\/+$/, "");
if (!orgNamespace) {
    throw new Error("Spinta: config.spintaNamespace not set (pvz. „viespirkiai“).");
}
const spinta = createSpintaClient({ namespace: `${orgNamespace}/${SUTARTYS_DATASET}` });

async function upsertParents(records) {
    const ops = records.map((r) => ({
        _op: "upsert",
        _where: `id=${r.parent.id}`,
        ...r.parent,
    }));
    if (dryRun) {
        process.stdout.write(`[dry-run] Sutartis × ${ops.length}\n`);
        return new Map(records.map((r) => [r.parent.id, `dry-${r.parent.id}`]));
    }
    const res = await spinta.batch("Sutartis", ops);
    const rows = Array.isArray(res?._data) ? res._data : [];
    const errors = rows.flatMap((r) => r?._errors ?? []);
    if (errors.length) {
        console.warn(`Sutartis batch: ${errors.length} klaidos.`, errors.slice(0, 3));
    }
    const idMap = new Map();
    for (let i = 0; i < rows.length; i++) {
        const externalId = records[i]?.parent.id;
        const internalId = rows[i]?._id;
        if (externalId != null && internalId) idMap.set(externalId, internalId);
    }
    return idMap;
}

function collectChildren(records, parentIdMap) {
    const bvpz = [];
    const tiekejai = [];
    const dokumentai = [];
    for (const r of records) {
        const parentRef = parentIdMap.get(r.parent.id);
        if (!parentRef) continue;
        const sutartis = { _id: parentRef };

        for (const b of r.bvpz) {
            if (!b.kodas) continue;
            bvpz.push({
                _op: "upsert",
                _where: `sutartis._id="${parentRef}"&kodas="${b.kodas}"`,
                sutartis,
                kodas: b.kodas,
                pavadinimas: b.pavadinimas,
            });
        }

        for (const t of r.tiekejai) {
            if (!t.kodas) continue;
            tiekejai.push({
                _op: "upsert",
                _where: `sutartis._id="${parentRef}"&kodas="${t.kodas}"`,
                sutartis,
                kodas: t.kodas,
                pavadinimas: t.pavadinimas,
                patikslinimas: t.patikslinimas,
                salis: t.salis,
            });
        }

        for (const d of r.dokumentai) {
            dokumentai.push({
                _op: "upsert",
                _where: `sutartis._id="${parentRef}"&fileId="${d.fileId}"`,
                sutartis,
                dokId: d.dokId,
                fileId: d.fileId,
                pavadinimas: d.pavadinimas,
                md5: d.md5 ?? null,
            });
        }
    }
    return { bvpz, tiekejai, dokumentai };
}

const CHILD_SUB_BATCH = 250;

async function pushChildren(model, ops) {
    if (!ops.length) return;
    if (dryRun) {
        process.stdout.write(`[dry-run] ${model} × ${ops.length}\n`);
        return;
    }
    for (let i = 0; i < ops.length; i += CHILD_SUB_BATCH) {
        const slice = ops.slice(i, i + CHILD_SUB_BATCH);
        const res = await spinta.batch(model, slice);
        const errors = (res?._data ?? []).flatMap((r) => r?._errors ?? []);
        if (errors.length) {
            console.warn(`${model} sub-batch ${i}-${i + slice.length}: ${errors.length} klaidos.`, errors.slice(0, 3));
        }
    }
}

async function main() {
    const t0 = Date.now();
    let total = 0;
    let lastId = startAfterId;

    console.log(
        `Spinta server: ${spinta.server}; namespace: ${spinta.namespace || "(none)"}; ` +
        `batch=${batchSize}; startAfter=${startAfterId}${dryRun ? "; DRY-RUN" : ""}`,
    );

    let batchNo = 0;
    const log = (msg) => {
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`[${dt}s] ${msg}\n`);
    };

    const iter = iterateBatches({ batchSize, startAfterId });
    let nextPromise = iter.next();
    while (true) {
        const { value, done } = await nextPromise;
        if (done) break;
        // Iškart paleidžiam kitą PG batch'ą lygiagrečiai su dabartiniu push'u.
        nextPromise = iter.next();

        const { rows, md5Lookup, afterId } = value;
        batchNo++;
        log(`#${batchNo} fetched ${rows.length} eilutės iš PG (id ≤ ${afterId})`);

        const records = rows.map((row) => buildSpintaRecords(row, md5Lookup));

        log(`#${batchNo} upserting ${records.length} Sutartis…`);
        const idMap = await upsertParents(records);

        const children = collectChildren(records, idMap);
        log(
            `#${batchNo} upserting children lygiagrečiai: ` +
            `${children.bvpz.length} Bvpz, ` +
            `${children.tiekejai.length} Tiekejas, ` +
            `${children.dokumentai.length} Dokumentas…`,
        );
        await Promise.all([
            pushChildren("Bvpz", children.bvpz),
            pushChildren("Tiekejas", children.tiekejai),
            pushChildren("Dokumentas", children.dokumentai),
        ]);

        total += records.length;
        lastId = afterId;
        const dt = (Date.now() - t0) / 1000;
        const rate = (total / dt).toFixed(1);
        log(`#${batchNo} ✓ viso ${total} sutarčių, ${rate}/s, last id ${lastId}`);
    }

    console.log(`Pushed ${total} sutarčių into Spinta in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    console.log(`Tęsti nuo: --after ${lastId}`);
}

main()
    .catch((error) => {
        console.error("Failed to push sutartys to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });

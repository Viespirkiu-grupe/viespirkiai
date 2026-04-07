import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

const QUICKWIT_URL = "http://127.0.0.1:7280/api/v1/failai/ingest";
const BATCH_SIZE = 1000;
const LT_MAP = {
    ą: "a",
    č: "c",
    ę: "e",
    ė: "e",
    į: "i",
    š: "s",
    ų: "u",
    ū: "u",
    ž: "z",
    Ą: "A",
    Č: "C",
    Ę: "E",
    Ė: "E",
    Į: "I",
    Š: "S",
    Ų: "U",
    Ū: "U",
    Ž: "Z",
};

function normalize(str) {
    return str.replace(/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g, (c) => LT_MAP[c]).toLowerCase();
}

function toNdjson(rows) {
    return rows
        .map((r) => {
            const doc = Object.fromEntries(
                Object.entries(r).filter(([, v]) => v !== null),
            );
            if (doc.tekstas) doc.tekstas = normalize(doc.tekstas);
            if (doc.pavadinimas) doc.pavadinimas = normalize(doc.pavadinimas);
            if (doc.ocrTimestamp)
                doc.ocrTimestamp = new Date(doc.ocrTimestamp).toISOString();
            if (doc.nuskaitymasTimestamp)
                doc.nuskaitymasTimestamp = new Date(
                    doc.nuskaitymasTimestamp,
                ).toISOString();
            if (doc.paskutinisParsiuntimoBandymas)
                doc.paskutinisParsiuntimoBandymas = new Date(
                    doc.paskutinisParsiuntimoBandymas,
                ).toISOString();
            return JSON.stringify(doc);
        })
        .join("\n");
}

function fetchBatch(fromId) {
    return postgres.query(
        `SELECT
            id, "dokId", "fileId", pavadinimas, extension, dydis, md5, saltinis, "saltinioId", tekstas,
            "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius",
            parsiustas, "parsiuntimoBandymai", "paskutinisParsiuntimoBandymas",
            nuskaitytas, "ocrState", "ocrNode", "ocrBandymai",
            "ocrDuration", "ocrTimestamp",
            parent, password, metaduomenys
        FROM failai
        WHERE id > $1
        ORDER BY id ASC
        LIMIT $2`,
        [fromId, BATCH_SIZE],
    );
}

async function ingest(ndjson) {
    const res = await fetch(`${QUICKWIT_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: ndjson,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Quickwit ${res.status}: ${body}`);
    return body;
}

let lastId = parseInt(process.argv[2] ?? "0");
let total = 0;
let batch = 1;

log(`Starting from id: ${lastId}`);

let pgStart = Date.now();
let nextPromise = fetchBatch(lastId);

while (true) {
    log(`Batch ${batch}, last id: ${lastId}`);
    batch++;

    const { rows } = await nextPromise;
    log(`Postgres took ${Date.now() - pgStart}ms, got ${rows.length} rows`);

    if (rows.length === 0) break;

    const nextLastId = rows.at(-1).id;

    // Kick off next fetch while we ingest current batch
    pgStart = Date.now();
    nextPromise = fetchBatch(nextLastId);

    const ndjson = toNdjson(rows);

    const indexStart = Date.now();
    try {
        console.log(await ingest(ndjson));
    } catch (err) {
        console.error(`Quickwit error at id>${lastId}:`, err.message);
        process.exit(1);
    }
    log(`Quickwit indexing took ${Date.now() - indexStart}ms`);

    lastId = nextLastId;
    total += rows.length;
    log(`Indexed ${total} files (last id: ${lastId})`);

    if (rows.length < BATCH_SIZE) break;
}

log(`Done. Total indexed: ${total}`);

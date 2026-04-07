import { postgres } from "../../postgres/postgres.js";

const QUICKWIT_URL = "http://127.0.0.1:7280/api/v1/failai/ingest";

const { rows } = await postgres.query(
    `SELECT
        id, "dokId", "fileId", pavadinimas, extension, dydis, md5, saltinis, "saltinioId", tekstas,
        "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius",
        parsiustas, "parsiuntimoBandymai", "paskutinisParsiuntimoBandymas",
        nuskaitytas, "ocrState", "ocrNode", "ocrBandymai",
        "ocrDuration", "ocrTimestamp",
        parent, password, metaduomenys
    FROM failai
    WHERE id = 1`,
);

const row = rows[0];
console.log("Raw row:", JSON.stringify(row, null, 2));

const doc = Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== null),
);

if (doc.ocrTimestamp)
    doc.ocrTimestamp = new Date(doc.ocrTimestamp).toISOString();
if (doc.nuskaitymasTimestamp)
    doc.nuskaitymasTimestamp = new Date(doc.nuskaitymasTimestamp).toISOString();
if (doc.paskutinisParsiuntimoBandymas)
    doc.paskutinisParsiuntimoBandymas = new Date(
        doc.paskutinisParsiuntimoBandymas,
    ).toISOString();
console.log("Doc to ingest:", JSON.stringify(doc, null, 2));

const res = await fetch(`${QUICKWIT_URL}?commit=force`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
});

const body = await res.text();
console.log(`Response ${res.status}:`, body);

// Wait a moment then search
await new Promise((r) => setTimeout(r, 3000));

const search = await fetch("http://127.0.0.1:7280/api/v1/failai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "id:[1 TO 1]", max_hits: 1 }),
});
console.log("Search result:", await search.text());

// Laikinas skriptas: suminis e-TAR teisės aktų žodžių ir simbolių skaičius.
//
// Postgres'e ("eTarLegalActDocument") guli tik md5, o pats tekstas — sidecar'e
// (SQLite, zstd). Tad: iš SQL paimam visų dokumentų md5, o skaičiuojam iš
// sidecar'o `official_text.text`.
//
// Paleisti iš projekto šaknies:  node <šis failas>

import { postgres } from "/root/viespirkiaiDev/postgres/postgres.js";
import { openETarSidecar, readResponse } from "/root/viespirkiaiDev/modules/eTar/eTarSidecar.js";

const PROGRESS_MS = 100;

function formatuoti(n) {
    return n.toLocaleString("lt-LT");
}

function trukme(ms) {
    const s = Math.round(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Žodis = bet kokia ne tarpų seka. Simboliai — su tarpais, kaip tekste.
function suskaiciuoti(tekstas) {
    const zodziai = tekstas.split(/\s+/).filter(Boolean).length;
    return { zodziai, simboliai: tekstas.length };
}

async function main() {
    process.stdout.write("Imamas dokumentų sąrašas iš SQL…\n");
    const { rows } = await postgres.query(
        `SELECT "documentId", "md5" FROM "eTarLegalActDocument" WHERE "md5" IS NOT NULL`,
    );
    const viso = rows.length;
    process.stdout.write(`Dokumentų: ${formatuoti(viso)}\n\n`);

    const db = openETarSidecar({ readonly: true });

    let patikrinta = 0;
    let suTekstu = 0;
    let beTeksto = 0;
    let neRastaSidecare = 0;
    let zodziai = 0;
    let simboliai = 0;

    const pradzia = Date.now();
    let pieštaMs = 0;

    const piesti = (galutinis = false) => {
        const praejo = Date.now() - pradzia;
        const greitis = patikrinta / Math.max(praejo / 1000, 0.001);
        const liko = viso - patikrinta;
        const eta = greitis > 0 ? trukme((liko / greitis) * 1000) : "--:--";
        const proc = viso ? ((patikrinta / viso) * 100).toFixed(1) : "0.0";
        const eilute =
            `patikrinta ${formatuoti(patikrinta)}/${formatuoti(viso)} (${proc}%) · ` +
            `liko ${formatuoti(liko)} · ${Math.round(greitis)}/s · ETA ${eta} · ` +
            `žodžių ${formatuoti(zodziai)} · simbolių ${formatuoti(simboliai)}`;
        process.stdout.write("\r\x1b[2K" + eilute + (galutinis ? "\n" : ""));
    };

    for (const row of rows) {
        let payload = null;
        try {
            payload = readResponse(db, row.md5);
        } catch {
            // sugadintas įrašas — tolygu „nerasta"
        }
        if (!payload) {
            neRastaSidecare++;
        } else {
            const tekstas = payload?.official_text?.text;
            if (typeof tekstas === "string" && tekstas.length) {
                const r = suskaiciuoti(tekstas);
                zodziai += r.zodziai;
                simboliai += r.simboliai;
                suTekstu++;
            } else {
                beTeksto++;
            }
        }
        patikrinta++;

        // Piešiam ne dažniau nei kas 100 ms (Date.now() pigus, laikmačio nereikia).
        const dabar = Date.now();
        if (dabar - pieštaMs >= PROGRESS_MS) {
            pieštaMs = dabar;
            piesti();
        }
    }
    piesti(true);

    const praejo = Date.now() - pradzia;
    process.stdout.write(
        `\nRezultatas\n` +
            `  dokumentų patikrinta : ${formatuoti(patikrinta)}\n` +
            `    su tekstu          : ${formatuoti(suTekstu)}\n` +
            `    be teksto          : ${formatuoti(beTeksto)}\n` +
            `    nerasta sidecar'e  : ${formatuoti(neRastaSidecare)}\n` +
            `  žodžių iš viso       : ${formatuoti(zodziai)}\n` +
            `  simbolių iš viso     : ${formatuoti(simboliai)}\n` +
            `  vidutiniškai žodžių  : ${formatuoti(suTekstu ? Math.round(zodziai / suTekstu) : 0)} / aktą\n` +
            `  truko                : ${trukme(praejo)}\n`,
    );

    await postgres.end();
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    },
);

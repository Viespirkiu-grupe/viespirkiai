// Laikinas skriptas: kurių Dokumentas.csv id nėra "eTarLegalAct" lentelėje.
//
// CSV — vieno stulpelio (antraštė `dokumento_id`). Tikrinam pakuotėmis po 1000:
// vienas `= ANY($1)` klausimas grąžina, kurie iš tos tūkstantinės DB YRA, o
// trūkstami — likutis. Trūkstami spausdinami į console iškart.
//
// Paleisti iš projekto šaknies:  node scripts/eTarTrukstamiIdCsv.js [csv] [išvestis]

import { readFileSync, writeFileSync } from "node:fs";
import { postgres } from "/root/viespirkiaiDev/postgres/postgres.js";

const PAKUOTE = 1000;
const PROGRESS_MS = 100;

const csvFailas = process.argv[2] ?? "/root/viespirkiaiDev/Dokumentas.csv";
const isvestiesFailas = process.argv[3] ?? "/root/viespirkiaiDev/eTarTrukstamiId.txt";

function formatuoti(n) {
    return n.toLocaleString("lt-LT");
}

function trukme(ms) {
    const s = Math.round(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Vienas stulpelis, tad tik nuvalom kabutes/tarpus ir numetam antraštę. */
function skaitytiCsv(kelias) {
    const eilutes = readFileSync(kelias, "utf8").split(/\r?\n/);
    const id = [];
    const matyti = new Set();
    let dublikatu = 0;
    for (const [i, neapdorota] of eilutes.entries()) {
        const reiksme = neapdorota.trim().replace(/^"|"$/g, "");
        if (!reiksme) continue;
        if (i === 0 && !/^[A-Za-z0-9._-]+$/.test(reiksme)) continue;   // antraštė
        if (matyti.has(reiksme)) { dublikatu++; continue; }
        matyti.add(reiksme);
        id.push(reiksme);
    }
    return { id, dublikatu };
}

async function main() {
    process.stdout.write(`Skaitomas ${csvFailas}…\n`);
    const { id, dublikatu } = skaitytiCsv(csvFailas);
    const viso = id.length;
    process.stdout.write(`CSV unikalių id: ${formatuoti(viso)}${dublikatu ? ` (dublikatų praleista: ${formatuoti(dublikatu)})` : ""}\n\n`);

    const trukstami = [];
    let patikrinta = 0;

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
            `trūksta ${formatuoti(trukstami.length)}`;
        process.stdout.write("\r\x1b[2K" + eilute + (galutinis ? "\n" : ""));
    };

    for (let nuo = 0; nuo < viso; nuo += PAKUOTE) {
        const pakuote = id.slice(nuo, nuo + PAKUOTE);
        const { rows } = await postgres.query(
            `SELECT "legalActId" FROM "eTarLegalAct" WHERE "legalActId" = ANY($1)`,
            [pakuote],
        );
        const yra = new Set(rows.map(r => r.legalActId));
        const trūkoŠioje = pakuote.filter(x => !yra.has(x));
        patikrinta += pakuote.length;

        if (trūkoŠioje.length) {
            trukstami.push(...trūkoŠioje);
            // Progreso eilutė nusitrina, kad trūkstami liktų švariame sąraše.
            process.stdout.write("\r\x1b[2K");
            for (const x of trūkoŠioje) console.log(x);
            pieštaMs = 0;
        }

        const dabar = Date.now();
        if (dabar - pieštaMs >= PROGRESS_MS) {
            pieštaMs = dabar;
            piesti();
        }
    }
    piesti(true);

    writeFileSync(isvestiesFailas, trukstami.length ? trukstami.join("\n") + "\n" : "", "utf8");

    const praejo = Date.now() - pradzia;
    process.stdout.write(
        `\nRezultatas\n` +
            `  CSV id patikrinta : ${formatuoti(patikrinta)}\n` +
            `  rasta lentelėje   : ${formatuoti(patikrinta - trukstami.length)}\n` +
            `  TRŪKSTA           : ${formatuoti(trukstami.length)}\n` +
            `  truko             : ${trukme(praejo)}\n` +
            `  failas            : ${isvestiesFailas}\n`,
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

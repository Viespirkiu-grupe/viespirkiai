// benchmarks/sidecarSkaitymas.js
//
// Kiek kainuoja N atsitiktinių sidecar'o raktų vienu ypu, priklausomai nuo
// skaitymo gijų skaičiaus (`SIDECAR_READ_THREADS`, žr. utils/sqliteSidecarPoolas.js).
//
// Matuojam per tikrą saugyklos API (`createCompressedSqliteStore().readManyRaw`),
// ne per atskirą benchmark'o kopiją — kitaip išmatuotume ne tą kelią, kuriuo eina
// aplikacija.
//
// Kiekvienas matavimas gauna SAVO šviežius atsitiktinius raktus: `dokumentai`
// (66 GB) į RAM netelpa, tad tai matuoja atsitiktinį disko skaitymą. Bendri
// raktai iškreiptų rezultatą — antrasis eilėje matavimas rastų juos jau cache'e.
// Pabaigoje vienas rinkinys kartojamas – tai „šiltas" skaičius.
//
// Vidurkiai gyvame mazge nieko nesako (tuo pačiu disku dirba taskrunneris ir
// pasitaiko kelių sekundžių išsišokimų), tad lyginam MEDIANAS.
//
// Paleidimas:
//   node benchmarks/sidecarSkaitymas.js
//   GIJOS=1,2,4,8,16 RAUNDAI=25 RAKTU=50 SIDECAR=eTar node benchmarks/sidecarSkaitymas.js

import { performance } from "node:perf_hooks";
import config from "../utils/config.js";
import { openSqlite } from "../utils/sqlite.js";
import { sidecarDbPath, sidecarKeyColumn, sidecarTable } from "../utils/sidecarPaths.js";
import {
    closeCompressedSqliteStores,
    createCompressedSqliteStore,
    quoteIdentifier,
} from "../utils/sqliteSidecarStore.js";

const SIDECAR = process.env.SIDECAR || "dokumentai";
const RAKTU = Number(process.env.RAKTU || 50);
const RAUNDAI = Number(process.env.RAUNDAI || 25);
const GIJOS = (process.env.GIJOS || "1,2,4,8,16").split(",").map(Number);

const lentele = quoteIdentifier(sidecarTable(SIDECAR));
const raktas = quoteIdentifier(sidecarKeyColumn(SIDECAR));

function atsitiktinisPrefiksas() {
    let s = "";
    for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
}

/**
 * Atsitiktiniai EGZISTUOJANTYS raktai: md5 pasiskirstę tolygiai, tad imam
 * atsitiktinį prefiksą ir pirmą už jį didesnį raktą — vienas indeksuotas
 * ieškojimas, o ne `ORDER BY RANDOM()` per 8 mln. eilučių.
 */
function atsitiktiniaiRaktai(db, kiek) {
    const stmt = db.prepare(
        `SELECT ${raktas} AS "raktas" FROM ${lentele} WHERE ${raktas} >= ? ORDER BY ${raktas} LIMIT 1`,
    );
    const matyti = new Set();
    while (matyti.size < kiek) {
        const row = stmt.get(atsitiktinisPrefiksas());
        if (row) matyti.add(row.raktas);
    }
    return [...matyti];
}

function suvestine(ms) {
    const surusiuoti = [...ms].sort((a, b) => a - b);
    const mediana = surusiuoti[Math.floor(surusiuoti.length / 2)];
    const vidurkis = ms.reduce((a, b) => a + b, 0) / ms.length;
    return { mediana, vidurkis, min: surusiuoti[0], max: surusiuoti.at(-1) };
}

function eilute(pavadinimas, s) {
    return `${pavadinimas}  med ${s.mediana.toFixed(1).padStart(7)} ms   ` +
        `vid ${s.vidurkis.toFixed(1).padStart(8)} ms   min ${s.min.toFixed(1).padStart(6)}   ` +
        `max ${s.max.toFixed(1).padStart(8)}   ${(s.mediana / RAKTU).toFixed(2)} ms/raktas`;
}

async function main() {
    const dbPath = sidecarDbPath(SIDECAR);
    if (!dbPath) throw new Error("SIDECAR_DIR nenustatytas");

    // Raktų parinkimui – sava jungtis, kad ji nepatektų į matavimą.
    const db = openSqlite({ dbPath, readonly: true });
    console.log(`${SIDECAR}: ${dbPath}`);
    console.log(`${RAUNDAI} raundai po ${RAKTU} atsitiktinių raktų, gijos: ${GIJOS.join(", ")}\n`);

    for (const gijos of GIJOS) {
        // Pool'as skaito `config` kvietimo metu, tad užtenka reikšmę pakeisti
        // ir uždaryti senas gijas.
        config.sidecarReadThreads = gijos;
        closeCompressedSqliteStores();
        const store = createCompressedSqliteStore({ sidecar: SIDECAR });

        const salti = [];
        let pirmiRaktai = null;
        for (let r = 0; r < RAUNDAI; r++) {
            const keys = atsitiktiniaiRaktai(db, RAKTU);
            pirmiRaktai ??= keys;
            const t = performance.now();
            const found = await store.readManyRaw(keys);
            salti.push(performance.now() - t);
            if (found.size !== keys.length) {
                throw new Error(`gauta ${found.size} iš ${keys.length} — matavimas netikras`);
            }
        }

        const silti = [];
        for (let i = 0; i < 5; i++) {
            const t = performance.now();
            await store.readManyRaw(pirmiRaktai);
            silti.push(performance.now() - t);
        }

        const zyme = `${String(gijos).padStart(2)} gij.`;
        console.log(eilute(`${zyme} šalta `, suvestine(salti)));
        console.log(eilute(`${zyme} šilta `, suvestine(silti)));
    }

    db.close();
    closeCompressedSqliteStores();
}

main().catch((error) => {
    console.error("Benchmark nulūžo:", error);
    process.exitCode = 1;
});

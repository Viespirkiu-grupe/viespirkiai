// Laikinas skriptas: kiek e-TAR aktų yra kiekvieną dieną iš "eTar"."scrapeDay".
//
// Kiekvienai dienai — viena užklausa į paiešką (from=to=diena, page=1); imam tik
// `pagination.total_items`, puslapiuoti nereikia. Dienos tikrinamos lygiagrečiai;
// srauto ribą adapteriui laiko pats eTarApi klientas.
//
// Paleisti iš projekto šaknies:  node scripts/eTarDienuRezultatai.js [failas]

import { writeFileSync } from "node:fs";
import { postgres } from "/root/viespirkiaiDev/postgres/postgres.js";
import { createETarApi } from "/root/viespirkiaiDev/modules/eTar/eTarApi.js";

/** Kiek dienų tikrinam vienu metu (klientas pats susiaurina, jei adapteris skundžiasi). */
const DARBININKAI = 24;
const PROGRESS_MS = 100;

const isvestiesFailas = process.argv[2] ?? "/root/viespirkiaiDev/eTarDienuRezultatai.txt";

function formatuoti(n) {
    return n.toLocaleString("lt-LT");
}

function trukme(ms) {
    const s = Math.round(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function main() {
    process.stdout.write("Imamas dienų sąrašas iš SQL…\n");
    const { rows } = await postgres.query(
        `SELECT "day"::text AS day FROM "eTar"."scrapeDay" ORDER BY "day" DESC`,
    );
    const viso = rows.length;
    process.stdout.write(`Dienų: ${formatuoti(viso)}\n\n`);

    const api = createETarApi();

    // Rezultatai laikomi tvarkoje pagal indeksą — lygiagretumas eiliškumo nekeičia.
    const rezultatai = new Array(viso);
    let patikrinta = 0;
    let sumaAktu = 0;
    let klaidu = 0;

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
            `liko ${formatuoti(liko)} · ${greitis.toFixed(1)}/s · ETA ${eta} · ` +
            `aktų ${formatuoti(sumaAktu)}` +
            (klaidu ? ` · klaidų ${formatuoti(klaidu)}` : "");
        process.stdout.write("\r\x1b[2K" + eilute + (galutinis ? "\n" : ""));
    };

    let kitas = 0;
    async function darbininkas() {
        for (;;) {
            const i = kitas++;
            if (i >= viso) return;
            const day = rows[i].day;
            let eilute;
            try {
                const atsakymas = await api.searchLegalActs({ from: day, to: day, page: 1 });
                const kiek = atsakymas?.pagination?.total_items ?? 0;
                sumaAktu += kiek;
                eilute = `${day}\t${kiek}`;
            } catch (err) {
                klaidu++;
                eilute = `${day}\tKLAIDA\t${err.message}`;
            }
            rezultatai[i] = eilute;
            patikrinta++;

            const dabar = Date.now();
            if (dabar - pieštaMs >= PROGRESS_MS) {
                pieštaMs = dabar;
                piesti();
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(DARBININKAI, viso) }, darbininkas));
    piesti(true);

    process.stdout.write("\n");
    for (const eilute of rezultatai) process.stdout.write(eilute + "\n");

    writeFileSync(isvestiesFailas, rezultatai.join("\n") + "\n", "utf8");

    const praejo = Date.now() - pradzia;
    process.stdout.write(
        `\nRezultatas\n` +
            `  dienų patikrinta : ${formatuoti(patikrinta)}\n` +
            `  klaidų           : ${formatuoti(klaidu)}\n` +
            `  aktų iš viso     : ${formatuoti(sumaAktu)}\n` +
            `  vidutiniškai     : ${formatuoti(patikrinta - klaidu ? Math.round(sumaAktu / (patikrinta - klaidu)) : 0)} / dieną\n` +
            `  truko            : ${trukme(praejo)}\n` +
            `  failas           : ${isvestiesFailas}\n`,
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

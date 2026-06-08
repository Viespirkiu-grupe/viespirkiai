/*
Nuskaito teismo nuosprendžio turinį iš Liteko sistemos:
  * dalyvius (šalis)            -> teismoNuosprendziaiDalyviai (counts trigeris pats seka)
  * kategorijas (kodus+vardus)  -> teismoNuosprendziaiKategorijos
  * papildomus laukus           -> teismoNuosprendziai (teisminisProcesoNr, instancija, skyrius)
  * pilną tekstą + metadata     -> dokumentų paieška (sidecar + public.dokumentai)

Tekstas DB NESAUGOMAS — jis keliauja tik į dokumentų sidecar.
*/

import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { upsertNuosprendisToDokumentai } from "../dokumentai/upsertFromTeismoNuosprendziai.js";

const LITEKO_BASE = "https://liteko.teismai.lt/viesasprendimupaieska/";

// Turinio nuskaitymo versija (kaip failai.nuskaitytas). teismoNuosprendziai.turinioNuskaitymas
// reikšmės: 0/NULL = nenuskaityta; teigiamas = sėkmingo nuskaitymo versija; neigiamas = klaida.
// Pakėlus šį skaičių, senesnės versijos eilutės automatiškai vėl tampa tinkamos perskaityti.
//   v2: tekstas ištraukiamas be Word HTML <style>/<head> (CSS nebepatenka į tekstą).
export const TURINIO_VERSIJA = 2;

/** Pašalina pradžios „?" (daug nuosprendžių prasideda nuo jo), BOM ir tarpus. */
function cleanText(raw) {
    if (!raw) return "";
    return raw.replace(/^﻿/, "").replace(/^[\s?]+/, "").trim();
}

/**
 * Ištraukia nuosprendžio tekstą iš #txthtml. Dalies nuosprendžių turinys – įdėtas
 * pilnas Word sugeneruotas HTML dokumentas (su <head><style>), o linkedom innerText
 * naiviai įtraukia <style>/<head> turinį (CSS patenka į tekstą). Todėl pašalinam
 * ne-turinio elementus ir imam tik įdėtąjį <body>.
 */
function extractVerdictText(container) {
    if (!container) return "";
    const scope = container.querySelector("body") || container;
    scope
        .querySelectorAll("style, script, head, title, meta, link")
        .forEach((el) => el.remove());
    return scope.innerText || "";
}

/** Instancija išvedama iš teismo pavadinimo (detalės puslapyje atskiro lauko nėra). */
function instancijaFromTeismas(teismas) {
    if (!teismas) return null;
    if (/apeliacinis/i.test(teismas)) return "Apeliacinė instancija";
    if (/aukščiausiasis/i.test(teismas)) return "Kasacinė instancija";
    if (/apygardos/i.test(teismas)) return "Pirmosios/apeliacinės instancijos";
    if (/apylink/i.test(teismas)) return "Pirmosios instancijos";
    return null;
}

/**
 * Nuskaito nuosprendžio detalės puslapį ir ištraukia struktūrizuotus laukus + tekstą.
 * @param {string} fileHref - santykinė nuoroda (pvz. tekstas.aspx?id=<uuid>).
 */
async function nuskaitytiNutarti(fileHref) {
    const url = LITEKO_BASE + fileHref;
    log(`Nuskaitoma byla ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    const { document } = parseHTML(text);

    // ── Šalys (dalyviai): listsalys_ctrlN_Label2 (pavadinimas/vardas), Label4 (kodas),
    //    Label5 (byloje kaip). ────────────────────────────────────────────────
    const ctrlIdx = new Set();
    document
        .querySelectorAll('span[id^="ctl00_ContentPlaceHolder1_listsalys_ctrl"]')
        .forEach((el) => {
            const m = /listsalys_ctrl(\d+)_/.exec(el.id);
            if (m) ctrlIdx.add(Number(m[1]));
        });

    const get = (id) => document.querySelector("#" + id)?.textContent.trim() || "";
    let salys = [...ctrlIdx]
        .sort((a, b) => a - b)
        .map((i) => {
            const p = `ctl00_ContentPlaceHolder1_listsalys_ctrl${i}_`;
            const pavadinimas = [get(p + "Label2"), get(p + "Label3")]
                .filter(Boolean)
                .join(" ")
                .trim();
            return {
                pavadinimas,
                kodas: get(p + "Label4"),
                bylojeKaip: get(p + "Label5"),
            };
        });

    // ── Tekstas ────────────────────────────────────────────────────────────────
    const tekstas = cleanText(
        extractVerdictText(document.querySelector("#ctl00_ContentPlaceHolder1_txthtml")),
    );

    // ── Kategorijų pavadinimai (kategorijuList_ctrlN_Label2) ────────────────────
    const kategorijos = [
        ...document.querySelectorAll(
            'span[id^="ctl00_ContentPlaceHolder1_kategorijuList_ctrl"][id$="_Label2"]',
        ),
    ]
        .map((s) => s.textContent.trim())
        .filter(Boolean);

    // ── Laukai iš teksto antraštės ──────────────────────────────────────────────
    const teisminisProcesoNr =
        /Teisminio proceso Nr\.?\s*([0-9-]+)/i.exec(tekstas)?.[1] || null;

    const katKodaiRaw =
        /Procesinio sprendimo kategorij[a-ząčęėįšųūž]*\s*:?\s*([0-9.;\s]+)/i.exec(
            tekstas,
        )?.[1] || "";
    const kategorijuKodai = katKodaiRaw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);

    const skyrius =
        /([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+\s+bylų)\s+skyriaus/.exec(tekstas)?.[1]
            ? /([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+\s+bylų)\s+skyriaus/
                  .exec(tekstas)[1]
                  .concat(" skyrius")
            : null;

    const teisejai = [
        ...new Set(
            [
                ...tekstas.matchAll(
                    /teisėj(?:as|a|ai|ams|ų|os|us|ą|o)\b\s+([A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž-]+(?:\s+[A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž-]+){1,2})/g,
                ),
            ].map((m) => m[1].trim()),
        ),
    ];

    // Vieta: trumpa eilutė iškart po datos eilutės.
    let vieta = null;
    const lines = tekstas.split("\n").map((l) => l.trim()).filter(Boolean);
    const dIdx = lines.findIndex((l) => /^\d{4}\s*m\..*d\.\s*$/.test(l));
    if (
        dIdx >= 0 &&
        lines[dIdx + 1] &&
        lines[dIdx + 1].length < 30 &&
        /^[A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]+$/.test(lines[dIdx + 1])
    ) {
        vieta = lines[dIdx + 1];
    }

    // ── JAR kodai, minimi tekste (9 skaitm.) — kaip atskiri „dalyviai" ──────────
    const tekstoKodai = tekstas.match(/\b\d{9}\b/g) || [];
    for (const kodas of tekstoKodai) {
        salys.push({ pavadinimas: "", kodas, bylojeKaip: "Minima tekste" });
    }

    // Panaikiname pasikartojimus pagal kodą (paliekam pirmą — su vaidmeniu iš lentelės).
    salys = salys.filter(
        (item, index, arr) =>
            !item.kodas ||
            arr.findIndex((o) => o.kodas === item.kodas) === index,
    );

    return {
        salys,
        kategorijos,
        kategorijuKodai,
        tekstas,
        teisminisProcesoNr,
        skyrius,
        teisejai,
        vieta,
    };
}

// Kiek nuosprendžių apdoroti lygiagrečiai (tinklas — pagrindinis ribojantis veiksnys).
const CONCURRENCY = 10;

let rollingAverage = [];

/**
 * Nuskaito vieno nuosprendžio turinį ir įrašo dalyvius/kategorijas/tekstą.
 * Klaidos pažymimos (turinioNuskaitymas = -1), bet neperstabdo viso paketo.
 * @param {object} n - teismoNuosprendziai eilutė.
 */
async function nuskaitytiNuosprendi(n) {
    const start = Date.now();
    try {
        const detail = await nuskaitytiNutarti(n.fileHref);
        const instancija = instancijaFromTeismas(n.teismas);

        // Idempotentiškumas pakartotinai nuskaitant — išvalom senus vaikus.
        await postgres.query(
            `DELETE FROM "teismoNuosprendziaiDalyviai" WHERE "nuosprendzioId" = $1`,
            [n.id],
        );
        await postgres.query(
            `DELETE FROM "teismoNuosprendziaiKategorijos" WHERE "nuosprendzioId" = $1`,
            [n.id],
        );

        // Dalyviai (su kodais) — counts trigeris atnaujina automatiškai.
        const dalyviai = detail.salys.filter((s) => s.kodas);
        if (dalyviai.length) {
            const vals = dalyviai
                .map(
                    (_, i) =>
                        `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`,
                )
                .join(", ");
            const params = dalyviai.flatMap((s) => [
                n.id,
                s.pavadinimas || null,
                s.kodas,
                s.bylojeKaip || null,
                n.data,
            ]);
            await postgres.query(
                `INSERT INTO "teismoNuosprendziaiDalyviai"
                   ("nuosprendzioId","pavadinimas","kodas","bylojeKaip","data")
                 VALUES ${vals}`,
                params,
            );
        }

        // Kategorijos: kodai (autoritetingi) ir pavadinimai laikomi atskiromis
        // eilutėmis (jų kiekiai nesutampa, todėl 1:1 nesusieti).
        const katRows = [
            ...detail.kategorijuKodai.map((kodas) => ({ kodas, pavadinimas: null })),
            ...detail.kategorijos.map((pavadinimas) => ({ kodas: null, pavadinimas })),
        ];
        if (katRows.length) {
            const vals = katRows
                .map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`)
                .join(", ");
            const params = katRows.flatMap((k) => [n.id, k.kodas, k.pavadinimas]);
            await postgres.query(
                `INSERT INTO "teismoNuosprendziaiKategorijos"
                   ("nuosprendzioId","kodas","pavadinimas")
                 VALUES ${vals}`,
                params,
            );
        }

        // Papildomi laukai į šerdies lentelę + pažymim nuskaitymo versiją.
        await postgres.query(
            `UPDATE "teismoNuosprendziai"
             SET "teisminisProcesoNr" = COALESCE($2, "teisminisProcesoNr"),
                 "skyrius"            = COALESCE($3, "skyrius"),
                 "instancija"         = COALESCE($4, "instancija"),
                 "turinioNuskaitymas" = $5,
                 "atnaujinta"         = now()
             WHERE id = $1`,
            [n.id, detail.teisminisProcesoNr, detail.skyrius, instancija, TURINIO_VERSIJA],
        );

        // Tekstas + metadata į dokumentų paiešką (sidecar + dokumentai).
        await upsertNuosprendisToDokumentai(
            { ...n, teisminisProcesoNr: detail.teisminisProcesoNr, skyrius: detail.skyrius, instancija },
            detail,
        );
    } catch (e) {
        await postgres.query(
            `UPDATE "teismoNuosprendziai" SET "turinioNuskaitymas" = -1 WHERE id = $1`,
            [n.id],
        );
        console.error(e);
        log(`Klaida nuskaitant nuosprendį ID ${n.id}: ${e.message}`);
        return;
    }

    const duration = Date.now() - start;
    rollingAverage.push(duration);
    if (rollingAverage.length > 100) rollingAverage = rollingAverage.slice(-100);
    log(`Nuskaitytas nuosprendis ID ${n.id} — užtruko ${(duration / 1000).toFixed(3)}s`);
}

/**
 * Suranda nuosprendžius, kurių turinys dar nenuskaitytas (ar senesnės versijos),
 * ir juos apdoroja lygiagrečiai (iki CONCURRENCY vienu metu).
 * @param {number} batchSize - Kiek nuosprendžių paimti ir apdoroti viename pakete.
 * @returns {Promise<boolean>} - true, jei dar yra ką apdoroti, kitaip false.
 */
export async function surastiNuosprendzioDalyvius(batchSize = CONCURRENCY) {
    // Imam nenuskaitytus (0/NULL) ir senesnės versijos (>0, bet < dabartinės) įrašus.
    // Klaidų (neigiamų) automatiškai nekartojam — juos galima atstatyti su backfill --refresh.
    const { rows: nuosprendziai } = await postgres.query(
        `SELECT * FROM "teismoNuosprendziai"
         WHERE COALESCE("turinioNuskaitymas", 0) >= 0
           AND COALESCE("turinioNuskaitymas", 0) < $2
         LIMIT $1`,
        [batchSize, TURINIO_VERSIJA],
    );

    if (!nuosprendziai.length) {
        log("Visi nuosprendžiai nuskaityti.");
        return false;
    }

    // Lygiagretus darbininkų telkinys: iki CONCURRENCY nuosprendžių vienu metu.
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, nuosprendziai.length) }, async () => {
            while (cursor < nuosprendziai.length) {
                await nuskaitytiNuosprendi(nuosprendziai[cursor++]);
            }
        }),
    );

    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    while (await surastiNuosprendzioDalyvius()) {
        // Do
    }
    await postgres.end();
    process.exit(0);
}

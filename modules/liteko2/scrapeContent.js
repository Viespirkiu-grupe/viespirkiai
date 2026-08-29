/*
LITEKO2 sprendimo turinys:
  * detalūs metaduomenys  -> liteko2Sprendimai (teismoId, procesoNr, būsena, …)
  * šalys                 -> liteko2SprendimuDalyviai
  * teisėjai              -> liteko2SprendimuTeisejai
  * kategorijos           -> liteko2SprendimuKategorijos
  * failų sąrašas         -> liteko2SprendimuFailai
  * pilnas API atsakymas + HTML + tekstas -> sidecar (modules/liteko2/sidecar.js)

Tekstas ir HTML į DB NEPATENKA — tik į sidecar. Sidecar'o forma tokia pati kaip
`documents.documents` sidecar'ų, kad propagavimas į dokumentus būtų plonas sluoksnis.

    npm run liteko2:turinys
    node modules/liteko2/scrapeContent.js --limit 50
*/

import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { failoUrl, fetchDecision, fetchDecisionFile } from "./api.js";
import { liteko2Md5, saveLiteko2Sidecar, liteko2SidecarHash } from "./sidecar.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { runPool } from "../../utils/workerPool.js";
import { upsertLiteko2ToDocuments } from "../documents/upsertFromLiteko2.js";

// Turinio nuskaitymo versija (kaip liteko1 teismoNuosprendziai.turinioNuskaitymas).
// 0/NULL = nenuskaityta; >0 = sėkmingo nuskaitymo versija; -1 = klaida; -2 = vykdoma.
// Pakėlus šį skaičių, senesnės versijos eilutės vėl tampa tinkamos perskaityti.
// v2: sprendimas taip pat propaguojamas į bendrą dokumentų paiešką.
export const TURINIO_VERSIJA = 2;

// Sidecar JSON payload schemos versija (atskirai nuo nuskaitymo versijos).
const SIDECAR_VERSION = "1";
const CLASS = "teise";
const TYPE = "teismoNuosprendis";
const SOURCE = "liteko2";

const CONCURRENCY = 5;
const PAKETAS = 25;

// Kiek laukti, kol „vykdoma" (-2) eilutė laikoma pakibusia po proceso lūžio.
const PAKIBUSIU_INTERVALAS = "1 hour";

/** „718 Laimutė Venckuvienė" → { kodas: „718", vardas: „Laimutė Venckuvienė" }. */
export function skaidytiTeiseja(codeName) {
    const match = /^(\d+)\s+(.*)$/.exec((codeName ?? "").trim());
    if (match) return { kodas: match[1], vardas: match[2].trim() };
    return { kodas: null, vardas: (codeName ?? "").trim() || null };
}

/** Klasifikatorių pavadinimai ateina su „\r\n" gale. */
function valyti(value) {
    if (value == null) return null;
    const trimmed = String(value).replace(/\s+/g, " ").trim();
    return trimmed === "" ? null : trimmed;
}

/**
 * Ištraukia tekstą iš LibreOffice sugeneruoto sprendimo HTML.
 * Kaip ir LITEKO1 atveju, <style>/<head> turinys į innerText patektų kaip CSS,
 * todėl ne-turinio elementus išmetam.
 */
export function tekstasIsHtml(html) {
    if (!html) return "";
    const { document } = parseHTML(html);
    const scope = document.querySelector("body") || document;
    scope.querySelectorAll("style, script, head, title, meta, link").forEach((el) => el.remove());
    return (scope.innerText || "")
        .replace(/^﻿/, "")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
}

/** Iš sprendimo failų renkamės HTML variantą — jame yra tekstas. */
function htmlFailas(failai) {
    return (
        failai.find((f) => (f.contentType ?? "").includes("text/html")) ??
        failai.find((f) => /\.html?$/i.test(f.fileName ?? "")) ??
        null
    );
}

/** Sprendimo eilučių paėmimas iš eilės su „vykdoma" žyme (atsparus lygiagretumui). */
async function paimtiPaketa(limit) {
    const { rows } = await postgres.query(
        `WITH claimed AS (
            SELECT id
            FROM public."liteko2Sprendimai"
            WHERE "atsauktas" = false
              AND (
                   ("turinioNuskaitymas" >= 0 AND "turinioNuskaitymas" < $2)
                OR ("turinioNuskaitymas" = -2
                    AND "atnaujinta" < now() - interval '${PAKIBUSIU_INTERVALAS}')
              )
            ORDER BY "sprendimoData" DESC NULLS LAST, id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE public."liteko2Sprendimai" s
         SET "turinioNuskaitymas" = -2
         FROM claimed
         WHERE s.id = claimed.id
         RETURNING s.*`,
        [limit, TURINIO_VERSIJA],
    );
    return rows;
}

async function irasytiDalyvius(sprendimoId, dalyviai, sprendimoData) {
    await postgres.query(
        `DELETE FROM public."liteko2SprendimuDalyviai" WHERE "sprendimoId" = $1`,
        [sprendimoId],
    );
    if (!dalyviai.length) return;

    // Vaidmenys („Trečiasis suinteresuotas asmuo" ir pan.) – žodyne, ne eilutėse.
    const vaidmenys = [...new Set(dalyviai.map((d) => valyti(d.partyType)).filter(Boolean))];
    if (vaidmenys.length) {
        await postgres.query(
            `INSERT INTO public."liteko2Vaidmenys" ("pavadinimas")
             SELECT unnest($1::text[])
             ON CONFLICT ("pavadinimas") DO NOTHING`,
            [vaidmenys],
        );
    }

    const values = dalyviai
        .map((_, i) => {
            const p = (n) => `$${i * 6 + n}`;
            return `(${p(1)}, ${p(2)}, ${p(3)},
                (SELECT "id" FROM public."liteko2Vaidmenys" WHERE "pavadinimas" = ${p(4)}),
                ${p(5)}, ${p(6)}, $${dalyviai.length * 6 + 1}::timestamptz::date)`;
        })
        .join(", ");

    await postgres.query(
        `INSERT INTO public."liteko2SprendimuDalyviai"
            ("sprendimoId","liteko2Id","saltinioId","vaidmuoId","pavadinimas","kodas","data")
         VALUES ${values}`,
        [
            ...dalyviai.flatMap((d) => [
                sprendimoId,
                valyti(d.liteko2Id),
                d.id == null ? null : String(d.id),
                valyti(d.partyType),
                valyti(d.partyName),
                valyti(d.partyCode),
            ]),
            sprendimoData ?? null,
        ],
    );
}

async function irasytiTeisejus(sprendimoId, teisejai) {
    await postgres.query(
        `DELETE FROM public."liteko2SprendimuTeisejai" WHERE "sprendimoId" = $1`,
        [sprendimoId],
    );

    const unikalus = new Map();
    for (const t of teisejai) {
        const id = valyti(t.id);
        if (id && !unikalus.has(id)) unikalus.set(id, skaidytiTeiseja(t.codeName));
    }
    if (!unikalus.size) return;

    const ids = [...unikalus.keys()];
    // Teisėjų klasifikatoriaus API neturi — žodyną pildom iš pačių sprendimų.
    await postgres.query(
        `INSERT INTO public."liteko2Teisejai" ("liteko2Id","kodas","vardas")
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         ON CONFLICT ("liteko2Id") DO UPDATE SET
            "kodas" = EXCLUDED."kodas",
            "vardas" = EXCLUDED."vardas",
            "atnaujinta" = now()`,
        [
            ids,
            ids.map((id) => unikalus.get(id).kodas),
            ids.map((id) => unikalus.get(id).vardas),
        ],
    );

    await postgres.query(
        `INSERT INTO public."liteko2SprendimuTeisejai" ("sprendimoId","teisejoId")
         SELECT $1, unnest($2::text[])
         ON CONFLICT DO NOTHING`,
        [sprendimoId, ids],
    );
}

async function irasytiKategorijas(sprendimoId, kategorijos) {
    await postgres.query(
        `DELETE FROM public."liteko2SprendimuKategorijos" WHERE "sprendimoId" = $1`,
        [sprendimoId],
    );

    const ids = [...new Set(kategorijos.map((k) => valyti(k.liteko2Id)).filter(Boolean))];
    if (!ids.length) return;

    // Pavadinimų nerašom — jie gyvena `liteko2Kategorijos` klasifikatoriuje.
    await postgres.query(
        `INSERT INTO public."liteko2SprendimuKategorijos" ("sprendimoId","kategorijosId")
         SELECT $1, unnest($2::text[])
         ON CONFLICT DO NOTHING`,
        [sprendimoId, ids],
    );
}

async function irasytiFailus(sprendimoId, failai) {
    await postgres.query(
        `DELETE FROM public."liteko2SprendimuFailai" WHERE "sprendimoId" = $1`,
        [sprendimoId],
    );
    if (!failai.length) return;

    // `url` nesaugom — jis atkuriamas iš liteko2Id + failo vardo (žr. failoUrl()).
    const values = failai
        .map((_, i) => `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`)
        .join(", ");
    await postgres.query(
        `INSERT INTO public."liteko2SprendimuFailai"
            ("sprendimoId","failoVardas","dydis","contentType","md5")
         VALUES ${values}
         ON CONFLICT ("sprendimoId","failoVardas") DO NOTHING`,
        failai.flatMap((f) => [
            sprendimoId,
            f.fileName,
            f.fileSize == null ? null : Number(f.fileSize),
            f.contentType ?? null,
            f.md5 ?? null,
        ]),
    );
}

/**
 * Suformuoja sidecar'ą tokios pat formos, kokią naudoja `documents.documents`
 * sidecar'ai (žr. modules/documents/upsertFromCourtDecisions.js).
 */
export function sudarytiSidecar(sprendimas, detail, { tekstas, html }) {
    const dalyviai = detail.caseParties ?? [];
    const dalyviaiKodai = [];
    const dalyviaiPavadinimai = [];
    const dalyviaiVaidmenys = [];
    const jarKodai = new Set();

    for (const d of dalyviai) {
        const kodas = valyti(d.partyCode) ?? "";
        if (kodas) {
            dalyviaiKodai.push(kodas);
            if (/^\d{9}$/.test(kodas)) jarKodai.add(Number(kodas));
        }
        dalyviaiPavadinimai.push(valyti(d.partyName) ?? "");
        dalyviaiVaidmenys.push(valyti(d.partyType) ?? "");
    }

    for (const kodas of tekstas?.match(/\b\d{9}\b/g) ?? []) jarKodai.add(Number(kodas));

    const teisejai = (detail.decisionJudges ?? []).map((t) => skaidytiTeiseja(t.codeName).vardas)
        .filter(Boolean);
    const kategorijos = (detail.decisionCategories ?? []).map((k) => valyti(k.categoryName))
        .filter(Boolean);
    const kategorijuKodai = (detail.decisionCategories ?? []).map((k) => valyti(k.liteko2Id))
        .filter(Boolean);

    const teismas = valyti(detail.court);
    const bylosNumeris = valyti(detail.caseNumber);
    const title = teismas && bylosNumeris ? `${bylosNumeris} — ${teismas}` : bylosNumeris;

    return {
        version: SIDECAR_VERSION,
        md5: sprendimas.md5,
        class: CLASS,
        type: TYPE,
        source: SOURCE,
        saltinioId0: valyti(detail.processNumber),
        saltinioId1: bylosNumeris,
        saltinioId2: detail.liteko2Id ?? sprendimas.liteko2Id,
        saltinioId3: null,
        author: null,
        title,
        extension: "html",
        pageCount: null,
        wordCount: tekstas ? (tekstas.match(/\S+/g) ?? []).length : null,
        characterCount: tekstas ? tekstas.length : null,
        text: tekstas || null,
        html: html || null,
        jarKodai: [...jarKodai],
        metadata: {
            bylosNumeris,
            bylosEilesNr: valyti(detail.caseSeqNumber),
            teisminisProcesoNr: valyti(detail.processNumber),
            teismas,
            teismoId: valyti(detail.courtId),
            rumai: valyti(detail.chamber),
            rumuId: valyti(detail.chamberId),
            bylosRusis: valyti(detail.caseType),
            bylosRusiesId: valyti(detail.caseTypeId),
            bylosAprasymas: valyti(detail.caseDesc),
            bylaGauta: detail.dateReceived ?? null,
            sprendimoData: detail.decisionDate ?? null,
            sprendimoTipas: valyti(detail.decisionType),
            sprendimoTipoId: valyti(detail.decisionTypeId),
            busena: valyti(detail.decisionStatus),
            teisejai,
            kategorijos,
            kategorijuKodai,
            dalyviaiKodai,
            dalyviaiPavadinimai,
            dalyviaiVaidmenys,
            failai: (detail.decisionFiles ?? []).map((f) => ({
                failoVardas: f.fileName,
                url: f.fileUrl,
                dydis: f.fileSize == null ? null : Number(f.fileSize),
                contentType: f.contentType,
            })),
        },
        // Pilnas API atsakymas — kad vėliau nieko nereikėtų iš naujo siųstis.
        api: detail,
    };
}

/** Vieno sprendimo turinys: API detalės + HTML tekstas → DB + sidecar. */
async function nuskaitytiSprendima(sprendimas) {
    const start = Date.now();
    try {
        const detail = await fetchDecision(sprendimas.liteko2Id);
        if (!detail) {
            // 404 — sprendimas nebeviešinamas (paprastai atšauktas).
            await postgres.query(
                `UPDATE public."liteko2Sprendimai"
                 SET "turinioNuskaitymas" = -1, "klaida" = 'API 404'
                 WHERE id = $1`,
                [sprendimas.id],
            );
            log(`LITEKO2 ${sprendimas.liteko2Id}: 404, praleidžiam`);
            return;
        }

        const failai = [...(detail.decisionFiles ?? [])];
        const htmlInfo = htmlFailas(failai);

        let html = null;
        if (htmlInfo?.fileName) {
            const atsisiustas = await fetchDecisionFile(
                htmlInfo.fileUrl ?? failoUrl(sprendimas.liteko2Id, htmlInfo.fileName),
            );
            if (atsisiustas) {
                html = atsisiustas.buffer.toString("utf8");
                htmlInfo.md5 = createHash("md5").update(atsisiustas.buffer).digest("hex");
            }
        }

        const tekstas = tekstasIsHtml(html);
        const sidecar = sudarytiSidecar(
            { ...sprendimas, md5: sprendimas.md5 ?? liteko2Md5(sprendimas.liteko2Id) },
            detail,
            { tekstas, html },
        );

        await saveLiteko2Sidecar(sidecar.md5, sidecar);
        const sprendimoData = detail.decisionDate ?? sprendimas.sprendimoData;
        await irasytiDalyvius(sprendimas.id, detail.caseParties ?? [], sprendimoData);
        await irasytiTeisejus(sprendimas.id, detail.decisionJudges ?? []);
        await irasytiKategorijas(sprendimas.id, detail.decisionCategories ?? []);
        await irasytiFailus(sprendimas.id, failai);

        // Pavadinimų (teismo, rūmų, rūšies, tipo) čia nerašom — detalės duoda
        // tiesiogiai id, o pavadinimai gyvena klasifikatorių lentelėse.
        await postgres.query(
            `UPDATE public."liteko2Sprendimai"
             SET "saltinioId"         = COALESCE($2, "saltinioId"),
                 "teismoId"           = COALESCE($3, "teismoId"),
                 "rumuId"             = COALESCE($4, "rumuId"),
                 "bylosRusiesId"      = COALESCE($5, "bylosRusiesId"),
                 "sprendimoTipoId"    = COALESCE($6, "sprendimoTipoId"),
                 "bylosNumeris"       = COALESCE($7, "bylosNumeris"),
                 "bylosEilesNr"       = $8,
                 "teisminisProcesoNr" = $9,
                 "bylaGauta"          = $10,
                 "bylosAprasymas"     = $11,
                 "sprendimoData"      = COALESCE($12::timestamptz, "sprendimoData"),
                 "busena"             = $13,
                 "turinioNuskaitymas" = $14,
                 "turinioMd5"         = $15,
                 "klaida"             = NULL
             WHERE id = $1`,
            [
                sprendimas.id,
                detail.id == null ? null : String(detail.id),
                valyti(detail.courtId), valyti(detail.chamberId),
                valyti(detail.caseTypeId), valyti(detail.decisionTypeId),
                valyti(detail.caseNumber), valyti(detail.caseSeqNumber),
                valyti(detail.processNumber), detail.dateReceived || null,
                valyti(detail.caseDesc), detail.decisionDate || null,
                valyti(detail.decisionStatus),
                TURINIO_VERSIJA, liteko2SidecarHash(sidecar),
            ],
        );

        // Sidecar + documents.documents. Lentelės trigeris pats įdeda pakeitimą į
        // documents."indexQueue", iš kurios jį pasiima Quickwit darbininkas.
        await upsertLiteko2ToDocuments(
            {
                ...sprendimas,
                md5: sidecar.md5,
                sprendimoData,
            },
            sidecar,
        );

        log(
            `LITEKO2 ${sprendimas.liteko2Id} (${valyti(detail.caseNumber) ?? "?"}): ` +
            `${tekstas.length} simb., ${(detail.caseParties ?? []).length} šalių — ` +
            `${((Date.now() - start) / 1000).toFixed(2)}s`,
        );
    } catch (error) {
        await postgres.query(
            `UPDATE public."liteko2Sprendimai"
             SET "turinioNuskaitymas" = -1, "klaida" = $2
             WHERE id = $1`,
            [sprendimas.id, String(error?.message ?? error).slice(0, 4000)],
        );
        log(`Klaida nuskaitant LITEKO2 sprendimą ${sprendimas.liteko2Id}: ${error.message}`);
    }
}

/**
 * Apdoroja vieną paketą iš turinio eilės.
 * @param {number} [batchSize]
 * @returns {Promise<boolean>} true, jei dar liko ką apdoroti.
 */
export async function nuskaitytiSprendimuTurini(batchSize = PAKETAS) {
    const sprendimai = await paimtiPaketa(batchSize);
    if (!sprendimai.length) {
        log("LITEKO2: visų sprendimų turinys nuskaitytas");
        return false;
    }

    await runPool(sprendimai, nuskaitytiSprendima, CONCURRENCY);
    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    const limit = limitArg(args.limit);
    const batchSize = numArg(args.batch, PAKETAS);

    let apdorota = 0;
    while (apdorota < limit) {
        const dar = await nuskaitytiSprendimuTurini(Math.min(batchSize, limit - apdorota));
        if (!dar) break;
        apdorota += batchSize;
    }

    await postgres.end();
    process.exit(0);
}

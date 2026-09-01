/*
Įkelia LITEKO teismo nuosprendį į dokumentų paiešką: parašo sidecar JSON (tekstas +
metadata) ir upsert'ina eilutę į documents.documents. DB trigeris
(documents_index_queue) pats įdeda į indeksavimo eilę, o
quickwitProcessIndexQueue.js įkelia į Quickwit.

Veidrodis modules/documents/upsertFromFiles.js, bet šaltinis – teismoNuosprendziai,
o ne failai. Tekstas niekur į DB nepatenka, tik į sidecar.
*/

import { saveDocumentFs } from "./documentsFs.js";
import { upsertDocument } from "./upsertDocument.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

// Sidecar JSON payload schemos versija (ne nuskaitymo versija — tą seka
// teismoNuosprendziai.turinioNuskaitymas).
const SIDECAR_VERSION = "1";
const CLASS = "teise";
const TYPE = "teismoNuosprendis";
const SOURCE = "liteko";

/**
 * @param {object} nuosprendis - teismoNuosprendziai eilutė (id, md5, litekoId,
 *   bylosNumeris, teismas, teismoRumai, bylosRusis, data, url).
 * @param {object} detail - nuskaitytas turinys: { tekstas, salys[], kategorijos[],
 *   kategorijuKodai[], teisejai[], teisminisProcesoNr, instancija, skyrius, vieta }.
 */
export async function upsertNuosprendisToDocuments(nuosprendis, detail = {}) {
    if (!nuosprendis?.md5) {
        throw new Error("upsertNuosprendisToDocuments: trūksta md5");
    }

    const salys = detail.salys || [];
    // Dalyvius laikom lygiagrečiais skaliariniais masyvais (ne object[]) — taip jie
    // lieka filtruojami/facetinami paieškos varikliuose. Objektinė šalių lentelė
    // rodymui imama iš PG teismoNuosprendziaiDalyviai, ne iš metadata.
    const dalyviaiKodai = [];
    const dalyviaiPavadinimai = [];
    const dalyviaiVaidmenys = [];
    const jarKodaiSet = new Set();
    for (const s of salys) {
        const kodas = s.kodas ? String(s.kodas).trim() : "";
        if (kodas) {
            dalyviaiKodai.push(kodas);
            if (/^\d{9}$/.test(kodas)) jarKodaiSet.add(parseInt(kodas, 10));
        }
        dalyviaiPavadinimai.push((s.pavadinimas || "").trim());
        dalyviaiVaidmenys.push((s.bylojeKaip || "").trim());
    }

    const text = detail.tekstas || null;
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : null;
    const characterCount = text ? text.length : null;

    const metadata = {
        bylosNumeris: nuosprendis.bylosNumeris ?? null,
        teisminisProcesoNr: detail.teisminisProcesoNr ?? nuosprendis.teisminisProcesoNr ?? null,
        teismas: nuosprendis.teismas ?? null,
        teismoRumai: nuosprendis.teismoRumai ?? null,
        skyrius: detail.skyrius ?? nuosprendis.skyrius ?? null,
        instancija: detail.instancija ?? nuosprendis.instancija ?? null,
        bylosRusis: nuosprendis.bylosRusis ?? null,
        vieta: detail.vieta ?? null,
        teisejai: detail.teisejai ?? [],
        kategorijuKodai: detail.kategorijuKodai ?? [],
        kategorijos: detail.kategorijos ?? [],
        dalyviaiKodai,
        dalyviaiPavadinimai,
        dalyviaiVaidmenys,
    };

    const title = nuosprendis.teismas
        ? `${nuosprendis.bylosNumeris} — ${nuosprendis.teismas}`
        : nuosprendis.bylosNumeris ?? null;

    const sidecar = {
        version: SIDECAR_VERSION,
        md5: nuosprendis.md5,
        class: CLASS,
        type: TYPE,
        source: SOURCE,
        saltinioId0: metadata.teisminisProcesoNr,
        saltinioId1: nuosprendis.bylosNumeris ?? null,
        saltinioId2: nuosprendis.litekoId ?? null,
        saltinioId3: null,
        author: null,
        title,
        extension: null,
        pageCount: null,
        wordCount,
        characterCount,
        text,
        jarKodai: [...jarKodaiSet],
        metadata,
    };

    await saveDocumentFs(nuosprendis.md5, sidecar);

    // LITEKO adresas visada išvedamas iš sprendimo id, tad jei šaltinio eilutė
    // url neturi, jį susidedam patys – documents.documents kelio neleidžia tuščio.
    const url = nuosprendis.url
        ?? `https://liteko.teismai.lt/viesasprendimupaieska/tekstas.aspx?id=${sidecar.saltinioId2}`;

    await upsertDocument({
        class: CLASS,
        type: TYPE,
        source: SOURCE,
        url,
        md5: nuosprendis.md5,
        title,
        language: "lt",
        wordCount,
        characterCount,
        happenedAt: nuosprendis.data ?? null,
        sourceIds: [sidecar.saltinioId0, sidecar.saltinioId1, sidecar.saltinioId2, null],
    });
    signalWork(WORK_SIGNALS.DOCUMENTS_INDEX_READY, {
        source: "liteko",
        count: 1,
    });
}

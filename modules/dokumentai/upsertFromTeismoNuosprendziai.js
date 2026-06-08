/*
Įkelia LITEKO teismo nuosprendį į dokumentų paiešką: parašo sidecar JSON (tekstas +
metadata) ir upsert'ina eilutę į public.dokumentai. DB trigeris (dokumentai_index_queue)
pats įdeda į indeksavimo eilę, o quickwitProcessIndexQueue.js įkelia į Quickwit.

Veidrodis modules/dokumentai/upsertFromFailai.js, bet šaltinis – teismoNuosprendziai,
o ne failai. Tekstas niekur į DB nepatenka, tik į sidecar.
*/

import { postgres } from "../../postgres/postgres.js";
import { saveDokumentasFs } from "./dokumentaiFs.js";

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
export async function upsertNuosprendisToDokumentai(nuosprendis, detail = {}) {
    if (!nuosprendis?.md5) {
        throw new Error("upsertNuosprendisToDokumentai: trūksta md5");
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

    await saveDokumentasFs(nuosprendis.md5, sidecar);

    await postgres.query(
        `INSERT INTO public.dokumentai (
            md5, class, type, source, url,
            "saltinioId0", "saltinioId1", "saltinioId2",
            pavadinimas, language, "wordCount", "characterCount", "happenedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (md5) WHERE source = 'liteko' DO UPDATE SET
            class            = EXCLUDED.class,
            type             = EXCLUDED.type,
            source           = EXCLUDED.source,
            url              = EXCLUDED.url,
            "saltinioId0"    = EXCLUDED."saltinioId0",
            "saltinioId1"    = EXCLUDED."saltinioId1",
            "saltinioId2"    = EXCLUDED."saltinioId2",
            pavadinimas      = EXCLUDED.pavadinimas,
            language         = EXCLUDED.language,
            "wordCount"      = EXCLUDED."wordCount",
            "characterCount" = EXCLUDED."characterCount",
            "happenedAt"     = EXCLUDED."happenedAt"`,
        [
            nuosprendis.md5, CLASS, TYPE, SOURCE, nuosprendis.url ?? null,
            sidecar.saltinioId0, sidecar.saltinioId1, sidecar.saltinioId2,
            title, "lt", wordCount, characterCount, nuosprendis.data ?? null,
        ],
    );
}

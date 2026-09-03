/*
Priemonės puslapio (patvirtintos_priemones/<slug>) nuskaitymas: Nr., skiriamos
lėšos ir aprašomieji laukai. Priemonių tėra ~263, tad puslapiai nuskaitomi visi.
*/

import { parseHTML } from "linkedom";
import { valyti, suma, data, slugas } from "./tekstas.js";

/**
 * `info_block` turinys pagal antraštę („Galimi pareiškėjai“ ir pan.).
 * @param {Document} document
 * @param {string} antraste
 * @returns {string|null}
 */
function blokoTekstas(document, antraste) {
    for (const blokas of document.querySelectorAll(".info_block")) {
        const h4 = blokas.querySelector(".head4");
        if (valyti(h4?.textContent) !== antraste) continue;
        const tekstas = valyti(blokas.textContent).slice(antraste.length).trim();
        return tekstas || null;
    }
    return null;
}

/**
 * @param {string} html
 * @returns {{saltinioId: number|null, pavadinimas: string|null, kodas: string|null, esLesos: number|null, visosLesos: number|null, finansavimoForma: string|null, atrankosBudas: string|null, galimiPareiskejai: string|null, finansuojamosVeiklos: string|null, atnaujinimoData: string|null}}
 */
export function parsePriemonesPuslapi(html) {
    const { document } = parseHTML(html);

    const antrastes = document.querySelectorAll(".head2 h2");
    // „Skiriamas finansavimas“ lentelė: ES lėšos | suma | Iš viso | suma.
    const tds = document.querySelector("table.table-striped")?.querySelectorAll("td") ?? [];

    // Priemonės id (toks pat kaip sąrašo filtre) yra nuorodoje į jos paraiškas:
    // …/paraiskos_ir_projektai?priemone%5B%5D=65
    const nuorodaISarasa = Array.from(document.querySelectorAll("a[href*='priemone']"))
        .map((a) => a.getAttribute("href"))
        .find((href) => /priemone(%5B%5D|\[\])=\d+/.test(href ?? ""));

    return {
        saltinioId:
            Number(nuorodaISarasa?.match(/priemone(?:%5B%5D|\[\])=(\d+)/)?.[1]) || null,
        pavadinimas: valyti(antrastes[0]?.textContent) || null,
        kodas: valyti(antrastes[1]?.textContent).replace(/^Nr\.\s*/i, "") || null,
        esLesos: suma(tds[1]?.textContent),
        visosLesos: suma(tds[3]?.textContent),
        finansavimoForma: blokoTekstas(document, "Priemonės finansavimo forma"),
        atrankosBudas: blokoTekstas(document, "Projektų atrankos būdas"),
        galimiPareiskejai: blokoTekstas(document, "Galimi pareiškėjai"),
        finansuojamosVeiklos: blokoTekstas(document, "Finansuojamos veiklos"),
        atnaujinimoData: data(document.querySelector(".detail_info .date")?.textContent),
    };
}

/**
 * Priemonių sąrašo puslapis – jame vienu kartu yra visos ~263 priemonės.
 * @param {string} html
 * @returns {string[]} Priemonių slug'ai
 */
export function parsePriemoniuSarasa(html) {
    const { document } = parseHTML(html);
    const slugai = Array.from(
        document.querySelectorAll("a[href*='patvirtintos_priemones/']"),
    )
        .map((a) => a.getAttribute("href") ?? "")
        .map(slugas)
        // Rikiavimo nuorodos (…/listingItem_byPriority) nėra priemonės.
        .filter((slug) => slug && !slug.startsWith("listingItem"));
    return [...new Set(slugai)];
}

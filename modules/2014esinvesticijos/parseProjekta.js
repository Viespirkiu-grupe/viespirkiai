/*
Projekto puslapio (paraiskos_ir_projektai/<slug>) nuskaitymas.

Puslapis duoda tai, ko nėra sąraše: savivaldybę, priemonę, prioritetą, kvietimo
kodą, aprašymą, paraiškos ir sutarties datas, apmokėtų išlaidų sumą, stebėsenos
rodiklius, susijusius pirkimų skelbimus ir susijusius projektus.
*/

import { parseHTML } from "linkedom";
import { valyti, suma, data, slugas } from "./tekstas.js";

/**
 * Reikšmė iš dešiniojo datų bloko pagal etiketę („Sutarties pasirašymo diena:“).
 * @param {Document} document
 * @param {RegExp} etikete
 * @returns {string|null} Data YYYY-MM-DD
 */
function dataPagalEtikete(document, etikete) {
    for (const eilute of document.querySelectorAll(".right_date_block div")) {
        const antraste = valyti(eilute.querySelector("span")?.textContent);
        if (antraste && etikete.test(antraste)) return data(eilute.textContent);
    }
    return null;
}

/**
 * Viršutinės lentelės „raktas -> reikšmė“ eilutės.
 * @param {Document} document
 * @returns {{savivaldybe: string|null, priemone: string|null, priemonesSlug: string|null, prioritetas: string|null, kvietimoKodas: string|null, pareiskejas: string|null}}
 */
function pagrindiniaiLaukai(document) {
    const laukai = {
        savivaldybe: null,
        priemone: null,
        priemonesSlug: null,
        prioritetas: null,
        kvietimoKodas: null,
        pareiskejas: null,
    };

    const lentele = document.querySelector("table.table-striped");
    for (const tr of lentele?.querySelectorAll("tr") ?? []) {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 2) continue;
        const raktas = valyti(tds[0].textContent);
        const reiksme = valyti(tds[1].textContent) || null;

        if (raktas.startsWith("Vykdytojas")) laukai.pareiskejas = reiksme;
        else if (raktas.startsWith("Savivaldyb")) laukai.savivaldybe = reiksme;
        else if (raktas.startsWith("Prioritetas")) laukai.prioritetas = reiksme;
        else if (raktas.startsWith("Kvietimo kodas")) laukai.kvietimoKodas = reiksme;
        else if (raktas.startsWith("Priemon")) {
            const nuoroda = tds[1].querySelector("a");
            laukai.priemone = valyti(nuoroda?.textContent) || reiksme;
            laukai.priemonesSlug = nuoroda ? slugas(nuoroda.getAttribute("href")) : null;
        }
    }

    return laukai;
}

/**
 * Paraiškos vertinimo lentelė: kriterijus, „Taip“/„Ne“, balas.
 * @param {Document} document
 * @returns {Array<{eilesNr: number|null, kriterijus: string, rezultatas: boolean|null, data: string|null, balas: number|null}>}
 */
function vertinimai(document) {
    const lentele = document.querySelector("table.no_margin");
    const eilutes = [];

    for (const tr of lentele?.querySelectorAll("tbody tr") ?? []) {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 2) continue;

        const antraste = valyti(tds[0].textContent);
        if (!antraste) continue;
        const reiksme = valyti(tds[1].textContent);

        eilutes.push({
            eilesNr: Number(antraste.match(/^(\d+)\./)?.[1]) || null,
            kriterijus: antraste.replace(/^\s*\d+\.\s*/, ""),
            rezultatas: /\bTaip\b/.test(reiksme)
                ? true
                : /\bNe\b/.test(reiksme)
                  ? false
                  : null,
            data: data(reiksme),
            // Balas rašomas su tašku („64.00“), o neįvertintų – tuščias langelis.
            balas: suma(tds[2]?.textContent),
        });
    }

    return eilutes;
}

/**
 * Sutarties informacijos lentelė – keturios sumos vienoje eilutėje.
 * @param {Document} document
 * @returns {{projektoIslaidos: number|null, finansavimas: number|null, apmoketosIslaidos: number|null, ismoketasFinansavimas: number|null}}
 */
function sutartiesSumos(document) {
    const tds =
        document.querySelectorAll("table.no_margin")[1]?.querySelectorAll("tbody td") ?? [];
    return {
        projektoIslaidos: suma(tds[0]?.textContent),
        finansavimas: suma(tds[1]?.textContent),
        apmoketosIslaidos: suma(tds[2]?.textContent),
        ismoketasFinansavimas: suma(tds[3]?.textContent),
    };
}

/**
 * Stebėsenos rodiklių pasiekimai. Antra kiekvieno rodiklio eilutė yra
 * paslėptas grafikas (`chart-tr`) – jį praleidžiam.
 * @param {Document} document
 * @returns {Array<{eilesNr: number|null, pavadinimas: string, matavimoVienetas: string|null, siektinaReiksme: number|null, pasiektaReiksme: number|null}>}
 */
function rodikliai(document) {
    const eilutes = [];

    for (const tr of document.querySelectorAll("table.indicators tbody tr")) {
        if (tr.classList.contains("chart-tr")) continue;
        const tds = tr.querySelectorAll("td");
        if (tds.length < 5) continue;

        const pavadinimas = valyti(tds[1].textContent);
        if (!pavadinimas) continue;

        eilutes.push({
            eilesNr: Number(valyti(tds[0].textContent)) || null,
            pavadinimas,
            matavimoVienetas: valyti(tds[2].textContent) || null,
            siektinaReiksme: suma(tds[3].textContent),
            pasiektaReiksme: suma(tds[4].textContent),
        });
    }

    return eilutes;
}

/**
 * Susiję neperkančiųjų organizacijų pirkimų skelbimai.
 * @param {Document} document
 * @returns {Array<{slug: string, pavadinimas: string|null, paskelbimoData: string|null, terminas: string|null}>}
 */
function pirkimuSkelbimai(document) {
    const skelbimai = [];

    for (const tr of document.querySelectorAll("#related_procurenotices tr")) {
        const nuoroda = tr.querySelector("a.title");
        const slug = slugas(nuoroda?.getAttribute("href"));
        if (!slug) continue;

        const datos = tr.querySelectorAll(".date div");
        skelbimai.push({
            slug,
            pavadinimas: valyti(nuoroda.textContent) || null,
            paskelbimoData: data(datos[0]?.textContent),
            terminas: data(datos[1]?.textContent),
        });
    }

    return skelbimai;
}

/**
 * @typedef {object} ProjektoDetales
 * @property {string|null} pavadinimas
 * @property {string|null} kodas
 * @property {string|null} busena
 * @property {string|null} aprasymas
 * @property {string|null} paraiskosData
 * @property {string|null} sutartiesData
 * @property {string|null} sutartiesPabaiga
 * @property {string|null} veikluPradzia
 * @property {string|null} veikluPabaiga
 */

/**
 * @param {string} html
 * @returns {ProjektoDetales & ReturnType<typeof pagrindiniaiLaukai> & ReturnType<typeof sutartiesSumos> & {verteParaiskoje: number|null, prasomasFinansavimas: number|null, vertinimai: ReturnType<typeof vertinimai>, rodikliai: ReturnType<typeof rodikliai>, pirkimuSkelbimai: ReturnType<typeof pirkimuSkelbimai>, susijeSlugai: string[]}}
 */
export function parseProjektoPuslapi(html) {
    const { document } = parseHTML(html);

    const antrastes = document.querySelectorAll(".head2 h2");
    const kainos = document.querySelectorAll(".price_info div");

    return {
        pavadinimas: valyti(antrastes[0]?.textContent) || null,
        kodas: valyti(antrastes[1]?.textContent).replace(/^Nr\.\s*/i, "") || null,
        busena:
            valyti(
                document.querySelector(".right_date_block [class^='stage_']")?.textContent,
            ) || null,
        // Aprašymas – vienintelė pastraipa tarp viršutinės lentelės ir paraiškų bloko.
        aprasymas: valyti(document.querySelector("table.table-striped + p")?.textContent) || null,
        ...pagrindiniaiLaukai(document),
        verteParaiskoje: suma(kainos[0]?.querySelector("span")?.textContent),
        prasomasFinansavimas: suma(kainos[1]?.querySelector("span")?.textContent),
        ...sutartiesSumos(document),
        paraiskosData: dataPagalEtikete(document, /Paraiškos gavimo data/),
        sutartiesData: dataPagalEtikete(document, /Sutarties pasirašymo/),
        sutartiesPabaiga: dataPagalEtikete(document, /Sutarties galiojimo pabaiga/),
        veikluPradzia: dataPagalEtikete(document, /įgyvendinimo pradžia/i),
        veikluPabaiga: dataPagalEtikete(document, /įgyvendinimo pabaiga/i),
        vertinimai: vertinimai(document),
        rodikliai: rodikliai(document),
        pirkimuSkelbimai: pirkimuSkelbimai(document),
        susijeSlugai: Array.from(
            document.querySelectorAll("#related_applications tr[data-href]"),
        )
            .map((tr) => slugas(tr.getAttribute("data-href")))
            .filter(Boolean),
    };
}

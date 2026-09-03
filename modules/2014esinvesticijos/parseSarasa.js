/*
Sąrašo puslapio (paraiskos_ir_projektai) ir jo filtrų nuskaitymas.

Lentelės stulpeliai (2026-09): Nr. | Projektas | Pareiškėjas/Vykdytojas |
Paraiškos būsena | Paraiškos vertinimo statusas | Projekto vertė paraiškoje |
Prašomas finansavimas | Projekto išlaidų suma | Finansavimas |
Išmokėta finansavimo suma | Sutarties pasirašymo data.
*/

import { parseHTML } from "linkedom";
import { valyti, suma, data, slugas } from "./tekstas.js";

// Pirmą vertinimo kriterijų sąrašas vadina kitaip nei projekto puslapis;
// žodyne laikom projekto puslapio vardą (žr. migracija2014esInvesticijosSchema.sql).
const KRITERIJU_VARDAI = new Map([
    ["Paraiškos vertinimo statusas", "Tinkamumo vertinimas"],
]);

/**
 * @typedef {object} SarasoEilute
 * @property {string} kodas Projekto Nr.
 * @property {string} slug
 * @property {string} pavadinimas
 * @property {string|null} pareiskejas
 * @property {string|null} busena
 * @property {Array<{eilesNr: number|null, kriterijus: string, rezultatas: boolean|null, data: string|null}>} vertinimai
 * @property {number|null} verteParaiskoje
 * @property {number|null} prasomasFinansavimas
 * @property {number|null} projektoIslaidos
 * @property {number|null} finansavimas
 * @property {number|null} ismoketasFinansavimas
 * @property {string|null} sutartiesData
 */

/**
 * Vertinimo `dt`/`dd` pora: „2. Naudos ir kokybės vertinimas“ + „Taip (2019-05-17)“.
 * @param {Element} dl
 * @returns {{eilesNr: number|null, kriterijus: string, rezultatas: boolean|null, data: string|null}|null}
 */
function vertinimas(dl) {
    const antraste = valyti(dl.querySelector("dt")?.textContent);
    if (!antraste) return null;

    const eilesNr = Number(antraste.match(/^(\d+)\./)?.[1]) || null;
    const be = antraste.replace(/^\s*\d+\.\s*/, "");
    const kriterijus = KRITERIJU_VARDAI.get(be) ?? be;

    const reiksme = valyti(dl.querySelector("dd")?.textContent);
    const rezultatas = /\bTaip\b/.test(reiksme)
        ? true
        : /\bNe\b/.test(reiksme)
          ? false
          : null;

    return { eilesNr, kriterijus, rezultatas, data: data(reiksme) };
}

/**
 * Vienos sąrašo eilutės duomenys.
 * @param {Element} tr
 * @returns {SarasoEilute|null} null, jei eilutė be kodo (pvz. poraštė)
 */
function eilute(tr) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 11) return null;

    const pavadinimai = tds[1].querySelectorAll("div");
    const kodas = valyti(pavadinimai[1]?.textContent);
    const pavadinimas = valyti(pavadinimai[0]?.textContent);
    const slug = slugas(tr.getAttribute("data-href"));
    if (!kodas || !pavadinimas || !slug) return null;

    return {
        kodas,
        slug,
        pavadinimas,
        pareiskejas: valyti(tds[2].textContent) || null,
        busena: valyti(tds[3].textContent) || null,
        vertinimai: Array.from(tds[4].querySelectorAll("dl"))
            .map(vertinimas)
            .filter(Boolean),
        verteParaiskoje: suma(tds[5].textContent),
        prasomasFinansavimas: suma(tds[6].textContent),
        projektoIslaidos: suma(tds[7].textContent),
        finansavimas: suma(tds[8].textContent),
        ismoketasFinansavimas: suma(tds[9].textContent),
        sutartiesData: data(tds[10].textContent),
    };
}

/**
 * @param {string} html
 * @returns {{eilutes: SarasoEilute[], visoIrasu: number|null}}
 */
export function parseSarasoPuslapi(html) {
    const { document } = parseHTML(html);

    const visoIrasu =
        Number(valyti(document.querySelector(".totals .count")?.textContent).replace(/\s/g, "")) ||
        null;

    const eilutes = Array.from(document.querySelectorAll("tr[data-href]"))
        .map(eilute)
        .filter(Boolean);

    return { eilutes, visoIrasu };
}

/**
 * Filtrų `select` reikšmės – iš jų imami žodynų id (šaltinio, ne mūsų).
 * @param {string} html
 * @returns {{prioritetai: Array<{id: number, pavadinimas: string}>, priemones: Array<{id: number, pavadinimas: string}>, savivaldybes: Array<{id: number, pavadinimas: string}>, busenos: Array<{id: number, pavadinimas: string}>}}
 */
export function parseFiltrus(html) {
    const { document } = parseHTML(html);

    const pasirinkimai = (vardas) =>
        Array.from(
            document.querySelectorAll(`select[name="${vardas}"] option`),
        )
            .map((option) => ({
                id: Number(option.getAttribute("value")),
                pavadinimas: valyti(option.textContent),
            }))
            .filter((o) => Number.isInteger(o.id) && o.id > 0 && o.pavadinimas);

    return {
        prioritetai: pasirinkimai("priority"),
        priemones: pasirinkimai("priemone[]"),
        savivaldybes: pasirinkimai("region"),
        busenos: pasirinkimai("evaluation_stage"),
    };
}

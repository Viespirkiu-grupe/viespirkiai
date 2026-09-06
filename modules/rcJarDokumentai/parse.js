import { parseHTML } from "linkedom";

/**
 * @typedef {object} PateiktasDokumentas
 * @property {number|null} rcId RC vidinis dokumento ID iš `<tr id="tr_…">`.
 * @property {string} tipas Dalis prieš pirmą „ / ".
 * @property {string|null} aprasymas Dalis po pirmo „ / ".
 * @property {string|null} dokumentoData `YYYY-MM-DD`.
 * @property {string|null} gavimoData `YYYY-MM-DD`.
 * @property {string|null} registravimoData `YYYY-MM-DD`.
 * @property {number|null} lapuSkaicius
 */

/**
 * @typedef {object} DokPuslapis
 * @property {string|null} pavadinimas Juridinio asmens pavadinimas iš antraštės.
 * @property {number|null} jarKodas Kodas, kurį rodo pats puslapis.
 * @property {boolean} irasuNerasta RC atsakė „Įrašų nerasta" (nežinomas kodas).
 * @property {PateiktasDokumentas[]} eilutes
 */

const TEKSTO_SKIRTUKAS = /\s\/\s/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function tekstas(node) {
    return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function data(reiksme) {
    return DATA.test(reiksme) ? reiksme : null;
}

function sveikasis(reiksme) {
    if (!/^\d+$/.test(reiksme)) return null;
    const skaicius = Number(reiksme);
    return Number.isSafeInteger(skaicius) ? skaicius : null;
}

/**
 * Išskaido vieno juridinio asmens dok.php puslapį.
 *
 * Puslapis statinis: DataTables tik rūšiuoja kliento pusėje, tad vienas GET
 * duoda visas eilutes ir puslapiavimo nėra.
 *
 * @param {string} html
 * @returns {DokPuslapis}
 */
export function parseDokPuslapi(html) {
    const { document } = parseHTML(html);

    const antraste = tekstas(document.querySelector("main"));
    const kodoAtitikmuo = antraste.match(/kodas\s+(\d{6,9})/);
    const pavadinimas = document
        .querySelector("main table b")?.textContent?.trim() || null;

    const lentele = document.querySelector("#dokumentai_tbl");
    if (!lentele) {
        return {
            pavadinimas,
            jarKodas: kodoAtitikmuo ? Number(kodoAtitikmuo[1]) : null,
            irasuNerasta: /Įrašų nerasta/i.test(antraste),
            eilutes: [],
        };
    }

    const eilutes = [];
    for (const tr of lentele.querySelectorAll("tbody tr")) {
        const langeliai = [...tr.querySelectorAll("td")];
        if (langeliai.length < 5) continue;

        const pilnasTekstas = tekstas(langeliai[0]);
        if (!pilnasTekstas) continue;

        const skirtukas = pilnasTekstas.search(TEKSTO_SKIRTUKAS);
        const tipas = skirtukas < 0
            ? pilnasTekstas
            : pilnasTekstas.slice(0, skirtukas).trim();
        const aprasymas = skirtukas < 0
            ? null
            : pilnasTekstas.slice(skirtukas + 3).trim() || null;

        eilutes.push({
            rcId: sveikasis(tr.getAttribute("id")?.match(/^tr_(\d+)$/)?.[1] ?? ""),
            tipas,
            aprasymas,
            dokumentoData: data(tekstas(langeliai[1])),
            gavimoData: data(tekstas(langeliai[2])),
            registravimoData: data(tekstas(langeliai[3])),
            lapuSkaicius: sveikasis(tekstas(langeliai[4])),
        });
    }

    return {
        pavadinimas,
        jarKodas: kodoAtitikmuo ? Number(kodoAtitikmuo[1]) : null,
        irasuNerasta: false,
        eilutes,
    };
}

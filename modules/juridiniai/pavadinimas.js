/*
Juridinių asmenų pavadinimų normalizavimas.

`toBaseCompanyName` nuima teisinės formos žymenis, kabutes ir diakritikus, kad
liktų tik atpažįstamas įmonės vardas. Tą pačią funkciją privalo naudoti ir
indeksavimas (`pavadinimasBase` laukas Typesense), ir paieška — kitaip užklausa
ir indeksas normalizuojami skirtingai ir sutapimų nebelieka.
*/

import { toAscii } from "../../utils/text.js";

const COMPANY_TYPES = [
    "UAB",
    "AB",
    "MB",
    "IĮ",
    "VĮ",
    "VšĮ",
    "ŽŪB",
    "KŪB",
    "SĮ",
    "BĮ",
    "Uždaroji akcinė bendrovė",
    "Akcinė bendrovė",
    "Mažoji bendrija",
    "Individuali įmonė",
    "Viešoji įstaiga",
    "Žemės ūkio bendrovė",
    "Kooperatinė ūkinė bendrovė",
    "Biudžetinė įstaiga",
    "Savivaldybės įmonė",
];

// Iš anksto sukompiliuoti šablonai — funkcija kviečiama kiekvienam indeksuojamam
// įrašui (šimtai tūkstančių), tad RegExp kūrimas cikle būtų brangus.
const COMPANY_TYPE_PATTERNS = COMPANY_TYPES.map((type) => {
    const typeAscii = toAscii(type).toLowerCase();
    return new RegExp("\\b" + typeAscii.replace(/\s+/g, "\\s+") + "\\b", "gi");
});

/**
 * Pavadinimą paverčia lyginimui tinkama ASCII forma be teisinės formos žymens.
 * @param {string} name - Pilnas juridinio asmens pavadinimas
 * @returns {string} Normalizuotas pavadinimas (tuščias string, jei įvesties nėra)
 */
export function toBaseCompanyName(name) {
    if (!name) return "";

    // filial. → filialas
    name = name.replace(/filial\./gi, "filialas");
    name = name.replace(
        /prie LR finansų ministerijos/i,
        "prie Lietuvos Respublikos finansų ministerijos",
    );
    name = name.replace(
        /PRIE SADM/i,
        "prie Socialinės apsaugos ir darbo ministerijos",
    );
    name = name.replace(/PRIE KAM/i, "prie Krašto apsaugos ministerijos");

    // Skliaustuose paprastai būna paaiškinimai, o ne vardas
    name = name.replace(/\(.*?\)/g, "");

    const cleaned = name
        .replace(/["“”„]/g, "")
        .replace(/,/g, "")
        .trim();

    let cleanedAscii = toAscii(cleaned).toLowerCase();

    for (const pattern of COMPANY_TYPE_PATTERNS) {
        pattern.lastIndex = 0;
        cleanedAscii = cleanedAscii.replace(pattern, "");
    }

    return cleanedAscii.replace(/\s+/g, " ").trim();
}

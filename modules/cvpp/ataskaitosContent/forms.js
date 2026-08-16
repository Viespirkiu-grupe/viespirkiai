import { bool, numLt, toCamel, txt } from "./primitives.js";
import {
    boolFld,
    boolFldByLabel,
    findBody,
    findSection,
    fld,
} from "./fields.js";
import {
    parseAtsakingasAsmuo,
    parseBody,
    parseBvpz,
    parseOrgEpsText,
    parseOrgTable,
    parseRecords,
    parseTableRows,
    parseTeisinisPagrindas,
} from "./structures.js";

// ─── Atn-1 (formType 1) ───────────────────────────────────────────────────────

function parseAtn1(notice) {
    const [teisinisPagrindas, ataskaitosTipas] = parseTeisinisPagrindas(notice);
    const sI = findSection(notice, "I. BENDRA INFORMACIJA");
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const bvpzBody = findBody(notice, "III.4.");
    const { pagrindinis: pagrindinisKodasBvpz, papildomi: papildomiKodaiBvpz } =
        parseBvpz(bvpzBody);

    return {
        teisinisPagrindas,
        ataskaitosTipas,
        pirkimoNumeris: fld(notice, "1.1."),
        pirkimoObjektoPavadinimas: fld(notice, "2.1."),
        pirkimoTipas: fld(sI, "3."),
        finansuojamasEsLesomis: bool(fld(sI, "4.")),
        elektroninisPirkimas: bool(fld(sI, "5.")),
        perkanciojiOrganizacija: parseOrgEpsText(sII),
        igaliojimasKitaiPO: boolFld(notice, "II.1."),
        preliminariSutartis: boolFld(notice, "III.1."),
        dinamineSistema: boolFld(notice, "III.2."),
        pirkimoObjektoRusis: fld(notice, "III.3."),
        pagrindinisKodasBvpz,
        papildomiKodaiBvpz,
        pirkimoDalys: parseRecords(findBody(notice, "III.5.")),
        pirkimoBudas: fld(notice, "V.1."),
        ankstesnisPirkimas: parseBody(findBody(notice, "V.3.")),
        pajamosReikalavimas: boolFld(notice, "VI.2.1."),
        dalyviai: parseRecords(findBody(notice, "VI.1.")),
        vertinimoKriterijai: (() => {
            const b = findBody(notice, "VII.1.");
            return b
                ? [...b.querySelectorAll(".eps-text")].map((el) => txt(el)).filter(Boolean)
                : [];
        })(),
        atmestiPasiulymai: parseRecords(findBody(notice, "VII.2.")),
        pasiulymuEile: parseRecords(findBody(notice, "VII.3.")),
        skundai: {
            pretenzijaPateikta: boolFld(notice, "IX.1."),
            ieskinysTeismui: boolFld(notice, "IX.2."),
            interesuKonfliktas: boolFld(notice, "IX.3.1."),
            konkurencijaIskreipiama: boolFld(notice, "IX.4.1."),
        },
        proceduruPabaiga: parseRecords(findBody(notice, "X.1.")),
        sutartys: parseRecords(findBody(notice, "XI.2.")),
        sutartiesSavybes: {
            subrangosKetinama: boolFld(notice, "XI.2.1."),
            centralizuotasPirkimas: boolFld(notice, "XI.2.2."),
            zaliasisPirkimas: boolFld(notice, "XI.2.3."),
            energetiniaiReikalavimai: boolFld(notice, "XI.2.4."),
            keliuTransportoPriemones: boolFld(notice, "XI.2.5."),
            inovatyvusProduktas: boolFld(notice, "XI.2.6."),
        },
    };
}

// Parse the transposed "didesnes verts pirkimai" table (section VI of Atn-3):
// Headers are the 3 procurement-type columns; two data rows are vertė and skaičius.
function parseDidesniosVerte(sVI) {
    const bodyEl = findBody(sVI, "1.");
    const table = bodyEl?.querySelector("table") ?? sVI?.querySelector("table");
    if (!table) return null;

    const colKeys = [...table.querySelectorAll("thead tr:first-child th, thead tr:first-child td")]
        .map((th) => toCamel(txt(th) || ""));

    const dataRows = [...table.querySelectorAll("tbody tr")].filter((r) => !r.querySelector("th"));
    const verteRow = [...(dataRows[0]?.querySelectorAll("td") || [])].map((td) => txt(td));
    const skaiciusRow = [...(dataRows[1]?.querySelectorAll("td") || [])].map((td) => txt(td));

    const result = {};
    colKeys.forEach((key, i) => {
        if (!key.endsWith("Verte")) return; // skip non-monetary columns (e.g. skaičius header)
        const base = key.replace(/Verte$/, ""); // "tarptautinoVerte" → "tarptautino"
        result[base + "Verte"] = numLt(verteRow[i]);
        result[base + "Skaicius"] = numLt(skaiciusRow[i]);
    });
    return result;
}

// ─── Atn-3 (formType 3) ───────────────────────────────────────────────────────

function parseAtn3(notice) {
    const bodies = parseTeisinisPagrindas(notice);
    const teisinisPagrindas = bodies[0] ?? null;
    const ataskaitiniaiMetai = bodies[1] ?? null;
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const sIII = findSection(notice, "III. MAŽOS VERTĖS");
    const sVIII = findSection(notice, "VIII. KITA INFORMACIJA");

    // Section VI — large procurement table (transposed: headers=types, rows=vertė/skaičius)
    const sVI = findSection(notice, "VI. PIRKIMAI");
    const didesnesVertesPirkimai = sVI ? parseDidesniosVerte(sVI) : null;

    // Section VII — internal transactions
    const sVII = findSection(notice, "VII. VIEŠŲJŲ PIRKIMŲ");
    const vidausSandoriai = sVII ? parseTableRows(sVII.querySelector("table")) : null;

    // Section VII¹ — simplified procurements
    const sVII1 = findSection(notice, "VII");
    const supaprastintiPirkimai = sVII1 && sVII1 !== sVII
        ? parseTableRows(sVII1.querySelector("table"))
        : null;

    return {
        teisinisPagrindas,
        ataskaitiniaiMetai,
        perkanciojiOrganizacija: parseOrgEpsText(sII),
        bendraVerteNevirsijo30000: sII
            ? boolFldByLabel(sII, "neviršijo 30 000")
            : null,
        mazosVertesPirkimai: sIII ? parseBody(findBody(sIII, "1.")) : null,
        keliuTransportoPriemones: sIII ? boolFld(sIII, "2.") : null,
        didesnesVertesPirkimai,
        vidausSandoriai,
        supaprastintiPirkimai,
        atsakingasAsmuo: sVIII ? parseAtsakingasAsmuo(sVIII, "1.") : null,
        papildomaInformacija: (() => {
            const v = sVIII ? fld(sVIII, "2.") : null;
            return v?.replace(/^Papildoma informacija:\s*/i, "").trim() || null;
        })(),
    };
}

// ─── AtGn-1 (formType 4) ──────────────────────────────────────────────────────

function parseAtGn1(notice) {
    const sI = findSection(notice, "I. BENDRA INFORMACIJA");
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const sIII = findSection(notice, "III. PIRKIMO OBJEKTAS");
    const sIV = findSection(notice, "IV. PIRKIMO BŪDAS");
    const sV = findSection(notice, "V. DALYVIAI");
    const sVI = findSection(notice, "VI. PASIŪLYMŲ VERTINIMAS");
    const sVII = findSection(notice, "VII. SKUNDAI");
    const sVIII = findSection(notice, "VIII. PIRKIMO PROCEDŪRŲ PABAIGA");
    const sIX = findSection(notice, "IX. SUTARTYS");
    const sX = findSection(notice, "X. INFORMACIJA APIE ĮSLAPTINTOS");
    const sXI = findSection(notice, "XI. KITA INFORMACIJA");

    const bvpzBody = sIII ? findBody(sIII, "3.") : null;
    const { pagrindinis: pagrindinisKodasBvpz, papildomi: papildomiKodaiBvpz } =
        parseBvpz(bvpzBody);

    return {
        pirkimoNumeris: sI ? fld(sI, "1.") : null,
        pirkimoObjektoPavadinimas: sI ? fld(sI, "2.") : null,
        pirkimoTipas: sI ? fld(sI, "3.") : null,
        finansuojamasEsLesomis: sI ? bool(fld(sI, "4.")) : null,
        elektroninisPirkimas: sI ? bool(fld(sI, "5.")) : null,
        perkanciojiOrganizacija: parseOrgTable(sII),
        igaliojimasKitaiPO: sII ? bool(fld(sII, "1.")) : null,
        preliminariSutartis: sIII ? bool(fld(sIII, "1.")) : null,
        pirkimoObjektoRusis: sIII ? fld(sIII, "2.") : null,
        pagrindinisKodasBvpz,
        papildomiKodaiBvpz,
        daliuSkaicius: sIII ? numLt(fld(sIII, "4.")) : null,
        pirkimoBudas: sIV ? fld(sIV, "1.") : null,
        dalyviai: sV ? parseTableRows(sV.querySelector("table")) : [],
        vertinimoKriterijai: sVI ? fld(sVI, "1.") : null,
        atmestiPasiulymai: sVI ? parseBody(findBody(sVI, "2.")) : [],
        pasiulymuEile: sVI ? parseBody(findBody(sVI, "3.1.")) : [],
        skundai: {
            pretenzijaPateikta: sVII ? bool(fld(sVII, "1.")) : null,
            ieskinysTeismui: sVII ? bool(fld(sVII, "2.")) : null,
        },
        proceduruPabaiga: sVIII ? parseBody(findBody(sVIII, "1.")) : [],
        sutartys: sIX ? parseRecords(findBody(sIX, "2.")) : [],
        sutartiesSavybes: {
            subrangosKetinama: sIX ? bool(fld(sIX, "2.1.")) : null,
        },
        islaptintaInformacija: sX
            ? {
                  naudojama: sX ? bool(fld(sX, "1.")) : null,
                  naudojimoBudas: sX ? fld(sX, "1.1.") : null,
                  auksciausiaSlaptumoZyma: sX ? fld(sX, "1.2.") : null,
              }
            : null,
        papildomaInformacija: sXI ? fld(sXI, "1.") : null,
        atsakingasAsmuo: sXI ? parseAtsakingasAsmuo(sXI, "2.") : null,
    };
}

// Parse the secrecy-classification breakdown table in AtGn-2 section III.2.
// Two-row thead: row 0 = "Apimtis | Slaptumo žyma (cs=3) | Iš viso"
//                row 1 = "Slaptai | Konfidencialiai | Riboto naudojimo"
// Two data rows: "Pirkimų skaičius" and "Vertė".
// Result: { slaptaiSkaicius, slaptaiVerte, konfidencialSkaicius, ... }
function parseSlaptumoZyma(bodyEl) {
    const table = bodyEl?.querySelector("table");
    if (!table) return null;
    const theadRows = [...table.querySelectorAll("thead tr")];
    if (theadRows.length < 2) return null;
    // Sub-column keys from second header row (aligns to data cells 1..N, skipping label at 0)
    const subCols = [...theadRows[1].querySelectorAll("th,td")].map((c) => toCamel(txt(c) || ""));
    const dataRows = [...table.querySelectorAll("tbody tr")];
    if (dataRows.length < 2) return null;
    const skaiciusRow = [...dataRows[0].querySelectorAll("td")].map((c) => txt(c));
    const verteRow   = [...dataRows[1].querySelectorAll("td")].map((c) => txt(c));
    const result = {};
    subCols.forEach((key, i) => {
        result[key + "Skaicius"] = numLt(skaiciusRow[i + 1]);
        result[key + "Verte"]   = numLt(verteRow[i + 1]);
    });
    return result;
}

// ─── AtGn-2 (formType 5) ──────────────────────────────────────────────────────

function parseAtGn2(notice) {
    const sI = findSection(notice, "I. ATASKAITINIAI");
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const sIII = findSection(notice, "III. MAŽOS VERTĖS");
    const sIV = findSection(notice, "IV. KITA INFORMACIJA");

    const ataskaitiniaiMetai = sI
        ? (() => {
              const inner = sI.children[0];
              const body = inner
                  ? [...inner.children].find((c) => c.classList.contains("eps-sub-section-body"))
                  : null;
              return txt(body);
          })()
        : null;

    return {
        ataskaitiniaiMetai,
        perkanciojiOrganizacija: parseOrgTable(sII),
        mazosVertesPirkimai: sIII ? parseBody(findBody(sIII, "1.")) : null,
        pagalSlaptumoZyma: sIII ? parseSlaptumoZyma(findBody(sIII, "2.")) : null,
        papildomaInformacija: sIV ? fld(sIV, "1.") : null,
        atsakingasAsmuo: sIV ? parseAtsakingasAsmuo(sIV, "2.") : null,
    };
}

// ─── Atk-1 (formType 6) ───────────────────────────────────────────────────────

function parseAtk1(notice) {
    const sI = findSection(notice, "I. BENDRA INFORMACIJA APIE KONCESIJĄ");
    const sII = findSection(notice, "II. SUTEIKIANČIOJI");
    const sIII = findSection(notice, "III. KONCESIJOS DALYKAS");
    const sIV = findSection(notice, "IV. KONCESIJOS SUTEIKIMO BŪDAS");
    const sV = findSection(notice, "V. KONCESIJOS DALYVIAI");
    const sVI = findSection(notice, "VI. SKUNDAI");
    const sVII = findSection(notice, "VII. KONCESIJOS SUTEIKIMO PROCEDŪRŲ PABAIGA");
    const sVIII = findSection(notice, "VIII. KITA INFORMACIJA");

    // Narrow to the "3." field whose head mentions KONCESIJOS SUTARTĮ (not sI "3." for koncesijosVerte)
    const sutartyTable = (() => {
        for (const head of notice.querySelectorAll(".eps-sub-section-head")) {
            if (head.querySelector(".index")?.textContent.trim() !== "3.") continue;
            if (!head.querySelector(".body")?.textContent.includes("INFORMACIJA APIE KONCESIJOS SUTARTĮ"))
                continue;
            const siblings = [...head.parentElement.children];
            const idx = siblings.indexOf(head);
            const next = siblings[idx + 1];
            if (next) return next;
        }
        return null;
    })();

    const bvpzBody = sIII ? findBody(sIII, "1.") : null;
    const { pagrindinis: pagrindinisKodasBvpz, papildomi: papildomiKodaiBvpz } =
        parseBvpz(bvpzBody);

    return {
        koncesijosNumeris: sI ? fld(sI, "1.") : null,
        koncesijosPavadinimas: sI ? fld(sI, "2.") : null,
        koncesijosVerte: sI ? fld(sI, "3.") : null,
        finansuojamasEsLesomis: sI ? bool(fld(sI, "4.")) : null,
        suteikiancioji: parseOrgTable(sII),
        igaliojimasKitaiSuteikiancioji: sII ? bool(fld(sII, "1.")) : null,
        pagrindinisKodasBvpz,
        papildomiKodaiBvpz,
        sutartiesTipas: sIII ? fld(sIII, "2.") : null,
        daliuSkaicius: sIII ? numLt(fld(sIII, "3.")) : null,
        suteikimoBudas: sIV ? fld(sIV, "1.") : null,
        dalyviai: sV ? parseBody(findBody(sV, "1.")) : null,
        dalyvioInformacija: sV ? parseBody(findBody(sV, "2.")) : null,
        dalyviuPasalinimoPagrindai: sV ? parseBody(findBody(sV, "3.")) : null,
        dalyvisPasalintas: sV ? boolFldByLabel(sV, "buvo pašalintas") : null,
        pasiulymuVertinimas: sV ? parseBody(findBody(sV, "5.")) : null,
        skundai: {
            pretenzijaPateikta: sVI ? bool(fld(sVI, "1.")) : null,
            ieskinysTeismui: sVI ? bool(fld(sVI, "2.")) : null,
        },
        proceduruPabaiga: sVII ? parseBody(findBody(sVII, "1.")) : [],
        sutartys: sutartyTable ? parseBody(sutartyTable) : [],
        papildomaInformacija: sVIII ? fld(sVIII, "1.") : null,
        atsakingasAsmuo: sVIII ? parseAtsakingasAsmuo(sVIII, "2.") : null,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Pagal formTypeId parenka atitinkamą parserį ir grąžina JSON objektą.
export function parseNoticeByType(notice, formTypeId) {
    const ft = Number(formTypeId);
    if (ft === 1) return parseAtn1(notice);
    if (ft === 3) return parseAtn3(notice);
    if (ft === 4) return parseAtGn1(notice);
    if (ft === 5) return parseAtGn2(notice);
    if (ft === 6) return parseAtk1(notice);
    return null; // ft === 2 (Atn-2) — DB tokių ataskaitų nėra
}

/* 6 types, create scrape functions for all
Atn-1 https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/2017-624732?formTypeId=1
Atn-2 // TODO later
Atn-3 https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/2024-613433?formTypeId=3
AtGn-1 https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/2024-677876?formTypeId=4
AtGn-2 https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/2024-650900?formTypeId=5
Atk-1 https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/2024-698325?formTypeId=6
*/
import { parseHTML } from "linkedom";

// ─── helpers ─────────────────────────────────────────────────────────────────

const txt = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;
const bool = (v) => {
    // Some fields embed the question text before the answer; use the last word.
    const last = String(v ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    return last === "taip" ? true : last === "ne" ? false : null;
};
// Read a td value: boolean for checkboxes, text otherwise
const cellVal = (td) => {
    const cb = td.querySelector("input[type=checkbox]");
    if (cb) return cb.hasAttribute("checked");
    return txt(td);
};
// Convert Lithuanian decimal string ("124 618,50") to number; leave others as-is
const numLt = (v) => {
    if (!v) return v;
    const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? v : n;
};
// Column keys whose values should be numeric (monetary amounts, counts, scores, row/part numbers)
const NUM_KEY_RE = /(?:verte|skaicius|kaina|santykis|naudingumas|nr)\d*$/i;

// Lithuanian → ASCII
const LT = {ą:"a",č:"c",ę:"e",ė:"e",į:"i",š:"s",ų:"u",ū:"u",ž:"z",Ą:"A",Č:"C",Ę:"E",Ė:"E",Į:"I",Š:"S",Ų:"U",Ū:"U",Ž:"Z"};
const LT_RE = /[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g;

// Verbose/long keys (post-transliteration) → short equivalents
const LABEL_MAP = {
    // Org fields from parseOrgTable / parseKeyValueSections
    oficialusPavadinimas:              "pavadinimas",
    juridinioAsmensKodas:              "kodas",
    asmuoRysiais:                      "asmuo",
    asmuoRysiams:                      "asmuo",
    internetoAdresas:                  "svetaine",
    pagrindinisAdresas:                "svetaine",
    pirkejoProfilioAdresas:            "pirkejoProfilis",
    vardasPavarde:                     "vardas",
    telefonoNumeris:                   "telefonas",
    elektroninioPastoAdresas:          "elPastas",
    // Common table columns
    pirkimoObjektoDaliesNumeris:       "daliesNr",
    nustatytosPasiulymuEilesNumeris:   "eileNr",
    kodasPavadinimas:                  "kodas",
    kodasPavadinimas2:                 "pavadinimas",
    dalyvioKodasPavadinimas:           "kodas",
    dalyvioKodasPavadinimas2:          "pavadinimas",
    pasiulymuArGalutiniuPasiulymuNepateikimas: "nepateikimas",
    pasiulymuAtmetimoTeisiniaiPagrindai: "teisiniaiPagrindai",
    pasiulymuAtmetimoPriezastys:       "priezastys",
    pasiulymoKainosArSanauduIrKokybesSantykis: "kainosSantykis",
    pasiulymoKainosSanauduIsraiska:    "kainosIsraiska",
    pasiulymoEkonominisNaudingumas:    "naudingumas",
    pasiulymoKaina:                    "kaina",
    pasiulymoKainosIsraiska:           "kainosIsraiska",
    sprendimaNulemusiosPriezastys:     "priezastys",
    sutartyjeNustatytaBendraPirkimoObjektoDaliesVerteBendraNumatomaSutartiesVerte: "verte",
    zymetiJeiguVerteYraOrientacine:    "orientacine",
    // Annual report table columns
    pirkimoObjektoRusis:               "rusis",
    bendraSudarytuSutarciuVerte:       "verte",
    bendraSudarytosSutartiesVerte:     "verte",
    bendrasPirkimuSkaicius:            "pirkimuSkaicius",
    is2StulpelyjeNurodytosVertesIvykdytuZaliujuPirkimuSudarytuSutarciuVerte: "zaliujuVerte",
    is3StulpelyjeNurodytoSkaiciausIvykdytuZaliujuPirkimuSkaicius: "zaliujuSkaicius",
    bendraSudarytuSutarciuAtlikusTarptautiniusPirkimusVerte: "tarptautinoVerte",
    bendraSudarytuSutarciuAtlikusSupaprastintusPirkimusVerte: "supaprastintoVerte",
    bendraSudarytuSutarciuAtlikusMazosVertesPirkimusArbaBendraPerkanciosiosOrganizacijosArPerkanciojoSubjektoKuriamTaikomaViesujuPirkimuIstatymo25Straipsnio5DaliesArbaKomunalinioSektoriausPirkimuIstatymo37Straipsnio4DaliesIsimtisSudarytuSutarciuVerte: "mazosVertesVerte",
    kontroliuojamoSubjektoIrSusijusiosImonesKodasPavadinimas:  "subjektoKodas",
    kontroliuojamoSubjektoIrSusijusiosImonesKodasPavadinimas2: "subjektoPavadinimas",
    susijusiImone:                     "imone",
    numatomaSutartiesIvykdymoData:     "ivykdymoData",
    sudarytosSutartiesVerte:           "verte",
    // Concession participant detail table (V.2)
    pateikeParaiska:                                          "paraiska",
    pateikePreliminaruNeisipareigojaMajiPasiulyma:            "preliminarisPasiulymas",
    priezastysJeiguNepateikeNeisipareigojaMojoPasiulymo:      "preliminaroPriezastys",
    pateikeIssamuIsipareigojamajiPasiulyma:                   "issamusPasiulymas",
    priezastysJeiguNepateikeIssamausIsipareigojamojoPasiulymo: "issamoPriezastys",
    poVykdytuDerybuPateikeGalutiniPasiulyma:                  "galutinisPasiulymas",
    priezastysJeiguPoVykdytuDerybuNepateikeGalutinioPasiulymo: "galutinioPriezastys",
    // Concession table columns
    koncesijosDaliesNumeris:           "daliesNr",
    dalyvioEilesNumerisSaraseSudarytamePagalSuteiktuVertinimuEiliskuma: "eileNr",
    pasiulymoCharakteristikosLemusiosPasiulymuiSuteiktaVietaEileje: "charakteristikos",
    sprendimaNulemusioPriezastys:       "priezastys",
    koncesijosDalyvioKodasPavadinimas:  "kodas",
    koncesijosDalyvioKodasPavadinimas2: "pavadinimas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas:  "kodas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas2: "pavadinimas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas3: "grupe",
    koncesijosSutartisDelKuriosBuvoSudarytaSutartisNumeris:    "daliesNr",
    koncesijosSutartisDelKuriosBuvoSudarytaSutartisNumeris2:   "nr",
    koncesijosSutartiesSudarymoData:   "sudarymoData",
    koncesijosSutartiesTrukme:         "trukme",
    koncesijosVerte:                   "verte",
};

function toCamelRaw(label) {
    const words = label
        .replace(LT_RE, (c) => LT[c])
        .replace(/\([^)]*\)/g, "")
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
    return words
        .map((w, i) => {
            const lower = w.toLowerCase();
            return i === 0 ? lower : lower[0].toUpperCase() + lower.slice(1);
        })
        .join("");
}

function toCamel(label) {
    const raw = toCamelRaw(label);
    return LABEL_MAP[raw] ?? raw;
}

// Find first .eps-section whose h2 contains heading
function findSection(notice, heading) {
    for (const sec of notice.querySelectorAll(".eps-section")) {
        if (sec.querySelector(".eps-section-head h2")?.textContent.includes(heading))
            return sec;
    }
    return null;
}

// Return the body element associated with field index nr inside container
function findBody(container, nr) {
    for (const head of container.querySelectorAll(".eps-sub-section-head")) {
        if (head.querySelector(".index")?.textContent.trim() !== nr) continue;

        // Pattern B (formType 4): body is a direct child of the head element
        const childBody = [...head.children].find((c) =>
            c.classList.contains("eps-sub-section-body"),
        );
        if (childBody) return childBody;

        // Pattern A: body is the next sibling (eps-sub-section-body or plain div)
        const siblings = [...head.parentElement.children];
        const idx = siblings.indexOf(head);
        const next = siblings[idx + 1];
        if (
            next &&
            !next.classList.contains("eps-sub-section-head") &&
            !next.classList.contains("eps-section-head")
        )
            return next;

        return null;
    }
    return null;
}

const fld = (container, nr) => txt(findBody(container, nr));
const boolFld = (container, nr) => bool(fld(container, nr));

// Auto-detect body type and parse accordingly
function parseBody(bodyEl) {
    if (!bodyEl) return null;

    // Direct <table> element (some sections have table as immediate next sibling of head)
    if (bodyEl.tagName === "TABLE") return parseTableRows(bodyEl);

    // eps-text records (h4/h5 labelled, hr-separated)
    if (bodyEl.querySelector(".eps-text")) return parseRecords(bodyEl);

    // eps-text-section "Label: value" divs (contact info)
    if (bodyEl.querySelector(".eps-text-section")) return parseKeyValueSections(bodyEl);

    // Table inside wrapper
    const table = bodyEl.querySelector("table");
    if (table) return parseTableRows(table);

    return txt(bodyEl);
}

// Parse hr-separated eps-text records into array of camelCase objects
function parseRecords(bodyEl) {
    if (!bodyEl) return [];
    const records = [];
    let cur = {};
    let lastKey = null;

    for (const el of bodyEl.children) {
        if (el.tagName === "HR") {
            if (Object.keys(cur).length) {
                records.push(cur);
                cur = {};
                lastKey = null;
            }
            continue;
        }
        if (!el.classList.contains("eps-text")) continue;

        const heading = el.querySelector("h4, h5");
        if (heading) {
            lastKey = toCamel(heading.textContent.trim());
            // Value in child eps-sub-section-body (h5-pattern used in AtGn forms)
            const childBody = el.querySelector(".eps-sub-section-body");
            const rawVal = childBody
                ? txt(childBody)
                : (el.textContent.replace(heading.textContent, "").replace(/\s+/g, " ").trim() ||
                      null);
            cur[lastKey] = NUM_KEY_RE.test(lastKey) ? numLt(rawVal) : rawVal;
        } else {
            const v = txt(el);
            if (v && lastKey && cur[lastKey] === null) cur[lastKey] = v;
        }
    }
    if (Object.keys(cur).length) records.push(cur);
    return records;
}

// Parse "Label: value" eps-text-section divs (used for contact/responsible person)
function parseKeyValueSections(bodyEl) {
    if (!bodyEl) return null;
    const result = {};
    for (const el of bodyEl.querySelectorAll(".eps-text-section")) {
        const t = txt(el);
        const m = t?.match(/^([^:]+):\s*(.*)/);
        if (m) {
            const k = toCamel(m[1].trim());
            if (k) result[k] = m[2].trim() || null;
        }
    }
    return Object.keys(result).length ? result : null;
}

// Parse table with header row into array of camelCase objects.
// Handles colspan and rowspan in both header and data rows.
function parseTableRows(tableEl) {
    if (!tableEl) return [];

    // Build headers — expand colspan from first thead row
    const headers = [];
    for (const th of tableEl.querySelectorAll("thead tr:first-child th, thead tr:first-child td")) {
        const span = parseInt(th.getAttribute("colspan") || "1", 10);
        const raw = toCamelRaw(txt(th) || "");
        for (let i = 0; i < span; i++) {
            const k = i === 0 ? raw : raw + (i + 1);
            headers.push(LABEL_MAP[k] ?? k);
        }
    }

    // Build data rows with rowspan carry-forward.
    // carry[colIdx] = { value, remaining } tracks cells spanning into future rows.
    const W = Math.max(headers.length, 16); // virtual grid width
    const carry = {};
    const gridRows = [];

    for (const row of tableEl.querySelectorAll("tr")) {
        if (row.parentElement?.tagName === "THEAD") continue;
        if (row.querySelector("th")) continue; // skip sub-header rows

        // Slots: undefined = empty, anything else = filled
        const slots = new Array(W).fill(undefined);

        // Fill carried-over rowspan values first
        for (let c = 0; c < W; c++) {
            if (carry[c]?.remaining > 0) {
                slots[c] = carry[c].value;
                carry[c].remaining--;
            }
        }

        // Fill this row's actual td cells (accounting for colspan + rowspan)
        let ci = 0;
        for (const td of row.querySelectorAll("td")) {
            while (ci < W && slots[ci] !== undefined) ci++; // skip occupied slots
            if (ci >= W) break;
            const colspan = parseInt(td.getAttribute("colspan") || "1", 10);
            const rowspan = parseInt(td.getAttribute("rowspan") || "1", 10);
            const v = cellVal(td);
            for (let s = 0; s < colspan && ci + s < W; s++) {
                slots[ci + s] = v;
                if (rowspan > 1) carry[ci + s] = { value: v, remaining: rowspan - 1 };
            }
            ci += colspan;
        }

        gridRows.push(slots.map((v) => (v === undefined ? null : v)));
    }

    return gridRows
        .map((cells) => {
            if (!headers.length) return cells.filter((v) => v !== null && v !== "" && v !== undefined);
            const obj = {};
            headers.forEach((h, i) => {
                if (!h) return;
                const v = cells[i];
                obj[h] = NUM_KEY_RE.test(h) ? numLt(v) : (typeof v === "boolean" ? v : (v || null));
            });
            return obj;
        })
        .filter((r) => Array.isArray(r) ? r.length : Object.values(r).some((v) => v !== null))
        .filter((r) => Object.values(r)[0] !== "Iš viso");
}

// Parse BVPZ codes block — handles two different HTML structures
function parseBvpz(bodyEl) {
    if (!bodyEl) return { pagrindinis: null, papildomi: [] };

    // Atn-1 style: .row.form-row with .span2 (code) + .span7 (description)
    const formRows = [...bodyEl.querySelectorAll(".row.form-row")];
    if (formRows.length) {
        return {
            pagrindinis: formRows[0] ? txt(formRows[0].querySelector(".span2")) : null,
            papildomi: formRows.slice(1).map((r) => txt(r.querySelector(".span2"))).filter(Boolean),
        };
    }

    // AtGn-1 style: .atg1-cpv-container with two tables (main + additional)
    const cpvContainer = bodyEl.classList.contains("atg1-cpv-container")
        ? bodyEl
        : bodyEl.querySelector(".atg1-cpv-container");
    if (cpvContainer) {
        const dataRows = (tableEl) =>
            [...(tableEl?.querySelectorAll("tr") || [])].filter(
                (r) => !r.closest("thead") && r.querySelector("td"),
            );
        const mainTable = cpvContainer.querySelector(".atg1-cpv-item-first table");
        const addTable = cpvContainer.querySelector(".atg1-cpv-item-second table");
        return {
            pagrindinis: dataRows(mainTable)[0]
                ? txt(dataRows(mainTable)[0].querySelector("td"))
                : null,
            papildomi: dataRows(addTable)
                .map((r) => txt(r.querySelector("td")))
                .filter(Boolean),
        };
    }

    return { pagrindinis: null, papildomi: [] };
}

// Parse org info from eps-text divs by position (Atn-1/Atn-3 style)
function parseOrgEpsText(secEl) {
    const head = [...(secEl?.querySelectorAll(".eps-sub-section-head") || [])].find((h) =>
        h.querySelector(".body")?.textContent.includes("Perkančioji organizacija"),
    );
    if (!head) return null;

    let bodyEl;
    const childBody = [...head.children].find((c) =>
        c.classList.contains("eps-sub-section-body"),
    );
    if (childBody) {
        bodyEl = childBody;
    } else {
        const siblings = [...head.parentElement.children];
        const i = siblings.indexOf(head);
        const next = siblings[i + 1];
        bodyEl = next?.classList.contains("eps-sub-section-body") ? next : null;
    }
    if (!bodyEl) return null;

    const texts = [...bodyEl.querySelectorAll(".eps-text")]
        .map((el) => (el.querySelector(".eps-sub-section-head") ? null : txt(el)));

    return {
        tipas: texts[14] || null,
        pavadinimas: texts[0] || null,
        kodas: texts[1] || null,
        adresas: texts[2] || null,
        miestas: texts[3] || null,
        pastoKodas: texts[4] || null,
        salis: texts[5] || null,
        asmuo: texts[6] || null,
        telefonas: texts[7] || null,
        elPastas: texts[8] || null,
        faksas: texts[9] || null,
        svetaine: texts[10] || null,
        pirkejoProfilis: texts[11] || null,
    };
}

// Parse org info from table with "Label: value" cells (AtGn/Atk style)
function parseOrgTable(secEl) {
    const tables = [...(secEl?.querySelectorAll("table") || [])];
    if (!tables.length) return null;

    const org = {};
    for (const cell of tables[0].querySelectorAll("td")) {
        // Use raw textContent (preserves newlines) so multi-value cells like
        // "Interneto adresas (-ai):\nPagrindinis adresas:\nhttp://...\nPirkėjo profilio adresas:\nhttps://..."
        // are split correctly before whitespace is collapsed.
        const raw = cell.textContent;
        if (!raw.trim()) continue;
        let lastKey = null;
        for (const line of raw.split(/[\n\r]+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)) {
            // URL-only lines are continuation values for the previous key
            if (/^https?:\/\//.test(line)) {
                if (lastKey && !org[lastKey]) org[lastKey] = line;
                continue;
            }
            const m = line.match(/^([^:]+):\s*(.*)/);
            if (m) {
                const k = toCamel(m[1].trim());
                if (k) {
                    lastKey = k;
                    org[k] = m[2].trim() || null;
                }
            }
        }
    }

    // Org type from second table (if any)
    const typeCell = tables[1]?.querySelector("tbody td:nth-child(2), tbody td:last-child");
    const tipas = typeCell ? txt(typeCell) : null;

    return Object.keys(org).length ? { tipas, ...org } : null;
}

// Returns array of all eps-sub-section-body texts from the "Teisinis pagrindas" section.
// [0] = legal basis, [1] = tipas (Atn-1) or ataskaitiniaiMetai (Atn-3)
function parseTeisinisPageindas(notice) {
    const tSec = findSection(notice, "Teisinis pagrindas");
    if (!tSec) return [];
    const inner = tSec.children[0];
    if (!inner) return [];
    return [...inner.children]
        .filter((c) => c.classList.contains("eps-sub-section-body"))
        .map((b) => txt(b));
}

// Responsible person section (eps-text-section style, used in XI/VIII kita informacija)
function parseAtsakingasAsmuo(container, nr) {
    const body = findBody(container, nr);
    return body ? parseKeyValueSections(body) : null;
}

// ─── Atn-1 (formType 1) ───────────────────────────────────────────────────────

function parseAtn1(notice) {
    const [teisinisPageindas, ataskaitosTipas] = parseTeisinisPageindas(notice);
    const sI = findSection(notice, "I. BENDRA INFORMACIJA");
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const bvpzBody = findBody(notice, "III.4.");
    const { pagrindinis: pagrindinisKodasBvpz, papildomi: papildomiKodaiBvpz } =
        parseBvpz(bvpzBody);

    return {
        teisinisPageindas,
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
    const bodies = parseTeisinisPageindas(notice);
    const teisinisPageindas = bodies[0] ?? null;
    const ataskaitiniaiMetai = bodies[1] ?? null;
    const sII = findSection(notice, "II. PERKANČIOJI ORGANIZACIJA");
    const sIII = findSection(notice, "III. MAŽOS VERTĖS");
    const sVIII = findSection(notice, "VIII. KITA INFORMACIJA");

    // Section VI — large procurement table (transposed: headers=types, rows=vertė/skaičius)
    const sVI = findSection(notice, "VI. PIRKIMAI");
    const didesnesVertesPirkimai = sVI ? parseDidesniosVerte(sVI) : null;

    // Section VII — internal transactions
    const sVII = findSection(notice, "VII. VIEŠŲJŲ PIRKIMŲ");
    const vidusSandoriai = sVII ? parseTableRows(sVII.querySelector("table")) : null;

    // Section VII¹ — simplified procurements
    const sVII1 = findSection(notice, "VII");
    const supaprastintiPirkimai = sVII1 && sVII1 !== sVII
        ? parseTableRows(sVII1.querySelector("table"))
        : null;

    return {
        teisinisPageindas,
        ataskaitiniaiMetai,
        perkanciojiOrganizacija: parseOrgEpsText(sII),
        mazosVertesPirkimai: sIII ? parseBody(findBody(sIII, "1.")) : null,
        keliuTransportoPriemones: sIII ? boolFld(sIII, "2.") : null,
        didesnesVertesPirkimai,
        vidusSandoriai,
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
        islaptinaInformacija: sX
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

export async function scrapeAtaskaitosContent(id, formTypeId) {
    const url = `https://cvpp.eviesiejipirkimai.lt/ReportsOrProtocol/Details/${id}?formTypeId=${formTypeId}`;
    const response = await fetch(url);
    const text = await response.text();
    const { document } = parseHTML(text);
    const notice = document.querySelector("#notice");
    if (!notice) return null;

    const ft = Number(formTypeId);
    if (ft === 1) return parseAtn1(notice);
    if (ft === 3) return parseAtn3(notice);
    if (ft === 4) return parseAtGn1(notice);
    if (ft === 5) return parseAtGn2(notice);
    if (ft === 6) return parseAtk1(notice);
    return null; // ft === 2 — TODO later
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const id = process.argv[2];
    const formTypeId = process.argv[3];
    if (!id || !formTypeId) {
        console.error("Usage: node scrapeAtaskaitosContent.js <id> <formTypeId>");
        process.exit(1);
    }
    scrapeAtaskaitosContent(id, formTypeId).then((data) => {
        console.log(JSON.stringify(data, null, 2));
    });
}

import {
    cellVal,
    NUM_KEY_RE,
    numLt,
    toCamel,
    toCamelRaw,
    txt,
} from "./primitives.js";
import { findBody, findSection } from "./fields.js";

// Auto-detect body type and parse accordingly
export function parseBody(bodyEl) {
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
export function parseRecords(bodyEl) {
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
            const rawKey = toCamelRaw(heading.textContent.trim());
            lastKey = LABEL_MAP[rawKey] ?? rawKey;
            // Value in child eps-sub-section-body (h5-pattern used in AtGn forms)
            const childBody = el.querySelector(".eps-sub-section-body");
            const rawVal = childBody
                ? txt(childBody)
                : (el.textContent.replace(heading.textContent, "").replace(/\s+/g, " ").trim() ||
                      null);
            // "Kodas, pavadinimas" combined columns: same label maps to a 2nd key
            // (…Pavadinimas2) in LABEL_MAP – split "kodas, pavadinimas" into code + name.
            // Separator varies in the source: "162576776, Pavadinimas" (comma) or
            // "302416819 Pavadinimas" (leading code + space).
            const pavKey = LABEL_MAP[rawKey + "2"];
            const codeName = pavKey && rawVal
                ? rawVal.match(/^\s*([^,]+?)\s*,\s*(.+)$/s) || rawVal.match(/^\s*(\d+)\s+(\S.*)$/s)
                : null;
            if (codeName) {
                cur[lastKey] = codeName[1].trim() || null;
                cur[pavKey] = codeName[2].trim() || null;
            } else {
                cur[lastKey] = NUM_KEY_RE.test(lastKey) ? numLt(rawVal) : rawVal;
            }
        } else {
            const v = txt(el);
            if (v && lastKey && cur[lastKey] === null)
                cur[lastKey] = NUM_KEY_RE.test(lastKey) ? numLt(v) : v;
        }
    }
    if (Object.keys(cur).length) records.push(cur);
    return records;
}

// Parse "Label: value" eps-text-section divs (used for contact/responsible person)
export function parseKeyValueSections(bodyEl) {
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
export function parseTableRows(tableEl) {
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
export function parseBvpz(bodyEl) {
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
export function parseOrgEpsText(secEl) {
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
export function parseOrgTable(secEl) {
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
export function parseTeisinisPagrindas(notice) {
    const tSec = findSection(notice, "Teisinis pagrindas");
    if (!tSec) return [];
    const inner = tSec.children[0];
    if (!inner) return [];
    return [...inner.children]
        .filter((c) => c.classList.contains("eps-sub-section-body"))
        .map((b) => txt(b));
}

// Responsible person section (eps-text-section style, used in XI/VIII kita informacija)
export function parseAtsakingasAsmuo(container, nr) {
    const body = findBody(container, nr);
    return body ? parseKeyValueSections(body) : null;
}



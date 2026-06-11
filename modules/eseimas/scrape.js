import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { upsertInventoryObject } from "../teisekura/storage.js";

const SEARCH_URL = "https://e-seimas.lrs.lt/portal/legalActProjectSearch/lt";
const ROWS_PER_PAGE = 20;
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
    "Accept-Language": "lt-LT,lt;q=0.9,en;q=0.7",
};

function collapse(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

export function cleanEseimasUrl(href, base = SEARCH_URL) {
    if (!href) return null;
    const url = new URL(href, base);
    url.searchParams.delete("positionInSearchResults");
    url.searchParams.delete("searchModelUUID");
    return url.toString();
}

export function projectIdFromUrl(url) {
    if (!url) return null;
    try {
        return new URL(url, SEARCH_URL).pathname.split("/").filter(Boolean).at(-1) ?? null;
    } catch {
        return null;
    }
}

function projectColumns(tr) {
    const table = tr.closest("table");
    const headers = Array.from(table?.querySelectorAll("thead th") ?? [])
        .map((th) => collapse(th.textContent).toLowerCase());
    const find = (fallback, ...names) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? index : fallback;
    };
    return {
        rusis: find(2, "rūšis"),
        pavadinimas: find(3, "pavadinimas"),
        registracijosNr: find(4, "dok. nr.", "dokumento nr.", "registracijos nr."),
        registravimoData: find(5, "reg. data", "registravimo data"),
        busena: find(6, "būsena", "statusas"),
    };
}

function cellValue(cells, index) {
    return index >= 0 ? collapse(cells[index]?.textContent) : "";
}

function isoDateOrNull(value) {
    const normalized = collapse(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function parseProjectResults(html) {
    const { document } = parseHTML(html);
    return Array.from(document.querySelectorAll("tr[data-ri]")).flatMap((tr) => {
        const cells = Array.from(tr.querySelectorAll("td"));
        const columns = projectColumns(tr);
        const link = tr.querySelector("a[href*='/legalAct']");
        const url = cleanEseimasUrl(link?.getAttribute("href"));
        const sourceId = projectIdFromUrl(url);
        if (!url || !sourceId) return [];
        const rawRegistrationDate = cellValue(cells, columns.registravimoData);
        const registravimoData = isoDateOrNull(rawRegistrationDate);
        if (rawRegistrationDate && !registravimoData) {
            throw new Error(`Neteisinga e-Seimo projekto ${sourceId} registravimo data: ${rawRegistrationDate}`);
        }
        return [{
            sourceId,
            url,
            rusis: cellValue(cells, columns.rusis),
            pavadinimas: collapse(link?.textContent) || cellValue(cells, columns.pavadinimas),
            registracijosNr: cellValue(cells, columns.registracijosNr),
            registravimoData,
            busena: cellValue(cells, columns.busena),
        }];
    });
}

function cookiesFrom(res) {
    return (res.headers.get("set-cookie") ?? "")
        .split(/,(?=[^ ])/)
        .map((item) => item.split(";")[0])
        .join("; ");
}

function partialUpdates(xml) {
    const updates = {};
    for (const match of xml.matchAll(/<update\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/update>/g)) {
        const value = match[2].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
        updates[match[1]] = value;
        const viewStateKey = match[1].split(":").find((part) => part.startsWith("javax.faces.ViewState"));
        if (viewStateKey) updates["javax.faces.ViewState"] = value;
    }
    return updates;
}

async function initialSearch() {
    log("Kraunama e-Seimo projektų paieškos forma");
    const res = await fetch(SEARCH_URL, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`e-Seimas HTTP ${res.status}`);
    const html = await res.text();
    const { document } = parseHTML(html);
    const viewState = document.querySelector("input[name='javax.faces.ViewState']")?.value;
    const form = document.querySelector("form[id$='contentForm']");
    const searchButton = document.querySelector("[id$='searchButton']");
    if (!viewState || !form || !searchButton) throw new Error("e-Seimas paieškos forma pasikeitė");

    const body = new URLSearchParams();
    form.querySelectorAll("input[name], select[name]").forEach((el) => {
        const type = el.getAttribute("type")?.toLowerCase();
        if (type === "submit" || type === "button") return;
        if ((type === "checkbox" || type === "radio") && !el.hasAttribute("checked")) return;
        const selected = el.querySelector?.("option[selected]");
        const value = (type === "checkbox" || type === "radio") && !el.hasAttribute("value")
            ? "on"
            : selected?.getAttribute("value") ?? el.getAttribute("value") ?? "";
        body.set(el.getAttribute("name"), value);
    });
    body.set("javax.faces.partial.ajax", "true");
    body.set("javax.faces.source", searchButton.id);
    body.set("javax.faces.partial.execute", "@all");
    body.set("javax.faces.partial.render", form.id);
    body.set(searchButton.id, searchButton.id);
    body.set(`${form.id}_SUBMIT`, "1");
    body.set("javax.faces.ViewState", viewState);

    const action = new URL(form.getAttribute("action") || res.url, res.url).href;
    log("Vykdoma e-Seimo projektų paieška");
    const post = await fetch(action, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
            ...HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Faces-Request": "partial/ajax",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookiesFrom(res),
            Referer: action,
        },
        body,
    });
    if (!post.ok) throw new Error(`e-Seimas paieška HTTP ${post.status}`);
    return { text: await post.text(), url: action, cookies: cookiesFrom(res) };
}

export async function upsertProjectRows(rows) {
    const invalidDate = rows.find((row) => row.registravimoData && !isoDateOrNull(row.registravimoData));
    if (invalidDate) {
        throw new Error(`Neteisinga e-Seimo projekto ${invalidDate.sourceId} registravimo data: ${invalidDate.registravimoData}`);
    }
    await Promise.all(rows.map((row) => upsertInventoryObject({
        source: "eseimas",
        sourceId: row.sourceId,
        rootSourceId: row.sourceId,
        kind: "projektas",
        url: row.url,
        pavadinimas: row.pavadinimas,
        registracijosNr: row.registracijosNr,
        happenedAt: row.registravimoData || null,
        forceRefresh: true,
    })));
}

export async function scrapeLatest() {
    const response = await initialSearch();
    const html = [...response.text.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
        .map((match) => match[1]).join("\n") || response.text;
    const rows = parseProjectResults(html);
    await upsertProjectRows(rows);
    log(`Atnaujintas ${rows.length} e-Seimo projektų inventorius`);
    return rows;
}

export async function scrapeAllProjects() {
    log("Pradedamas visų e-Seimo projektų inventoriaus backfill");
    const response = await initialSearch();
    let updates = partialUpdates(response.text);
    let html = Object.values(updates).join("\n");
    let viewState = updates["javax.faces.ViewState"];
    const tableId = html.match(/id="([^"]+:resultsTable)"/)?.[1];
    const formId = tableId?.replace(/:resultsTable$/, "");
    const rowCount = Number(html.match(/rowCount:(\d+)/)?.[1] ?? 0);
    if (!tableId || !formId || !viewState) throw new Error("e-Seimas rezultatų puslapiavimo struktūra pasikeitė");
    if (!rowCount) throw new Error("e-Seimo projektų paieška netikėtai grąžino 0 įrašų");
    log(`e-Seimo paieškoje rasta ${rowCount} projektų`);

    let total = 0;
    for (let first = 0; first < rowCount; first += ROWS_PER_PAGE) {
        if (first > 0) {
            const body = new URLSearchParams({
                "javax.faces.partial.ajax": "true",
                "javax.faces.source": tableId,
                "javax.faces.partial.execute": tableId,
                "javax.faces.partial.render": tableId,
                [`${tableId}_pagination`]: "true",
                [`${tableId}_first`]: String(first),
                [`${tableId}_rows`]: String(ROWS_PER_PAGE),
                [`${tableId}_selection`]: "",
                [`${tableId}_encodeFeature`]: "true",
                [`${formId}_SUBMIT`]: "1",
                "javax.faces.ViewState": viewState,
            });
            const page = await fetch(response.url, {
                method: "POST",
                signal: AbortSignal.timeout(60_000),
                headers: {
                    ...HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Faces-Request": "partial/ajax",
                    "X-Requested-With": "XMLHttpRequest",
                    Cookie: response.cookies,
                    Referer: response.url,
                },
                body,
            });
            if (!page.ok) throw new Error(`e-Seimas puslapis HTTP ${page.status}`);
            updates = partialUpdates(await page.text());
            viewState = updates["javax.faces.ViewState"] ?? viewState;
            html = updates[tableId] ?? "";
        }
        const rows = parseProjectResults(html);
        await upsertProjectRows(rows);
        total += rows.length;
        log(`e-Seimas projektai: ${total}/${rowCount}`);
    }
    return total;
}

export { ROWS_PER_PAGE };

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const result = process.argv.includes("--all") ? await scrapeAllProjects() : await scrapeLatest();
        log(`e-Seimo inventoriaus nuskaitymas baigtas: ${Array.isArray(result) ? result.length : result} įrašų`);
    } finally {
        await postgres.end();
    }
}

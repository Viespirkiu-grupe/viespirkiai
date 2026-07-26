import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";
import { collapseWhitespace } from "../../utils/text.js";
import { sleep } from "../../utils/time.js";
import { upsertInventoryObject, recordInterval } from "../teisekura/storage.js";
import { actIdFromUrl, editionSourceIdFromUrl } from "./ids.js";

const BASE_URL = "https://e-tar.lt/portal/lt/legalActSearch";
const ORIGIN = "https://e-tar.lt";
const ROWS_PER_PAGE = 20;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0",
    "Accept-Language": "en-US,en;q=0.9",
};

function responseCookies(headers) {
    const setCookies = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean);
    return setCookies
        .flatMap(value => value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/))
        .map(value => value.split(";")[0].trim())
        .filter(Boolean);
}

function appendCookies(jar, headers) {
    const cookies = new Map();
    for (const pair of [...(jar ? jar.split(/;\s*/) : []), ...responseCookies(headers)]) {
        const separator = pair.indexOf("=");
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
}

// e-TAR occasionally returns a stripped/error page under load (missing the
// search form), which would otherwise abort a multi-hour backfill. Retry the
// initial load a few times with linear backoff before giving up.
async function getInitialPage(attempts = 4) {
    log("Kraunamas pradinis puslapis (ViewState)");
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const res = await fetch(BASE_URL, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const searchForm = parseSearchForm(html);
            const cookies = appendCookies("", res.headers);
            return { searchForm, cookies, html };
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                const delay = 5_000 * attempt;
                log(`Pradinio puslapio klaida (bandymas ${attempt}/${attempts}): ${error.message} — kartojama po ${delay / 1000} s`);
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

export function parseSearchForm(html) {
    const { document } = parseHTML(html);
    const form = document.querySelector("#contentForm");
    if (!form) throw new Error("e-TAR search form not found");

    const defaults = new URLSearchParams();
    for (const control of form.querySelectorAll("input[name], select[name], textarea[name]")) {
        const type = control.getAttribute("type")?.toLowerCase();
        if ((type === "checkbox" || type === "radio") && !control.hasAttribute("checked")) continue;
        if (type === "submit" || type === "button") continue;
        const value = (type === "checkbox" || type === "radio") && !control.hasAttribute("value")
            ? "on"
            : control.value ?? "";
        defaults.append(control.getAttribute("name"), value);
    }

    const adoptionLabels = Array.from(form.querySelectorAll("label"))
        .filter(label => /^Priėmimo data(?: iki)?$/.test(collapseWhitespace(label.textContent)));
    const adoptionInputs = adoptionLabels.map(label => label.getAttribute("for")).filter(Boolean);
    const viewState = defaults.get("javax.faces.ViewState");
    if (!viewState) throw new Error("e-TAR ViewState not found");
    if (adoptionInputs.length !== 2) throw new Error("e-TAR adoption date fields not found");

    return {
        action: new URL(form.getAttribute("action") || BASE_URL, BASE_URL).href,
        defaults,
        viewState,
        adoptionFrom: adoptionInputs[0],
        adoptionTo: adoptionInputs[1],
    };
}

// date: optional "yyyy-mm-dd" to filter by adoption date (priėmimo data nuo/iki)
// ascending: if true, sort oldest-first (for full enumeration)
export function buildSearchBody(searchForm, date = "", ascending = false) {
    return buildSearchRangeBody(searchForm, {
        from: date,
        to: ascending ? "" : date,
        ascending,
    });
}

export function buildSearchRangeBody(searchForm, { from = "", to = "", ascending = false } = {}) {
    const p = new URLSearchParams(searchForm.defaults);
    p.set("javax.faces.partial.ajax", "true");
    p.set("javax.faces.source", "contentForm:searchParamPane:searchButton");
    p.set("javax.faces.partial.execute", "@all");
    p.set("javax.faces.partial.render", "contentForm:resultsPanel contentForm:searchParamPane");
    p.set("contentForm:searchParamPane:searchButton", "contentForm:searchParamPane:searchButton");
    p.set("contentForm_SUBMIT", "1");
    p.set("javax.faces.ViewState", searchForm.viewState);
    p.set(searchForm.adoptionFrom, from);
    p.set(searchForm.adoptionTo, to);
    if (ascending) p.set("contentForm:searchParamPane:sortOrderOptionSelect_input", "on");
    else p.delete("contentForm:searchParamPane:sortOrderOptionSelect_input");
    p.set("contentForm:searchParamPane:paramSortBy_input", "registrationDate");
    return p;
}

function buildPageBody(viewState, first) {
    const p = new URLSearchParams();
    p.set("javax.faces.partial.ajax", "true");
    p.set("javax.faces.source", "contentForm:resultsTable");
    p.set("javax.faces.partial.execute", "contentForm:resultsTable");
    p.set("javax.faces.partial.render", "contentForm:resultsTable");
    p.set("contentForm:resultsTable_pagination", "true");
    p.set("contentForm:resultsTable_first", String(first));
    p.set("contentForm:resultsTable_rows", String(ROWS_PER_PAGE));
    p.set("contentForm:resultsTable_selection", "");
    p.set("contentForm:resultsTable_encodeFeature", "true");
    p.set("contentForm_SUBMIT", "1");
    p.set("javax.faces.ViewState", viewState);
    return p;
}

async function postAjax(url, body, cookies) {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            ...HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Faces-Request": "partial/ajax",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": url,
            ...(cookies ? { Cookie: cookies } : {}),
        },
        body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const newJar = appendCookies(cookies, res.headers);
    return { text, cookies: newJar };
}

function extractFromPartialResponse(xml) {
    // JSF partial response: <update id="..."><![CDATA[...]]></update>
    const updates = {};
    for (const m of xml.matchAll(/<update\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/update>/g)) {
        const raw = m[2].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
        updates[m[1]] = raw;
        // Also index by the last segment for convenience (e.g. "j_id__v_0:javax.faces.ViewState:1" → "javax.faces.ViewState")
        const seg = m[1].split(":").find(s => s.startsWith("javax.faces."));
        if (seg) updates[seg] = raw;
    }
    return updates;
}

export function parseResultsHtml(html) {
    const { document } = parseHTML(html);
    // Pagination updates return bare <tr> elements (no tbody wrapper),
    // full panel returns complete table — use data-ri attribute present on all data rows
    const rows = document.querySelectorAll("tr[data-ri]");
    return Array.from(rows).map(parseRow);
}

function fullUrl(href) {
    if (!href) return href;
    return href.startsWith("http") ? href : ORIGIN + href;
}

function parsePavadinimasTd(td) {
    const result = {};

    const mainLink = td.querySelector("a:not(.link-blue)");
    if (mainLink) {
        result.pavadinimas = collapseWhitespace(mainLink.textContent);
        result.href = fullUrl(mainLink.getAttribute("href"));
    }

    const suvestineLink = td.querySelector("a.link-blue");
    if (suvestineLink) result.suvestineHref = fullUrl(suvestineLink.getAttribute("href"));

    if (td.querySelector(".text-highlight")) result.yraPakeitimu = true;

    // Walk child nodes to collect text segments separated by <br> and the hidden <div>
    let brCount = 0;
    let pastHiddenDiv = false;
    const originalParts = [];

    for (const node of td.childNodes) {
        const name = node.nodeName.toLowerCase();
        if (name === "br") {
            brCount++;
        } else if (name === "div") {
            pastHiddenDiv = true;
        } else if (name === "#text") {
            const t = collapseWhitespace(node.textContent);
            if (!t) continue;
            if (brCount === 1) result.prieme = t;
            else if (brCount === 2) result.uzregistruota = t;
            else if (pastHiddenDiv) originalParts.push(t);
        }
    }

    const originalas = originalParts.join(" ").trim();
    if (originalas) result.originalas = originalas;

    return result;
}

function parseIsigaliojimoDataTd(td) {
    const result = {};
    const dateSpan = td.querySelector("span.dateColumn");
    const isigaliojimoData = dateSpan
        ? collapseWhitespace(dateSpan.textContent)
        : collapseWhitespace(td.textContent).split(" ")[0];
    if (isigaliojimoData) result.isigaliojimoData = isigaliojimoData;

    // Any text after a <br> is a note about specific provisions
    let pastBr = false;
    const noteParts = [];
    for (const node of td.childNodes) {
        if (node.nodeName.toLowerCase() === "br") { pastBr = true; }
        else if (pastBr && node.nodeName === "#text") {
            const t = collapseWhitespace(node.textContent);
            if (t) noteParts.push(t);
        }
    }
    const pastaba = noteParts.join(" ").trim();
    if (pastaba) result.isigaliojimoDataPastaba = pastaba;

    return result;
}

function parseStatusTd(td) {
    const result = {};

    // Validity colour: green / FF4000 (not yet in force) / etc.
    const validityImg = td.querySelector("img[id$='validity']");
    if (validityImg?.getAttribute("style")?.includes("visibility: visible")) {
        const tooltip = td.querySelector("div.ui-tooltip");
        const text = tooltip ? collapseWhitespace(tooltip.textContent) : null;
        if (text) result.galiojimas = text.toLowerCase();
    }

    const editionsLink = td.querySelector("a[href*='legalActEditions']");
    if (editionsLink) result.redakcijuSarasasHref = fullUrl(editionsLink.getAttribute("href"));

    return result;
}

function parseRow(tr) {
    const tds = Array.from(tr.querySelectorAll("td"));
    // columns: 0=checkbox, 1=eilNr, 2=rusis, 3=pavadinimas, 4=istaigosNr, 5=priemimoData, 6=isigaliojimoData, 7=status
    const result = {};

    const eilNr = tds[1]?.textContent?.trim();
    if (eilNr) result.eilNr = eilNr;

    const rusis = tds[2]?.textContent?.trim();
    if (rusis) result.rusis = rusis;

    if (tds[3]) Object.assign(result, parsePavadinimasTd(tds[3]));

    const istaigosNr = collapseWhitespace(tds[4]?.textContent ?? "");
    if (istaigosNr) result.istaigosNr = istaigosNr;

    const priemimoData = tds[5]?.textContent?.trim();
    if (priemimoData) result.priemimoData = priemimoData;

    if (tds[6]) Object.assign(result, parseIsigaliojimoDataTd(tds[6]));
    if (tds[7]) Object.assign(result, parseStatusTd(tds[7]));

    return result;
}

export async function upsertBatch(rows, { forceRefresh = false } = {}) {
    const valid = rows.filter((row) => row.href && actIdFromUrl(row.href));
    const concurrency = 25;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, valid.length) }, async () => {
        while (cursor < valid.length) {
            const row = valid[cursor++];
            const sourceId = actIdFromUrl(row.href);
            await upsertInventoryObject({
                source: "etar",
                sourceId,
                rootSourceId: sourceId,
                kind: "aktas",
                url: row.href,
                pavadinimas: row.pavadinimas,
                registracijosNr: row.uzregistruota,
                dokumentoNr: row.istaigosNr,
                happenedAt: row.priemimoData,
                forceRefresh,
            });
            const editionId = editionSourceIdFromUrl(row.suvestineHref, sourceId);
            if (editionId) {
                await upsertInventoryObject({
                    source: "etar",
                    sourceId: editionId,
                    rootSourceId: sourceId,
                    parentSourceId: sourceId,
                    kind: "redakcija",
                    url: row.suvestineHref,
                    pavadinimas: row.pavadinimas,
                    happenedAt: row.isigaliojimoData,
                    forceRefresh,
                });
            }
        }
    }));
    return valid.length;
}

async function scrapeSearch(date = "") {
    const { searchForm, cookies } = await getInitialPage();

    log(`Paieška: priėmimo data ${date || "visos"}`);
    let { text: searchXml, cookies: jar } = await postAjax(searchForm.action, buildSearchBody(searchForm, date), cookies);
    const searchUpdates = extractFromPartialResponse(searchXml);

    let viewState = searchUpdates["javax.faces.ViewState"] ?? searchForm.viewState;
    const resultsHtml = searchUpdates["contentForm:resultsPanel"] ?? "";

    const rowCount = parseInt(resultsHtml.match(/rowCount:(\d+)/)?.[1] ?? "0", 10);
    const totalPages = rowCount > 0 ? Math.ceil(rowCount / ROWS_PER_PAGE) : 1;
    log(`Rasta ${rowCount} įrašų — ${totalPages} psl.`);

    const all = parseResultsHtml(resultsHtml);
    if (date) assertRowsWithinRange(all, { from: date, to: date }, "dienos paieškos pirmas puslapis");
    log(`Puslapis 1/${totalPages} — nuo ${all[0]?.priemimoData ?? "?"}`);

    for (let page = 1; page < totalPages; page++) {
        const first = page * ROWS_PER_PAGE;
        const { text: pageXml, cookies: newJar } = await postAjax(searchForm.action, buildPageBody(viewState, first), jar);
        jar = newJar;
        const pageUpdates = extractFromPartialResponse(pageXml);
        viewState = pageUpdates["javax.faces.ViewState"] ?? viewState;
        const rows = parseResultsHtml(pageUpdates["contentForm:resultsTable"] ?? "");
        if (date) assertRowsWithinRange(rows, { from: date, to: date }, `dienos paieškos puslapis ${page + 1}`);
        log(`Puslapis ${page + 1}/${totalPages} — nuo ${rows[0]?.priemimoData ?? "?"}`);
        all.push(...rows);
    }

    return all;
}

export async function scrapeLatest(pages = 3) {
    const { searchForm, cookies } = await getInitialPage();

    log("Paieška: naujausi įrašai (mažėjančia tvarka)");
    let { text: searchXml, cookies: jar } = await postAjax(searchForm.action, buildSearchBody(searchForm), cookies);
    const searchUpdates = extractFromPartialResponse(searchXml);

    let viewState = searchUpdates["javax.faces.ViewState"] ?? searchForm.viewState;
    const all = parseResultsHtml(searchUpdates["contentForm:resultsPanel"] ?? "");
    if (!all.length) throw new Error("e-TAR naujausių teisės aktų paieška netikėtai grąžino 0 įrašų");
    log(`Puslapis 1/${pages} — nuo ${all[0]?.priemimoData ?? "?"}`);

    for (let page = 1; page < pages; page++) {
        const first = page * ROWS_PER_PAGE;
        const { text: pageXml, cookies: newJar } = await postAjax(searchForm.action, buildPageBody(viewState, first), jar);
        jar = newJar;
        const pageUpdates = extractFromPartialResponse(pageXml);
        viewState = pageUpdates["javax.faces.ViewState"] ?? viewState;
        const rows = parseResultsHtml(pageUpdates["contentForm:resultsTable"] ?? "");
        log(`Puslapis ${page + 1}/${pages} — nuo ${rows[0]?.priemimoData ?? "?"}`);
        all.push(...rows);
    }

    await upsertBatch(all, { forceRefresh: true });
    return all;
}

// Fetch all legal acts registered on a given day (yyyy-mm-dd) and upsert into DB
export async function scrapeDay(date) {
    const rows = await scrapeSearch(date);
    await upsertBatch(rows);
    await recordInterval({
        source: "etar", kind: "aktas", dateFrom: date, dateTo: date,
        sourceCount: rows.length, scrapedCount: rows.length, completedAt: new Date(),
    });
    log(`Įterptos/atnaujintos ${rows.length} eilutės (${date})`);
    return rows;
}

const MAX_PAGES_PER_BATCH = 100;

function previousDay(date) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}

function assertRowsWithinRange(rows, { from = "", to = "" }, context) {
    const outside = rows.find(row =>
        !row.priemimoData
        || (from && row.priemimoData < from)
        || (to && row.priemimoData > to));
    if (outside) {
        throw new Error(
            `e-TAR ignoravo datos filtrą (${context}): gauta ${outside.priemimoData ?? "be datos"}`
            + `${from ? `, nuo=${from}` : ""}${to ? `, iki=${to}` : ""}`,
        );
    }
}

// Enumerate all legal acts down to startDate. e-TAR currently ignores ascending
// sorting, so each 100-page batch uses an upper date bound and walks backwards.
// resumeFrom (yyyy-mm-dd) sets the initial upper bound so an interrupted run can
// pick up where it left off instead of re-walking from the newest record; pass
// the date from the last "tęsiama iki ..." log line.
export async function scrapeAllFrom(startDate, { resumeFrom = "" } = {}) {
    let totalInserted = 0;
    let untilDate = resumeFrom;
    let pageNr = 0;

    if (resumeFrom) log(`Tęsiama nuo ankstesnės sustojimo vietos: iki ${resumeFrom}`);

    while (true) {
        const seen = new Set();
        const { searchForm, cookies } = await getInitialPage();

        log(`Paieška iki ${untilDate || "naujausių"} (mažėjančia tvarka)`);
        let { text: searchXml, cookies: jar } = await postAjax(
            searchForm.action,
            buildSearchRangeBody(searchForm, { to: untilDate }),
            cookies,
        );
        const searchUpdates = extractFromPartialResponse(searchXml);
        let viewState = searchUpdates["javax.faces.ViewState"] ?? searchForm.viewState;
        const resultsHtml = searchUpdates["contentForm:resultsPanel"] ?? "";

        const rowCount = parseInt(resultsHtml.match(/rowCount:(\d+)/)?.[1] ?? "0", 10);
        const totalPages = rowCount > 0 ? Math.ceil(rowCount / ROWS_PER_PAGE) : 1;
        const batchPages = Math.min(totalPages, MAX_PAGES_PER_BATCH);

        const firstRows = parseResultsHtml(resultsHtml).filter(r => r.href && !seen.has(r.href) && (seen.add(r.href), true));
        if (!firstRows.length) {
            throw new Error(
                `e-TAR paieška iki ${untilDate || "naujausių"} netikėtai grąžino 0 įrašų `
                + `(rowCount=${rowCount}, resultsPanel=${resultsHtml.length} B); backfill nestabdomas kaip sėkmingas`,
            );
        }
        assertRowsWithinRange(firstRows, { to: untilDate }, "backfill pirmas puslapis");
        pageNr++;
        log(`Puslapis ${pageNr} — nuo ${firstRows[0]?.priemimoData ?? "?"} (${firstRows.length} įrašų)`);
        await upsertBatch(firstRows);
        totalInserted += firstRows.length;
        let lastDate = firstRows[firstRows.length - 1]?.priemimoData;

        for (let page = 1; page < batchPages; page++) {
            const first = page * ROWS_PER_PAGE;
            const { text: pageXml, cookies: newJar } = await postAjax(searchForm.action, buildPageBody(viewState, first), jar);
            jar = newJar;
            const pageUpdates = extractFromPartialResponse(pageXml);
            viewState = pageUpdates["javax.faces.ViewState"] ?? viewState;
            const rows = parseResultsHtml(pageUpdates["contentForm:resultsTable"] ?? "").filter(r => r.href && !seen.has(r.href) && (seen.add(r.href), true));
            assertRowsWithinRange(rows, { to: untilDate }, `backfill puslapis ${page + 1}`);
            pageNr++;
            log(`Puslapis ${pageNr} — nuo ${rows[0]?.priemimoData ?? "?"} (${rows.length} įrašų, iš viso ${totalInserted + rows.length})`);
            await upsertBatch(rows);
            totalInserted += rows.length;
            if (rows.length) lastDate = rows[rows.length - 1]?.priemimoData;
        }

        if (totalPages <= MAX_PAGES_PER_BATCH || !lastDate || lastDate < startDate) break;

        // The boundary day can be split by page 100. Fetching it again is
        // harmless (inventory upsert is idempotent) and prevents skipped acts.
        const boundaryRows = await scrapeSearch(lastDate);
        await upsertBatch(boundaryRows);
        totalInserted += boundaryRows.length;

        untilDate = previousDay(lastDate);
        if (untilDate < startDate) break;
        log(`Pasiekta 100 psl. riba — tęsiama iki ${untilDate}`);
    }

    return totalInserted;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const allFlag = args.includes("--all");
    const resumeFrom = args.find(a => a.startsWith("--resume-from="))?.split("=")[1] ?? "";
    const date = args.find(a => !a.startsWith("--"));
    if (allFlag) {
        const total = await scrapeAllFrom(date ?? "1800-01-01", { resumeFrom });
        console.error(`Scraped ${total} records total`);
    } else {
        const results = date ? await scrapeDay(date) : await scrapeLatest(3);
        console.log(JSON.stringify(results, null, 2));
        console.error(`Scraped ${results.length} records${date ? ` for ${date}` : ""}`);
    }
}

import { parseHTML } from "linkedom";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { postgres } from "../../postgres/postgres.js";
import {
    claimInventoryBatch,
    markInventoryFailure,
    markInventorySuccess,
    upsertInventoryObject,
} from "../teisekura/storage.js";
import { upsertTeisekuraDokumentas } from "../teisekura/upsertDokumentas.js";
import { actIdFromUrl, editionSourceIdFromUrl } from "./ids.js";

const ORIGIN = "https://www.e-tar.lt";
const DEFAULT_ACT_URL =
    "https://www.e-tar.lt/portal/lt/legalAct/87c9a6763e3e11f180c9c618618421ed?csrt=9660232170968111287";

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0",
    "Accept-Language": "en-US,en;q=0.9",
};

// Tomcat's legacy cookie parser accepts cookie pairs separated with ';'.
function appendCookies(jar, newSetCookie) {
    if (!newSetCookie) return jar;
    const pairs = newSetCookie
        .split(/,(?=[^ ])/)
        .map(cookie => cookie.split(";")[0].trim())
        .filter(Boolean);
    return jar ? `${jar}; ${pairs.join("; ")}` : pairs.join("; ");
}

function fullUrl(href, baseUrl = ORIGIN) {
    if (!href) return null;
    return href.startsWith("http") ? href : new URL(href, baseUrl).toString();
}

function collapseWhitespace(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
    return (value ?? "")
        .replace(/\r/g, "")
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
}

function visibleText(element) {
    const clone = element.cloneNode(true);
    for (const hidden of clone.querySelectorAll("script, style, noscript")) hidden.remove();
    return clone.innerText ?? clone.textContent ?? "";
}

function normalizeNone(value) {
    const normalized = collapseWhitespace(value);
    if (!normalized) return null;
    return /^n[eė]ra$/i.test(normalized) ? null : normalized;
}

function splitPipeList(value) {
    if (!value) return [];
    return value
        .split("|")
        .map(item => collapseWhitespace(item))
        .filter(Boolean);
}

function parseRegistravimoDuomenys(value) {
    const raw = collapseWhitespace(value);
    if (!raw) return null;
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+Nr\.\s*(.+)$/i);
    if (!match) {
        return {
            data: null,
            numeris: null,
            raw,
        };
    }

    return {
        data: match[1],
        numeris: collapseWhitespace(match[2]),
        raw,
    };
}

function parsePaskelbta(value) {
    const raw = collapseWhitespace(value);
    if (!raw) return null;
    const match = raw.match(/^([^,]+),\s*(\d{4}-\d{2}-\d{2}),\s*Nr\.\s*(.+)$/i);
    if (!match) {
        return {
            saltinis: null,
            data: null,
            numeris: null,
            raw,
        };
    }

    return {
        saltinis: collapseWhitespace(match[1]),
        data: match[2],
        numeris: collapseWhitespace(match[3]),
        raw,
    };
}

function parseChronologyLine(line) {
    const normalized = collapseWhitespace(line);
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (!match) {
        return {
            data: null,
            ivykis: normalized,
        };
    }

    return {
        data: match[1],
        ivykis: collapseWhitespace(match[2]),
    };
}

function extractDocumentId(actUrl, iframeUrl) {
    const fromAct = actIdFromUrl(actUrl);
    if (fromAct) return fromAct;
    return iframeUrl?.match(/\/rs\/legalact\/([^/?#]+)/i)?.[1] ?? null;
}

async function fetchHtml(url, cookies = "", referer = null) {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
            ...HEADERS,
            ...(referer ? { Referer: referer } : {}),
            ...(cookies ? { Cookie: cookies } : {}),
        },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const html = await res.text();
    const jar = appendCookies(cookies, res.headers.get("set-cookie"));

    return {
        html,
        cookies: jar,
        resolvedUrl: res.url,
    };
}

export function parseMetadata(document) {
    const rawMetadata = {};
    const table = document.querySelector("table.legalActHeaderTable");
    if (!table) return {};

    const rows = table.querySelectorAll("tr");
    for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll("td"));
        for (let i = 0; i < cells.length - 1; i++) {
            const rawLabel = collapseWhitespace(visibleText(cells[i]));
            if (!rawLabel.endsWith(":")) continue;

            const label = rawLabel.slice(0, -1).trim();
            const value = normalizeText(visibleText(cells[i + 1]))
                .replace(/\n+/g, " | ")
                .trim();
            if (label && value) rawMetadata[label] = value;
            i++;
        }
    }

    return {
        rusis: rawMetadata["Rūšis"] ?? null,
        priemimoData: rawMetadata["Priėmimo data"] ?? null,
        galiojantiSuvestineRedakcija: normalizeNone(rawMetadata["Galiojanti suvestinė redakcija"]),
        registravimoDuomenys: parseRegistravimoDuomenys(rawMetadata["Registravimo duomenys"]),
        istaigosSuteiktasNr: rawMetadata["Įstaigos suteiktas Nr."] ?? null,
        suvestiniuRedakcijuSarasasPagalData: normalizeNone(
            rawMetadata["Suvestinių redakcijų sąrašas pagal datą"],
        ),
        prieme: normalizeNone(rawMetadata["Priėmė"]),
        pakeitimuProjektai: normalizeNone(rawMetadata["Pakeitimų projektai"]),
        exPostVertinimas: normalizeNone(rawMetadata["Ex post vertinimas"]),
        paskelbta: parsePaskelbta(rawMetadata["Paskelbta"]),
        eurovocTerminai: splitPipeList(rawMetadata["Eurovoc terminai"]),
        rysysSuEsTeisesAktais: normalizeNone(rawMetadata["Ryšys su ES teisės aktais"]),
    };
}

function parseChronology(document) {
    const chronologyContainer = document.querySelector("#mainForm\\:j_id_3b");
    if (!chronologyContainer) return [];

    const lines = [];
    let currentLine = "";

    for (const node of chronologyContainer.childNodes) {
        const name = node.nodeName.toLowerCase();
        if (name === "br") {
            const value = collapseWhitespace(currentLine);
            if (value) lines.push(value);
            currentLine = "";
            continue;
        }

        const text = collapseWhitespace(node.textContent);
        if (text) currentLine += (currentLine ? " " : "") + text;
    }

    const tail = collapseWhitespace(currentLine);
    if (tail) lines.push(tail);

    return lines.map(parseChronologyLine).filter(item => item.ivykis);
}

function parseHeadingNode(li) {
    if (!li || li.nodeName.toLowerCase() !== "li") return null;

    const directChildren = Array.from(li.children);
    const contentSpan = directChildren.find(el => el.nodeName.toLowerCase() === "span");
    const link = contentSpan?.querySelector("a.strLink");
    const text = collapseWhitespace(link?.textContent);
    if (!text) return null;

    const childList = directChildren.find(el => el.nodeName.toLowerCase() === "ul");
    const children = childList
        ? Array.from(childList.children)
            .map(parseHeadingNode)
            .filter(Boolean)
        : [];

    return { text, children };
}

function parseHeadings(document) {
    const tree = document.querySelector("#mainForm\\:structureTree ul.ui-tree-container");
    if (!tree) return [];

    return Array.from(tree.children)
        .map(parseHeadingNode)
        .filter(Boolean);
}

function parseAttachmentName(li) {
    const parts = [];
    for (const node of li.childNodes) {
        const name = node.nodeName.toLowerCase();
        if (name === "br") break;
        if (name === "#text") {
            const value = collapseWhitespace(node.textContent);
            if (value) parts.push(value);
        }
    }
    const title = collapseWhitespace(parts.join(" "));
    return title || null;
}

function parseFileExtension(value) {
    if (!value) return null;
    const match = value.toLowerCase().match(/\.([a-z0-9]{1,10})$/i);
    return match ? match[1] : null;
}

function normalizeAttachmentFormat(rawFormat) {
    const raw = (rawFormat ?? "ORIGINAL").toUpperCase();
    if (raw === "ORIGINAL") return "original";
    if (raw.includes("PDF")) return "pdf";
    if (raw.includes("DOCX")) return "docx";
    if (raw.includes("ODT")) return "odt";
    if (raw.includes("XLSX")) return "xlsx";
    return raw.toLowerCase().replace(/^iso_/, "");
}

function parseAttachmentLinks(li, pageUrl) {
    return Array.from(li.querySelectorAll("a[href]")).map(a => {
        const href = a.getAttribute("href");
        const url = fullUrl(href, pageUrl);
        const rawFormat = href?.match(/\/format\/([^/]+)\//i)?.[1] ?? "ORIGINAL";
        return {
            formatas: normalizeAttachmentFormat(rawFormat),
            url,
        };
    }).filter(item => item.url);
}

function parseAttachments(document, pageUrl) {
    const headers = Array.from(document.querySelectorAll("#mainForm\\:accordionRight > h3"));
    const priedaiHeader = headers.find(h => /\bpriedai\b/i.test(collapseWhitespace(h.textContent)));
    if (!priedaiHeader) return [];

    const panel = priedaiHeader.nextElementSibling;
    if (!panel || panel.nodeName.toLowerCase() !== "div") return [];

    return Array.from(panel.querySelectorAll("li.ui-datalist-item")).map(li => {
        const pavadinimas = parseAttachmentName(li);
        const failai = parseAttachmentLinks(li, pageUrl);
        const original = failai.find(item => item.formatas === "original") ?? failai[0] ?? null;

        return {
            pavadinimas,
            extension: parseFileExtension(pavadinimas),
            url: original?.url ?? null,
            kitiFormatai: failai.filter(item => item.url !== original?.url),
        };
    });
}

function parseDownloads(document, pageUrl) {
    return {
        docx: fullUrl(
            document.querySelector("a[href*='/format/MSO2010_DOCX/']")?.getAttribute("href"),
            pageUrl,
        ),
        odt: fullUrl(
            document.querySelector("a[href*='/format/OO3_ODT/']")?.getAttribute("href"),
            pageUrl,
        ),
        print: fullUrl(document.querySelector("a.js-print-button")?.getAttribute("href"), pageUrl),
    };
}

function parseRelatedLinks(document, pageUrl) {
    return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
            title: collapseWhitespace(a.textContent) || null,
            url: fullUrl(a.getAttribute("href"), pageUrl),
        }))
        .filter((item) => item.url);
}

// Raw-source download links (PDF/DOCX/ODT/print) live under /rs/.../format/... — the
// "actualedition" segment in their path otherwise matches the /actualEdition/i edition
// filter below, so they would be registered as bogus redakcija objects.
function isDownloadLink(url) {
    return /\/rs\//i.test(url) || /\/format\//i.test(url);
}

// Print/export views (legalActPrint, legalActExport, ...) carry an "actualEditionId"
// query param, whose "actualEdition" substring matches the editions filter below. They
// are not editions, so they must be excluded or they get registered as bogus redakcija
// objects and surface in search.
function isViewLink(url) {
    return /legalAct(Print|Export|Pdf|Compare|Translation)/i.test(url);
}

function parseEditions(document, pageUrl, rootId) {
    const seen = new Set();
    return parseRelatedLinks(document, pageUrl)
        .filter((item) => /legalActEditions|editionId|actualEdition/i.test(item.url))
        .filter((item) => !isDownloadLink(item.url))
        .filter((item) => !isViewLink(item.url))
        .map((item) => {
            const id = editionSourceIdFromUrl(item.url, rootId);
            if (!id || seen.has(id)) return null;
            seen.add(id);
            return { sourceId: id, url: item.url, title: item.title };
        })
        .filter(Boolean);
}

export function parseActPage(html, pageUrl) {
    const { document } = parseHTML(html);
    const iframeHref = document.querySelector("#legalActFrame")?.getAttribute("src") ?? null;
    const iframeUrl = fullUrl(iframeHref, pageUrl);
    const documentId = extractDocumentId(pageUrl, iframeUrl);
    const relatedLinks = parseRelatedLinks(document, pageUrl);

    return {
        title: collapseWhitespace(document.querySelector("#mainForm\\:laTitle")?.textContent),
        metadata: parseMetadata(document),
        chronology: parseChronology(document),
        headings: parseHeadings(document),
        priedai: parseAttachments(document, pageUrl),
        downloads: parseDownloads(document, pageUrl),
        iframeUrl,
        editions: parseEditions(document, pageUrl, documentId),
        relatedActs: relatedLinks.filter((item) => /\/legalAct\//i.test(item.url)),
        relatedProjects: relatedLinks.filter((item) => /project|\/TAP\//i.test(item.url)),
    };
}

async function fetchOfficialText(iframeUrl, cookies, referer) {
    if (!iframeUrl) {
        return { iframeUrl: null, text: "", wordCount: 0, characterCount: 0 };
    }

    const { html } = await fetchHtml(iframeUrl, cookies, referer);
    const { document } = parseHTML(html);

    document.querySelectorAll("script, style, noscript").forEach(el => el.remove());

    const text = normalizeText(document.body?.innerText ?? "");
    const wordCount = text ? (text.match(/\S+/g) ?? []).length : 0;

    return {
        iframeUrl,
        text,
        wordCount,
        characterCount: text.length,
    };
}

export async function scrapeContent(actUrl) {
    const normalizedActUrl = fullUrl(actUrl || DEFAULT_ACT_URL);
    const page = await fetchHtml(normalizedActUrl);
    const parsed = parseActPage(page.html, page.resolvedUrl);
    const officialText = await fetchOfficialText(parsed.iframeUrl, page.cookies, page.resolvedUrl);

    return {
        url: normalizedActUrl,
        resolvedUrl: page.resolvedUrl,
        documentId: extractDocumentId(page.resolvedUrl, parsed.iframeUrl),
        title: parsed.title,
        metadata: parsed.metadata,
        chronology: parsed.chronology,
        headings: parsed.headings,
        priedai: parsed.priedai,
        downloads: parsed.downloads,
        editions: parsed.editions,
        relatedActs: parsed.relatedActs,
        relatedProjects: parsed.relatedProjects,
        content: officialText,
    };
}

export function buildDokumentas(aktas, scraped) {
    const metadata = {
        objectKind: aktas.kind === "redakcija" ? "redakcija" : "aktas",
        editionType: aktas.kind === "redakcija" ? "suvestine" : "originalas",
        rootActId: aktas.rootSourceId,
        editionId: aktas.kind === "redakcija" ? aktas.sourceId : null,
        ...scraped.metadata,
        chronologija: scraped.chronology,
        struktura: scraped.headings,
        priedai: scraped.priedai,
        atsisiuntimai: scraped.downloads,
        susijeAktai: scraped.relatedActs,
        susijeProjektai: scraped.relatedProjects,
    };
    return {
        source: "etar",
        sourceId: aktas.sourceId,
        rootSourceId: aktas.rootSourceId,
        parentSourceId: aktas.parentSourceId,
        type: "teisesAktas",
        domain: "e-tar.lt",
        host: "www.e-tar.lt",
        url: scraped.resolvedUrl || aktas.url,
        title: scraped.title,
        author: scraped.metadata.prieme,
        text: scraped.content.text,
        registracijosNr: scraped.metadata.registravimoDuomenys?.numeris ?? aktas.registracijosNr,
        createdAt: scraped.metadata.priemimoData,
        happenedAt: aktas.happenedAt ?? scraped.metadata.priemimoData,
        discoveredAt: aktas.discoveredAt,
        metadata,
    };
}

export const TURINIO_VERSIJA = 3;

async function scrapeOne(aktas) {
    logger.log(`Skaitomas e-TAR ${aktas.kind} ${aktas.sourceId}`);
    try {
        const scraped = await scrapeContent(aktas.url);
        for (const edition of scraped.editions) {
            await upsertInventoryObject({
                source: "etar",
                sourceId: edition.sourceId,
                rootSourceId: aktas.rootSourceId,
                parentSourceId: aktas.rootSourceId,
                kind: "redakcija",
                url: edition.url,
                pavadinimas: edition.title || aktas.pavadinimas,
            });
        }
        const result = await upsertTeisekuraDokumentas(buildDokumentas(aktas, scraped));
        await markInventorySuccess(aktas.id, {
            scrapeVersion: TURINIO_VERSIJA,
            contentHash: result.contentHash,
            md5: result.md5,
        });
        logger.log(`Nuskaitytas e-TAR ${aktas.kind} ${aktas.sourceId}: ${scraped.title ?? aktas.pavadinimas ?? "be pavadinimo"}`);
        return result;
    } catch (error) {
        await markInventoryFailure(aktas.id, error);
        logger.log(`Klaida nuskaitant e-TAR ${aktas.sourceId}: ${error.message}`);
        return null;
    }
}

export async function scrapeNextBatch(batchSize = 10) {
    logger.log(`Ieškoma iki ${batchSize} laukiančių e-TAR objektų`);
    const rows = await claimInventoryBatch("etar", ["aktas", "redakcija"], TURINIO_VERSIJA, batchSize);
    if (!rows.length) {
        logger.log("Visi teisės aktai nuskaityti.");
        return false;
    }
    logger.log(`Gauta ${rows.length} e-TAR objektų, pradedamas turinio nuskaitymas`);
    await Promise.all(rows.map(scrapeOne));
    logger.log(`Baigta e-TAR turinio partija: ${rows.length} objektų`);
    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    logger.log("Pradedamas e-TAR turinio nuskaitymas");
    while (await scrapeNextBatch()) {}
    logger.log("e-TAR turinio nuskaitymas baigtas");
    await postgres.end();
}

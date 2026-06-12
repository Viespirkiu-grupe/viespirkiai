import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import {
    claimInventoryBatch,
    markInventoryFailure,
    markInventorySuccess,
} from "../teisekura/storage.js";
import { upsertTeisekuraDokumentas } from "../teisekura/upsertDokumentas.js";
import { cleanEseimasUrl } from "./scrape.js";

export const TURINIO_VERSIJA = 2;

export function cleanEseimasText(value) {
    return (value ?? "")
        .replace(/\b(?:el\.\s*p\.|el\.\s*paštas|elektroninis\s+paštas)\s*:?\s*\[email protected\]\s*[,;]?\s*/gi, "")
        .replace(/\s*[,;]?\s*\[email protected\]\s*[,;]?\s*/gi, ", ")
        .replace(/\s+([,;:.])/g, "$1")
        .replace(/([,;])(?:\s*[;,])+/g, "$1")
        .replace(/,\s*([.!?])/g, "$1")
        .replace(/\s+/g, " ")
        .replace(/^[,;]\s*|[,;]\s*$/g, "")
        .trim();
}

function collapse(value) {
    return cleanEseimasText(value);
}

function normalizeText(value) {
    return (value ?? "").replace(/\r/g, "").split("\n")
        .map((line) => collapse(line)).filter(Boolean).join("\n");
}

function fullUrl(href, base) {
    return cleanEseimasUrl(href, base);
}

function parseLabeledValues(document) {
    const values = {};
    for (const row of document.querySelectorAll("tr")) {
        const cells = Array.from(row.querySelectorAll("td"));
        for (let i = 0; i < cells.length - 1; i++) {
            const label = collapse(cells[i].textContent).replace(/:$/, "");
            if (!label || label.length > 80) continue;
            const value = collapse(cells[i + 1].textContent);
            if (value) values[label] = value;
        }
    }
    return values;
}

export function parseProjectPage(html, pageUrl) {
    const { document } = parseHTML(html);
    const metadata = parseLabeledValues(document);
    const title = collapse(
        document.querySelector("[id$='laTitle'], [id$='title'], h1")?.textContent,
    );
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        title: collapse(a.textContent) || null,
        url: fullUrl(a.getAttribute("href"), pageUrl),
    })).filter((item) => item.url);
    const iframeUrl = fullUrl(document.querySelector("iframe[src]")?.getAttribute("src"), pageUrl);
    document.querySelectorAll("script, style, noscript, nav, header, footer").forEach((el) => el.remove());

    return {
        title,
        metadata,
        iframeUrl,
        links,
        fallbackText: normalizeText(document.body?.innerText),
    };
}

async function fetchText(url, referer) {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
            "Accept-Language": "lt-LT,lt;q=0.9,en;q=0.7",
            ...(referer ? { Referer: referer } : {}),
        },
    });
    if (!res.ok) throw new Error(`e-Seimas HTTP ${res.status} ${url}`);
    return { html: await res.text(), url: res.url };
}

export async function scrapeProjectContent(url) {
    const page = await fetchText(url);
    const parsed = parseProjectPage(page.html, page.url);
    let text = parsed.fallbackText;
    if (parsed.iframeUrl) {
        const content = await fetchText(parsed.iframeUrl, page.url);
        const { document } = parseHTML(content.html);
        document.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
        text = normalizeText(document.body?.innerText);
    }
    return { ...parsed, text, resolvedUrl: cleanEseimasUrl(page.url) };
}

function buildDokumentas(project, scraped) {
    const m = scraped.metadata;
    return {
        source: "eseimas",
        sourceId: project.sourceId,
        rootSourceId: project.rootSourceId,
        type: "teisesAktoProjektas",
        host: "e-seimas.lrs.lt",
        domain: "lrs.lt",
        url: scraped.resolvedUrl || project.url,
        title: scraped.title || project.pavadinimas,
        author: m["Parengė"] || m["Iniciatoriai"] || m["Pateikė"] || null,
        text: scraped.text,
        registracijosNr: project.registracijosNr,
        happenedAt: project.happenedAt,
        discoveredAt: project.discoveredAt,
        metadata: {
            objectKind: "projektas",
            projectId: project.sourceId,
            registracijosNumeris: project.registracijosNr,
            rusis: m["Rūšis"] || null,
            busena: m["Būsena"] || m["Statusas"] || null,
            registravimoData: project.happenedAt,
            parenge: m["Parengė"] || null,
            iniciatoriai: m["Iniciatoriai"] || null,
            pateike: m["Pateikė"] || null,
            dokumentuNuorodos: scraped.links,
            susijeEtarAktai: scraped.links.filter((item) => /e-tar\.lt/i.test(item.url)),
        },
    };
}

async function scrapeOne(project) {
    log(`Skaitomas e-Seimo projektas ${project.sourceId}`);
    try {
        const scraped = await scrapeProjectContent(project.url);
        const result = await upsertTeisekuraDokumentas(buildDokumentas(project, scraped));
        await markInventorySuccess(project.id, {
            scrapeVersion: TURINIO_VERSIJA,
            contentHash: result.contentHash,
            md5: result.md5,
        });
        log(`Nuskaitytas e-Seimo projektas ${project.sourceId}: ${scraped.title || project.pavadinimas || "be pavadinimo"}`);
    } catch (error) {
        await markInventoryFailure(project.id, error);
        log(`Klaida nuskaitant e-Seimo projektą ${project.sourceId}: ${error.message}`);
    }
}

export async function scrapeNextProjectBatch(batchSize = 10) {
    log(`Ieškoma iki ${batchSize} laukiančių e-Seimo projektų`);
    const rows = await claimInventoryBatch("eseimas", ["projektas"], TURINIO_VERSIJA, batchSize);
    if (!rows.length) {
        log("Visi e-Seimo projektai nuskaityti.");
        return false;
    }
    log(`Gauta ${rows.length} e-Seimo projektų, pradedamas turinio nuskaitymas`);
    // Ne daugiau 3 lygiagrečių užklausų į e-Seimą
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(3, rows.length) }, async () => {
            while (cursor < rows.length) {
                await scrapeOne(rows[cursor++]);
            }
        }),
    );
    log(`Baigta e-Seimo turinio partija: ${rows.length} projektų`);
    return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        log("Pradedamas e-Seimo projektų turinio nuskaitymas");
        while (await scrapeNextProjectBatch()) {}
        log("e-Seimo projektų turinio nuskaitymas baigtas");
    } finally {
        await postgres.end();
    }
}

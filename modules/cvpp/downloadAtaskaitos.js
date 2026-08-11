// Pereina per visas cvppAtaskaitos eilutes (kurioms dar neužpildytas
// "turinioMd5"), parsiunčia ataskaitos Details puslapį, minifina ir išsaugo į
//   modules/cvpp/ataskaitos/<pirkimoNumeris || pirkimoVykdytojas>/<ataskaitosNumeris>.html
// bei įrašo turinio MD5 į "turinioMd5" stulpelį.
//
// CSS iškeliamas į bendrą failą modules/cvpp/ataskaitos/styles.<hash>.css (visiems
// puslapiams vienodas -> dedublikuojasi pagal turinio hash'ą), o HTML'as jį referuoja
// per relative path (../styles.<hash>.css). Paveiksliukai (ir CSS url(...), ir <img>)
// bei kiti resursai lieka nuorodomis — tik perrašomi į absoliučius CVPP adresus.
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "downloadAtaskaitos" });
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";

const ORIGIN = "https://cvpp.eviesiejipirkimai.lt";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ataskaitos");

// CSS bundle'iai kartojasi kiekviename puslapyje — cache'inam.
const cssCache = new Map(); // stylesheet url -> absoliutintas+minifintas CSS
const writtenCss = new Set(); // jau įrašyti styles.<hash>.css failai

function sanitizeSegment(name) {
    return (
        String(name ?? "")
            .replace(/[\/\\]+/g, "-") // slash'ai negali būti kelyje
            .replace(/[<>:"|?*\x00-\x1f]/g, "") // Windows/POSIX nedraugiški simboliai
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180) || "nezinoma"
    );
}

// CSS url(...) reliatyvias nuorodas perrašo į absoliučius CVPP adresus (nieko
// neinlininam). baseUrl — CSS failo URL (reliatyvių kelių bazė).
function absolutizeCssUrls(css, baseUrl) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, raw) => {
        if (/^(data:|#|https?:|\/\/)/i.test(raw)) return m;
        try {
            return `url(${q}${new URL(raw, baseUrl).href}${q})`;
        } catch {
            return m;
        }
    });
}

// Lengvas CSS minify: nuimam komentarus ir suspaudžiam tarpus.
function minifyCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([{}:;,>~+])\s*/g, "$1")
        .replace(/;}/g, "}")
        .trim();
}

// Lengvas HTML minify: nuimam komentarus ir suspaudžiam tarpus TARP tag'ų.
// <pre>/<textarea>/<style>/<script> turinys nekeičiamas — laikinai pakeičiam
// NUL-baitais atskirtu žymekliu (jo tekste tikrai nebūna).
function minifyHtml(html) {
    const stash = [];
    const protectedHtml = html.replace(
        /<(pre|textarea|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
        (m) => `\x00${stash.push(m) - 1}\x00`,
    );
    const minified = protectedHtml
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, "") // HTML komentarai (paliekam IE conditional)
        .replace(/>\s+</g, "><") // tarpai tarp tag'ų
        .replace(/\s{2,}/g, " ")
        .trim();
    return minified.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
}

async function fetchCss(url) {
    if (cssCache.has(url)) return cssCache.get(url);
    let css = "";
    try {
        const r = await scrapeFetch(url);
        if (r.ok) css = await r.text();
    } catch {
        css = "";
    }
    const out = minifyCss(absolutizeCssUrls(css, url));
    cssCache.set(url, out);
    return out;
}

// Surenka visų stylesheet'ų CSS į vieną, įrašo į bendrą styles.<hash>.css failą
// (jei dar neįrašytas) ir grąžina failo pavadinimą.
async function ensureSharedCss(hrefs) {
    const parts = [];
    for (const href of hrefs) parts.push(await fetchCss(new URL(href, ORIGIN).href));
    const css = parts.join("\n");
    const hash = createHash("md5").update(css).digest("hex").slice(0, 12);
    const filename = `styles.${hash}.css`;

    if (!writtenCss.has(filename)) {
        await fs.mkdir(OUT_DIR, { recursive: true });
        await fs.writeFile(path.join(OUT_DIR, filename), css);
        writtenCss.add(filename);
    }
    return filename;
}

// Iš parsiųsto HTML padaro minifikuotą puslapį, referuojantį bendrą CSS failą per
// relative path; likę resursai (images, favicon) — absoliučios CVPP nuorodos.
async function buildStandalone(html) {
    const { document } = parseHTML(html);

    // Nuimam script'us — SSR turinys nepriklauso nuo JS, o išoriniai src offline
    // vis tiek neveiktų.
    document.querySelectorAll("script").forEach((s) => s.remove());

    // Surenkam stylesheet'us į bendrą failą, o link'us pakeičiam vienu relative.
    const styleLinks = [...document.querySelectorAll("link")].filter((l) =>
        (l.getAttribute("rel") || "").toLowerCase().includes("stylesheet"),
    );
    const styleHrefs = styleLinks.map((l) => l.getAttribute("href")).filter(Boolean);
    if (styleHrefs.length) {
        const filename = await ensureSharedCss(styleHrefs);
        const shared = document.createElement("link");
        shared.setAttribute("rel", "stylesheet");
        shared.setAttribute("href", `../${filename}`); // HTML yra OUT_DIR/<folder>/x.html
        styleLinks[0].replaceWith(shared);
        styleLinks.slice(1).forEach((l) => l.remove());
    }

    // Ne-stylesheet link'ai (favicon ir pan.) — tik absoliutinam.
    for (const link of [...document.querySelectorAll("link")]) {
        const rel = (link.getAttribute("rel") || "").toLowerCase();
        if (rel.includes("stylesheet")) continue;
        const href = link.getAttribute("href");
        if (href && !/^(data:|https?:|\/\/)/i.test(href)) {
            link.setAttribute("href", new URL(href, ORIGIN).href);
        }
    }

    // <img src> — tik absoliutinam
    for (const img of [...document.querySelectorAll("img")]) {
        const src = img.getAttribute("src");
        if (!src || /^(data:|https?:|\/\/)/i.test(src)) continue;
        img.setAttribute("src", new URL(src, ORIGIN).href);
    }

    return minifyHtml("<!DOCTYPE html>" + document.documentElement.outerHTML);
}

// Stabilus turinio MD5 — iš #notice (nepriklauso nuo kintančių bundle hash'ų).
function turinioMd5(html) {
    const { document } = parseHTML(html);
    const notice = document.querySelector("#notice");
    const content = notice ? notice.outerHTML : html;
    return createHash("md5").update(content).digest("hex");
}

// Parsiunčia validų ataskaitos HTML. CVPP kai kurioms ataskaitoms grąžina
// klaidos puslapį su HTTP 200 (be #notice) — tokį laikom nesėkme, kad
// neišsaugotume šiukšlių ir neužpildytume "turinioMd5". Praeinančioms klaidoms —
// keli bandymai su backoff.
async function fetchAtaskaitosHtml(url, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const r = await scrapeFetch(url);
            const html = await r.text();
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            // CVPP klaidos puslapis: HTTP 200, bet body yra JSON su "Server error
            // occured" (dažnai #protocol tab'e), o tikro turinio (#notice) nėra.
            if (/Server error occured/i.test(html))
                throw new Error("serverio klaida (Server error occured)");
            if (!html.includes('id="notice"'))
                throw new Error("serverio klaida (nėra #notice)");
            return html;
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
        }
    }
    throw new Error(`${lastErr.message} — ${url}`);
}

export async function downloadAtaskaita(row) {
    const url =
        row.link ||
        `${ORIGIN}/ReportsOrProtocol/Details/${row.ataskaitosNumeris}?formTypeId=${row.formTypeId ?? 1}`;

    let html;
    try {
        html = await fetchAtaskaitosHtml(url);
    } catch (err) {
        // Klaida (dažn. pastoviai lūžtanti CVPP ataskaita): pažymim "turinioMd5"
        // reikšme "-404", kad kitą kartą nebandytume iš naujo, ir tęsiam.
        await postgres.query(
            `UPDATE public."cvppAtaskaitos" SET "turinioMd5" = '-404' WHERE "ataskaitosNumeris" = $1`,
            [row.ataskaitosNumeris],
        );
        return { file: null, md5: "-404", error: err.message };
    }

    const md5 = turinioMd5(html);
    const standalone = await buildStandalone(html);

    const folder = sanitizeSegment(row.pirkimoNumeris || row.pirkimoVykdytojas);
    const dir = path.join(OUT_DIR, folder);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sanitizeSegment(row.ataskaitosNumeris)}.html`);
    await fs.writeFile(file, standalone);

    await postgres.query(
        `UPDATE public."cvppAtaskaitos" SET "turinioMd5" = $1 WHERE "ataskaitosNumeris" = $2`,
        [md5, row.ataskaitosNumeris],
    );

    return { file, md5 };
}

export async function downloadVisasAtaskaitas() {
    const { rows } = await postgres.query(
        `SELECT "ataskaitosNumeris", "link", "formTypeId", "pirkimoNumeris", "pirkimoVykdytojas"
         FROM public."cvppAtaskaitos"
         WHERE "turinioMd5" IS NULL
         ORDER BY "ataskaitosNumeris"`,
    );

    console.log(`Liko parsisiųsti: ${rows.length}`);
    let done = 0;
    let failed = 0;
    for (const [i, row] of rows.entries()) {
        const { file, error } = await downloadAtaskaita(row);
        if (error) {
            failed++;
            console.error(`[${i + 1}/${rows.length}] KLAIDA(-404) ${row.ataskaitosNumeris}: ${error}`);
        } else {
            done++;
            console.log(`[${i + 1}/${rows.length}] ${row.ataskaitosNumeris} -> ${path.relative(OUT_DIR, file)}`);
        }
    }
    console.log(`Baigta. Parsisiųsta: ${done}, klaidų(-404): ${failed}`);
    return { done, failed };
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    downloadVisasAtaskaitas()
        .then(async () => {
            await postgres.end();
        })
        .catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
}

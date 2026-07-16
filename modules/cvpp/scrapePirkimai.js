// CVPP pirkimų (PublicPurchase) detalės skreiperis.
// https://pirkimai.eviesiejipirkimai.lt/ctm/Supplier/PublicPurchase/{PID}?B=PPO
//
// PID (= pirkimoId) paimamas iš cvppViesiejiPirkimai — iš "dokumentaiLink"
// (…?PID=NNN) arba iš tiesioginio "link" (…/PublicPurchase/NNN). Vienam PID
// atitinka daug skelbimų, tad pirkimo lygio duomenys saugomi cvppPirkimai.
//
// Puslapis iš to paties PublicPurchase parsina:
//   • cvppPirkimai  — aprašymas, terminas, BVPŽ kodai, perkančioji org.,
//                     kontaktas, paketai (su dokumentų LID);
//   • cvppSkelbimai — „Paskelbti skelbimai" (#notices-table): kiekvienas
//                     ViewNotice/{id} skelbimas (tipas, išsiuntimo data).
//
// Būsena valdoma cvppPirkimai."nuskaitymas" (kaip scrapeNotice.js):
//   null -> dar nesuparsinta, >= 1 -> suparsinta ta versija, -1 -> klaida.
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const ORIGIN = "https://pirkimai.eviesiejipirkimai.lt";
// language_id=8 – lietuvių. Nustatoma sesijai (EUSSESSION cookie), kad puslapis
// grįžtų su lietuviškomis etiketėmis (pagal kurias parsinama).
const LANGUAGE_ID = 8;

// v2: pridėtas turinysHtml įrašymas (anksčiau trūko PIRKIMAS_COLUMNS sąraše),
// tad v1 eilutės perskaitomos iš naujo, kad užsipildytų turinysHtml.
// v3: pridėtas pirkimoNumeris (iš antraštės), tad eilutės perskaitomos iš naujo.
// v4: pridėtas failų (cvppFailai) nuskaitymas iš paketų dokumentų puslapių.
const NUSKAITYMO_VERSIJA = 4;
const KLAIDOS_BUSENA = -1;

// ─── HTTP sesija su lietuvių kalba ─────────────────────────────────────────────

let cookieHeader = null;

// Nustato sesijos kalbą į lietuvių ir įsimena EUSSESSION cookie tolimesnėms
// užklausoms. Iškviečiama vieną kartą prieš pirmą fetch'ą.
async function ensureLithuanianSession() {
    if (cookieHeader) return;

    const url =
        `${ORIGIN}/ssi/changelanguage.asp?language_id=${LANGUAGE_ID}` +
        `&page=/ctm/Supplier/PublicPurchase/0/0/0?returnUrl=&b=PPO`;

    let cookies = [];
    let next = url;
    // changelanguage nukreipia į save patį, kol EUSSESSION cookie įsitvirtina.
    for (let i = 0; i < 5; i++) {
        const res = await fetch(next, {
            redirect: "manual",
            headers: cookies.length
                ? { cookie: cookies.map((c) => c.split(";")[0]).join("; ") }
                : undefined,
        });
        const set =
            res.headers.getSetCookie?.() ??
            (res.headers.get("set-cookie")
                ? [res.headers.get("set-cookie")]
                : []);
        for (const c of set) cookies.push(c);
        const loc = res.headers.get("location");
        if (!loc || (res.status !== 301 && res.status !== 302)) break;
        next = loc.startsWith("http") ? loc : `${ORIGIN}${loc}`;
    }

    cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ") || null;
}

async function fetchPublicPurchase(pid) {
    await ensureLithuanianSession();
    const initialUrl = `${ORIGIN}/ctm/Supplier/PublicPurchase/${pid}?B=PPO`;
    const initialResponse = await fetch(initialUrl, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!initialResponse.ok) throw new Error(`HTTP ${initialResponse.status}`);

    const initialHtml = await initialResponse.text();
    const detailsUrl = findPublicPurchaseDetailsUrl(initialHtml, pid);
    if (!detailsUrl) return { url: initialUrl, html: initialHtml };

    const detailsResponse = await fetch(detailsUrl, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!detailsResponse.ok)
        throw new Error(`details HTTP ${detailsResponse.status}`);

    return { url: detailsUrl, html: await detailsResponse.text() };
}

// Paketo dokumentų sąrašo puslapis (atskiri failai su DVID).
async function fetchDocs(pid, lid) {
    await ensureLithuanianSession();
    const url =
        `${ORIGIN}/app/rfq/publicpurchase_docs.asp` +
        `?PID=${pid}&LID=${lid}&AllowPrint=1`;
    const res = await fetch(url, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!res.ok) throw new Error(`docs HTTP ${res.status} (LID=${lid})`);
    return await res.text();
}

// ─── Parsinimo pagalbininkai ───────────────────────────────────────────────────

const txt = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;

// Kai kuriems pirkimams bazinis PublicPurchase URL grąžina ne detales, o
// tarpinį puslapį su mygtuku į tikrąjį /{pid}/{step}/{package} puslapį.
// Priimame tik to paties pirkimo nuorodą iš CVP IS domeno.
export function findPublicPurchaseDetailsUrl(html, pid) {
    const { document } = parseHTML(html);
    if (document.querySelector("#tenderInfoSection")) return null;

    const href = document
        .querySelector("#showTenderDetails")
        ?.getAttribute("href")
        ?.trim();
    if (!href) return null;

    let url;
    try {
        url = new URL(href, ORIGIN);
    } catch {
        return null;
    }

    const expectedPath = new RegExp(
        `^/ctm/Supplier/PublicPurchase/${Number(pid)}/\\d+/\\d+/?$`,
    );
    if (url.origin !== ORIGIN || !expectedPath.test(url.pathname)) return null;

    return url.href;
}

function minifyHtml(html) {
    return String(html ?? "")
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
        .replace(/>\s+</g, "><")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// tenderInfoSection: pagal etiketę (.ctm-content-label) grąžina sekantį <p>.
function labelParagraph(section, labelSubstr) {
    for (const lbl of section.querySelectorAll(".ctm-content-label")) {
        if (!lbl.textContent.includes(labelSubstr)) continue;
        let n = lbl.nextElementSibling;
        while (n && n.tagName !== "P") n = n.nextElementSibling;
        return n || null;
    }
    return null;
}

// "2034-10-31 00:00:00" -> to jsonb/timestamp-tinkamas string arba null.
function parseTerminas(text) {
    const m = text?.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/);
    return m ? m[0].replace("T", " ") : null;
}

// <p> su <br> atskirtomis eilutėmis -> masyvas netusčių eilučių.
function brLines(p) {
    if (!p) return [];
    return (p.innerHTML || "")
        .split(/<br\s*\/?>/i)
        .map((chunk) => {
            const { document } = parseHTML(`<div>${chunk}</div>`);
            return txt(document.querySelector("div"));
        })
        .filter(Boolean);
}

function parseBvpz(section) {
    const p = labelParagraph(section, "BVP");
    if (!p) return [];
    return [...p.querySelectorAll("span.text-underline")]
        .map((span) => {
            const t = txt(span);
            if (!t) return null;
            const m = t.match(/^(\S+)\s+(.*)$/);
            return m
                ? { kodas: m[1], pavadinimas: m[2] }
                : { kodas: t, pavadinimas: null };
        })
        .filter(Boolean);
}

function parsePirkejas(section) {
    const p = labelParagraph(section, "Perkan");
    const result = {
        perkanciosiosOrganizacijosId: null,
        pirkejoPavadinimas: null,
        pirkejoAdresas: null,
        pirkejoPastoKodas: null,
        pirkejoMiestas: null,
        pirkejoSalis: null,
    };
    if (!p) return result;

    const idMatch = p
        .querySelector('a[href*="CompanyInformation/Index/"]')
        ?.getAttribute("href")
        ?.match(/CompanyInformation\/Index\/(\d+)/);
    if (idMatch) result.perkanciosiosOrganizacijosId = Number(idMatch[1]);

    // Eilutės (be „Peržiūrėti profilį" nuorodos): [pavadinimas, adresas, paštoKodas, miestas, šalis]
    const lines = brLines(p).filter((l) => !/Peržiūrėti profilį/i.test(l));
    [
        "pirkejoPavadinimas",
        "pirkejoAdresas",
        "pirkejoPastoKodas",
        "pirkejoMiestas",
        "pirkejoSalis",
    ].forEach((key, i) => {
        if (lines[i]) result[key] = lines[i];
    });
    return result;
}

function parseKontaktas(section) {
    const p = labelParagraph(section, "Kontakt");
    const result = {
        kontaktinisAsmuo: null,
        kontaktoSvetaine: null,
        kontaktoElPastas: null,
        kontaktoTelefonas: null,
    };
    if (!p) return result;

    result.kontaktoSvetaine =
        p.querySelector('a[href^="http"]')?.getAttribute("href")?.trim() || null;
    result.kontaktoElPastas =
        p
            .querySelector('a[href^="mailto:"]')
            ?.getAttribute("href")
            ?.replace(/^mailto:/i, "")
            .trim() || null;

    for (const line of brLines(p)) {
        if (/^https?:\/\//i.test(line)) continue;
        if (line.includes("@")) {
            if (!result.kontaktoElPastas) result.kontaktoElPastas = line;
            continue;
        }
        if (/^\+?[\d\s()-]{6,}$/.test(line)) {
            if (!result.kontaktoTelefonas) result.kontaktoTelefonas = line;
            continue;
        }
        if (!result.kontaktinisAsmuo) result.kontaktinisAsmuo = line;
    }
    return result;
}

function parsePaketai(document, pid) {
    const box = document.querySelector(`#stepPackages_${pid}`);
    if (!box) return [];
    return [...box.querySelectorAll(".package-container")].map((pk) => {
        const dokumentai = [...pk.querySelectorAll('a[href*="publicpurchase_docs.asp"]')]
            .map((a) => {
                const href = a.getAttribute("href") || "";
                const lid = href.match(/[?&]LID=(\d+)/)?.[1] || null;
                return {
                    lid: lid ? Number(lid) : null,
                    link: href.startsWith("/") ? `${ORIGIN}${href}` : href,
                };
            })
            // Vienas paketas turi po kelias identiškas nuorodas (print-hide/show) — dedupe pagal LID.
            .filter(
                (d, i, arr) =>
                    d.lid == null || arr.findIndex((x) => x.lid === d.lid) === i,
            );

        return {
            pavadinimas: txt(pk.querySelector(".package-title strong")),
            dokumentai,
        };
    });
}

// Iš paketo dokumentų puslapio (publicpurchase_docs.asp) išrenka atskirus failus.
// Failai atsisiunčiami per JS funkcijas Download*(dvid, name, lid[, cid]).
function parseFailai(html, pid, lid) {
    const { document } = parseHTML(html);
    const at = html.match(/strArchiveType\s*=\s*['"](\d+)['"]/)?.[1] || "3";

    const failai = [];
    for (const a of document.querySelectorAll('a[href^="javascript:Download"]')) {
        const m = (a.getAttribute("href") || "").match(/javascript:(\w+)\((.*)\)/);
        if (!m) continue;
        const fn = m[1];
        const args = m[2]
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
        const dvid = Number(args[0]);
        if (!dvid) continue;

        const viesas = fn === "DownloadPublicDocument";
        let atsisiuntimoLink = null;
        if (fn === "DownloadPublicDocument")
            atsisiuntimoLink = `${ORIGIN}/app/docmgmt/downloadPublicDocument.asp?FMT=5&AT=${at}&LID=${lid}&DVID=${dvid}`;
        else if (fn === "DownloadByPurchaseId")
            atsisiuntimoLink = `${ORIGIN}/app/docmgmt/downloadDocument.asp?FMT=1&AT=${at}&PID=${pid}&DVID=${dvid}`;
        else
            atsisiuntimoLink = `${ORIGIN}/app/docmgmt/downloadDocument.asp?FMT=1&AT=${at}&LID=${lid}&DVID=${dvid}`;

        const dydisText = txt(a.closest("tr")?.querySelector(".tblcellright"));
        const dydisKb = dydisText
            ? Number(dydisText.replace(/[^\d]/g, "")) || null
            : null;

        failai.push({
            dvid,
            pirkimoId: pid,
            lid,
            failoPavadinimas: txt(a),
            dydisKb,
            viesas,
            atsisiuntimoLink,
        });
    }
    return failai;
}

function parseSkelbimai(document, pid) {
    const table = document.querySelector("#notices-table");
    if (!table) return [];
    return [...table.querySelectorAll("tbody tr")]
        .map((tr) => {
            const tds = tr.querySelectorAll("td");
            const a = tds[0]?.querySelector("a");
            const href = a?.getAttribute("href") || "";
            const skelbimoId = Number(href.match(/ViewNotice\/(\d+)/)?.[1]);
            if (!skelbimoId) return null;

            const pavadinimas = txt(a);
            // Šaltinis užkoduotas pavadinimo priesagoje skliaustuose. Tik žinomi
            // žymenys; kiti skliaustai (pvz. „(Skelbti)") – ne šaltinis.
            const saltinis = /\(CVP\s*IS\)\s*$/i.test(pavadinimas || "")
                ? "CVP IS"
                : /\((?:e\.?\s*Formas|eForm)\)\s*$/i.test(pavadinimas || "")
                  ? "e. Formas"
                  : null;

            return {
                skelbimoId,
                pirkimoId: pid,
                pavadinimas,
                saltinis,
                link: href.startsWith("/") ? `${ORIGIN}${href}` : href,
                issiuntimoData: parseTerminas(txt(tds[1])),
                pastaba: txt(tds[2]),
            };
        })
        .filter(Boolean);
}

// Grąžina { pirkimas, skelbimai } arba null, jei tai ne PublicPurchase puslapis.
export function parsePublicPurchase(html, pid, url) {
    const { document } = parseHTML(html);
    const section = document.querySelector("#tenderInfoSection");
    if (!section) return null;

    const title = txt(document.querySelector("title"));
    // „Viešas pirkimas - …" / „Public rft - …" -> pavadinimas po pirmo „ - ".
    const pavadinimas = title?.includes(" - ")
        ? title.slice(title.indexOf(" - ") + 3).trim()
        : title;

    // Antraštėje numeris rašomas prieš pavadinimą: „716918 - Pavadinimas".
    // Ne visi pirkimai jį turi (tada h1 – vien pavadinimas).
    const pirkimoNumerisMatch = txt(
        document.querySelector("div.ctm-header-pane h1"),
    )?.match(/^(\d+)\s*-\s+/);
    const pirkimoNumeris = pirkimoNumerisMatch
        ? Number(pirkimoNumerisMatch[1])
        : null;

    const pirkimas = {
        pirkimoId: pid,
        pirkimoNumeris,
        pavadinimas: pavadinimas || null,
        link: url,
        aprasymas: txt(labelParagraph(section, "apra")),
        pasiulymoPateikimoTerminas: parseTerminas(
            txt(labelParagraph(section, "terminas")),
        ),
        bvpzKodai: parseBvpz(section),
        ...parsePirkejas(section),
        ...parseKontaktas(section),
        paketai: parsePaketai(document, pid),
        turinysHtml: minifyHtml(section.innerHTML),
    };

    return { pirkimas, skelbimai: parseSkelbimai(document, pid) };
}

// ─── DB ─────────────────────────────────────────────────────────────────────

const PIRKIMAS_COLUMNS = [
    "pirkimoId",
    "pirkimoNumeris",
    "pavadinimas",
    "link",
    "aprasymas",
    "pasiulymoPateikimoTerminas",
    "bvpzKodai",
    "perkanciosiosOrganizacijosId",
    "pirkejoPavadinimas",
    "pirkejoAdresas",
    "pirkejoPastoKodas",
    "pirkejoMiestas",
    "pirkejoSalis",
    "kontaktinisAsmuo",
    "kontaktoSvetaine",
    "kontaktoElPastas",
    "kontaktoTelefonas",
    "paketai",
    "turinysHtml",
];
const JSONB_COLUMNS = new Set(["bvpzKodai", "paketai"]);

const SKELBIMAS_COLUMNS = [
    "skelbimoId",
    "pirkimoId",
    "pavadinimas",
    "saltinis",
    "link",
    "issiuntimoData",
    "pastaba",
];

const FAILAS_COLUMNS = [
    "dvid",
    "pirkimoId",
    "lid",
    "failoPavadinimas",
    "dydisKb",
    "viesas",
    "atsisiuntimoLink",
];

// Iš cvppViesiejiPirkimai išrenka trūkstamus PID ir įterpia į cvppPirkimai
// (be turinio, nuskaitymas = null). Grąžina įterptų eilučių skaičių.
export async function seedPirkimai() {
    const { rowCount } = await postgres.query(`
        INSERT INTO public."cvppPirkimai" ("pirkimoId")
        SELECT DISTINCT pid::int
        FROM (
            SELECT COALESCE(
                substring("dokumentaiLink" from 'PID=(\\d+)'),
                substring("link" from '/PublicPurchase/(\\d+)')
            ) AS pid
            FROM public."cvppViesiejiPirkimai"
        ) s
        WHERE pid IS NOT NULL
        ON CONFLICT ("pirkimoId") DO NOTHING`);
    return rowCount ?? 0;
}

async function setStatus(pirkimoId, status) {
    await postgres.query(
        `UPDATE public."cvppPirkimai" SET nuskaitymas = $1 WHERE "pirkimoId" = $2`,
        [status, pirkimoId],
    );
}

async function issaugoti(pirkimas, skelbimai, failai) {
    const setSql = PIRKIMAS_COLUMNS.filter((c) => c !== "pirkimoId")
        .map((c, i) => `"${c}" = $${i + 1}`)
        .join(", ");
    const values = PIRKIMAS_COLUMNS.filter((c) => c !== "pirkimoId").map((c) =>
        JSONB_COLUMNS.has(c)
            ? pirkimas[c] == null
                ? null
                : JSON.stringify(pirkimas[c])
            : (pirkimas[c] ?? null),
    );
    values.push(NUSKAITYMO_VERSIJA, pirkimas.pirkimoId);

    await postgres.query(
        `UPDATE public."cvppPirkimai"
         SET ${setSql}, nuskaitymas = $${values.length - 1}
         WHERE "pirkimoId" = $${values.length}`,
        values,
    );

    await upsertSkelbimai(skelbimai);
    await upsertFailai(failai);
}

async function upsertFailai(failai) {
    const rows = (failai ?? []).filter((f) => f?.dvid);
    if (rows.length === 0) return;

    const placeholders = rows
        .map(
            (_, r) =>
                `(${FAILAS_COLUMNS.map(
                    (_, c) => `$${r * FAILAS_COLUMNS.length + c + 1}`,
                ).join(", ")})`,
        )
        .join(", ");
    const values = rows.flatMap((f) => FAILAS_COLUMNS.map((c) => f[c] ?? null));
    const updates = FAILAS_COLUMNS.filter((c) => c !== "dvid")
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ");

    await postgres.query(
        `INSERT INTO public."cvppFailai" (${FAILAS_COLUMNS.map(
            (c) => `"${c}"`,
        ).join(", ")})
         VALUES ${placeholders}
         ON CONFLICT ("dvid") DO UPDATE SET ${updates}`,
        values,
    );
}

async function upsertSkelbimai(skelbimai) {
    const rows = skelbimai.filter((s) => s?.skelbimoId);
    if (rows.length === 0) return;

    const placeholders = rows
        .map(
            (_, r) =>
                `(${SKELBIMAS_COLUMNS.map(
                    (_, c) => `$${r * SKELBIMAS_COLUMNS.length + c + 1}`,
                ).join(", ")})`,
        )
        .join(", ");
    const values = rows.flatMap((s) =>
        SKELBIMAS_COLUMNS.map((c) => s[c] ?? null),
    );
    const updates = SKELBIMAS_COLUMNS.filter((c) => c !== "skelbimoId")
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ");

    await postgres.query(
        `INSERT INTO public."cvppSkelbimai" (${SKELBIMAS_COLUMNS.map(
            (c) => `"${c}"`,
        ).join(", ")})
         VALUES ${placeholders}
         ON CONFLICT ("skelbimoId") DO UPDATE SET ${updates}`,
        values,
    );
}

// Kiekvienam pirkimo paketui (unikaliam LID) nuskaito dokumentų puslapį ir
// surenka atskirus failus. Grąžina visų paketų failų masyvą.
async function surinktiFailus(pirkimas) {
    const lids = [
        ...new Set(
            (pirkimas.paketai ?? [])
                .flatMap((p) => p.dokumentai ?? [])
                .map((d) => d.lid)
                .filter((lid) => lid != null),
        ),
    ];
    const failai = [];
    for (const lid of lids) {
        const html = await fetchDocs(pirkimas.pirkimoId, lid);
        failai.push(...parseFailai(html, pirkimas.pirkimoId, lid));
    }
    // Tas pats DVID gali pasikartoti tarp paketų — dedupe pagal DVID.
    return failai.filter((f, i, arr) => arr.findIndex((x) => x.dvid === f.dvid) === i);
}

// Paima vieną dar nesuparsintą (ar senesnės versijos / null) cvppPirkimai eilutę,
// nuskaito PublicPurchase puslapį, įrašo pirkimą + skelbimus + failus. Grąžina
// false, kai eilučių nebeliko.
export async function scrapeVienaPirkima() {
    const { rows } = await postgres.query(
        `SELECT "pirkimoId"
         FROM public."cvppPirkimai"
         WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL
         LIMIT 1`,
        [NUSKAITYMO_VERSIJA],
    );
    if (rows.length < 1) return false;

    const { pirkimoId } = rows[0];
    try {
        const { url, html } = await fetchPublicPurchase(pirkimoId);
        const parsed = parsePublicPurchase(html, pirkimoId, url);
        if (!parsed) throw new Error("nėra #tenderInfoSection");
        const failai = await surinktiFailus(parsed.pirkimas);
        await issaugoti(parsed.pirkimas, parsed.skelbimai, failai);
        logger.log(
            `[CVPP pirkimas] ${pirkimoId}: suparsinta (skelbimų=${parsed.skelbimai.length}, failų=${failai.length})`,
        );
        return true;
    } catch (err) {
        logger.log(`[CVPP pirkimas] ${pirkimoId}: klaida - ${err.message}`);
        try {
            await setStatus(pirkimoId, KLAIDOS_BUSENA);
        } catch (updateError) {
            logger.log(
                `[CVPP pirkimas] ${pirkimoId}: nepavyko pažymėti klaidos - ${updateError.message}`,
            );
        }
        return true;
    }
}

// CLI
//   Be argumentų: seed'ina PID iš cvppViesiejiPirkimai ir nuskaito visus pagal
//                 nuskaitymo būseną.
//   Dry run (be DB): node scrapePirkimai.js <PID>
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const arg = process.argv[2];

    if (arg) {
        // Dry run: nuskaito ir atspausdina vieną PID (į DB nerašo).
        fetchPublicPurchase(Number(arg))
            .then(async ({ url, html }) => {
                const parsed = parsePublicPurchase(html, Number(arg), url);
                const failai = parsed
                    ? await surinktiFailus(parsed.pirkimas)
                    : [];
                console.log(JSON.stringify({ ...parsed, failai }, null, 2));
            })
            .finally(() => postgres.end());
    } else {
        (async () => {
            const seeded = await seedPirkimai();
            logger.log(`[CVPP pirkimas] Seed'inta naujų PID: ${seeded}`);
            while (await scrapeVienaPirkima()) {}
            await postgres.end();
            logger.log("[CVPP pirkimas] Nuskaitymas baigtas");
        })().catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
    }
}

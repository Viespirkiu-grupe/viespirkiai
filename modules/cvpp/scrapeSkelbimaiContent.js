// CVPP skelbimo (ViewNotice) detalės skreiperis.
// https://pirkimai.eviesiejipirkimai.lt/ctm/Supplier/PublicTenders/ViewNotice/{skelbimoId}
//
// skelbimoId ir "link" gaunami iš cvppSkelbimai (užpildyti scrapePirkimai.js
// parseSkelbimai iš PublicPurchage #notices-table). Šis skreiperis eina per
// "nuskaitymas" eilę ir papildo eilutę detalės puslapio laukais.
//
// Puslapio bendra „Informacija" panelė (ctm wrapper) vienoda visiems skelbimų
// tipams; pats kūnas (span8) tipui specifinis, todėl laikomas "turinysHtml".
//
// Būsena valdoma cvppSkelbimai."nuskaitymas" (kaip scrapeNotice.js):
//   null -> dar nesuparsinta, >= 1 -> suparsinta ta versija, -1 -> klaida.
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "scrapeSkelbimaiContent" });
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const ORIGIN = "https://pirkimai.eviesiejipirkimai.lt";
// language_id=8 – lietuvių; nustatoma sesijai (EUSSESSION cookie), kad puslapis
// grįžtų su lietuviškomis etiketėmis (pagal kurias parsinama).
const LANGUAGE_ID = 8;

const NUSKAITYMO_VERSIJA = 1;
const KLAIDOS_BUSENA = -1;

const CONTENT_COLUMNS = [
    "skelbimoTipas",
    "busena",
    "issiuntimoData",
    "galiojimoData",
    "isorineNuoroda",
    "isorineNuorodaLink",
    "perkanciosiosOrganizacijosId",
    "turinysHtml",
];

// ─── HTTP sesija su lietuvių kalba ─────────────────────────────────────────────

let cookieHeader = null;

// Nustato sesijos kalbą į lietuvių ir įsimena EUSSESSION cookie tolimesnėms
// užklausoms. Iškviečiama vieną kartą prieš pirmą fetch'ą.
async function ensureLithuanianSession() {
    if (cookieHeader) return;

    const url =
        `${ORIGIN}/ssi/changelanguage.asp?language_id=${LANGUAGE_ID}` +
        `&page=/ctm/Supplier/PublicTenders/ViewNotice/0`;

    let cookies = [];
    let next = url;
    for (let i = 0; i < 5; i++) {
        const res = await scrapeFetch(next, {
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

function viewNoticeUrl(skelbimoId) {
    return `${ORIGIN}/ctm/Supplier/PublicTenders/ViewNotice/${skelbimoId}`;
}

async function fetchViewNotice(skelbimoId, link) {
    await ensureLithuanianSession();
    const url = link || viewNoticeUrl(skelbimoId);
    const res = await scrapeFetch(url, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url, html: await res.text() };
}

// ─── Parsinimo pagalbininkai ───────────────────────────────────────────────────

const txt = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;

function minifyHtml(html) {
    return String(html ?? "")
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
        .replace(/>\s+</g, "><")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// "2023-09-25" ar "2023-09-25 10:00" -> timestamp-tinkamas string arba null.
function parseData(text) {
    const m = text?.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/);
    return m ? m[0].replace("T", " ") : null;
}

// „Informacija" panelė: pagal <strong> etiketę grąžina likusį <p> tekstą.
function infoValue(panel, labelSubstr) {
    for (const p of panel.querySelectorAll("p")) {
        const strong = p.querySelector("strong");
        if (!strong || !strong.textContent.includes(labelSubstr)) continue;
        const clone = p.cloneNode(true);
        clone.querySelector("strong")?.remove();
        return { text: txt(clone), p };
    }
    return { text: null, p: null };
}

// Grąžina { pirkimoInfo, turinys } arba null, jei tai ne ViewNotice puslapis.
export function parseViewNotice(html) {
    const { document } = parseHTML(html);

    // „Informacija" panelė (kairė span4) – bendra visiems tipams.
    const infoPanel = [...document.querySelectorAll(".container-default")].find(
        (c) => txt(c.querySelector(".header h2")) === "Informacija",
    );
    if (!infoPanel) return null;

    const skelbimoTipas = txt(document.querySelector(".ctm-header-pane h1"));
    const busena = txt(infoPanel.querySelector(".content .label"));

    const issiuntimoData = parseData(
        infoValue(infoPanel, "Pranešimo išsiuntimo data").text,
    );
    const galiojimoData = parseData(infoValue(infoPanel, "Galiojimo data").text);

    const { text: isorineNuoroda, p: isorineP } = infoValue(
        infoPanel,
        "Išorinė nuoroda",
    );
    const isorineNuorodaLink =
        isorineP?.querySelector("a")?.getAttribute("href")?.trim() || null;

    // Skelbimo kūnas (dešinė span8) – tipui specifinis; laikom kaip HTML.
    const bodyPanel = [...document.querySelectorAll(".container-default")].find(
        (c) => c !== infoPanel && c.querySelector(".content"),
    );
    const turinysHtml = bodyPanel
        ? minifyHtml(bodyPanel.querySelector(".content").innerHTML)
        : null;

    // Perkančiosios organizacijos id iš bet kurios CompanyInformation nuorodos kūne.
    const perkOrgId = (bodyPanel || document)
        .querySelector('a[href*="CompanyInformation/Index/"]')
        ?.getAttribute("href")
        ?.match(/CompanyInformation\/Index\/(\d+)/)?.[1];

    return {
        skelbimoTipas,
        busena,
        issiuntimoData,
        galiojimoData,
        isorineNuoroda,
        isorineNuorodaLink,
        perkanciosiosOrganizacijosId: perkOrgId ? Number(perkOrgId) : null,
        turinysHtml,
    };
}

// ─── DB ─────────────────────────────────────────────────────────────────────

async function setStatus(skelbimoId, status) {
    await postgres.query(
        `UPDATE "cvppSkelbimai" SET nuskaitymas = $1 WHERE "skelbimoId" = $2;`,
        [status, skelbimoId],
    );
}

async function issaugotiTuriny(skelbimoId, content) {
    const setSql = CONTENT_COLUMNS.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    const values = CONTENT_COLUMNS.map((c) => content[c] ?? null);
    values.push(NUSKAITYMO_VERSIJA, skelbimoId);

    await postgres.query(
        `UPDATE "cvppSkelbimai"
         SET ${setSql}, nuskaitymas = $${CONTENT_COLUMNS.length + 1}
         WHERE "skelbimoId" = $${CONTENT_COLUMNS.length + 2}`,
        values,
    );
}

// Paima vieną dar nesuparsintą (ar senesnės versijos / null) cvppSkelbimai eilutę,
// nuskaito ViewNotice puslapį, papildo eilutę. Grąžina false, kai eilučių nebeliko.
export async function scrapeVienaSkelbima() {
    const tSelect = performance.now();
    const { rows } = await postgres.query(
        `SELECT "skelbimoId", "link"
         FROM "cvppSkelbimai"
         WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL
         LIMIT 1;`,
        [NUSKAITYMO_VERSIJA],
    );
    const selectMs = performance.now() - tSelect;
    if (rows.length < 1) return false;

    const { skelbimoId, link } = rows[0];
    try {
        const tFetch = performance.now();
        const { html } = await fetchViewNotice(skelbimoId, link);
        const fetchMs = performance.now() - tFetch;

        const tParse = performance.now();
        const content = parseViewNotice(html);
        if (!content) throw new Error("nėra „Informacija“ panelės");
        const parseMs = performance.now() - tParse;

        const tUpdate = performance.now();
        await issaugotiTuriny(skelbimoId, content);
        const updateMs = performance.now() - tUpdate;

        logger.log(
            `[CVPP skelbimas] ${skelbimoId}: suparsinta ` +
                `(select=${selectMs.toFixed(0)}ms fetch=${fetchMs.toFixed(0)}ms ` +
                `parse=${parseMs.toFixed(0)}ms update=${updateMs.toFixed(0)}ms)`,
        );
        return true;
    } catch (err) {
        logger.log(`[CVPP skelbimas] ${skelbimoId}: klaida - ${err.message}`);
        try {
            await setStatus(skelbimoId, KLAIDOS_BUSENA);
        } catch (updateError) {
            logger.log(
                `[CVPP skelbimas] ${skelbimoId}: nepavyko pažymėti klaidos - ${updateError.message}`,
            );
        }
        return true;
    }
}

// CLI
//   Be argumentų: nuskaito visus pagal nuskaitymo būseną.
//   Dry run (be DB): node scrapeSkelbimaiContent.js <skelbimoId>
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const arg = process.argv[2];

    if (arg) {
        fetchViewNotice(Number(arg))
            .then(({ html }) => {
                console.log(JSON.stringify(parseViewNotice(html), null, 2));
            })
            .finally(() => postgres.end());
    } else {
        (async () => {
            while (await scrapeVienaSkelbima()) {}
            await postgres.end();
            logger.log("[CVPP skelbimas] Nuskaitymas baigtas");
        })().catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
    }
}

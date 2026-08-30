// CVPP perkančiųjų organizacijų / pirkėjų profilių skreiperis.
// https://pirkimai.eviesiejipirkimai.lt/ctm/Company/CompanyInformation/Index/{organizacijosId}
//
// organizacijosId = "perkanciosiosOrganizacijosId" kitose cvpp lentelėse.
// Seed'inama iš jų DISTINCT id (seedOrganizacijos). Traukiama tik „Organizacijos
// informacija" blokas – mygtukas „Informacija apie organizaciją" nesekamas.
//
// Būsena valdoma "nuskaitymas" (kaip scrapeNotice.js):
//   null -> dar ne, >= 1 -> versija, -1 -> klaida.
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "scrapeOrganizacijos" });
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const ORIGIN = "https://pirkimai.eviesiejipirkimai.lt";
const LANGUAGE_ID = 8; // lietuvių
// v2: „Prieiga nesuteikta" puslapiai žymimi "prieigaNesuteikta" stulpeliu, o
// eilutė laikoma apdorota (nebe klaida -1).
const NUSKAITYMO_VERSIJA = 2;
const KLAIDOS_BUSENA = -1;

const JSONB_COLUMNS = new Set(["isorinesNuorodos"]);
const CONTENT_COLUMNS = [
    "pavadinimas",
    "imonesKodas",
    "tipas",
    "skyrius",
    "adresas",
    "pastoKodas",
    "miestas",
    "salis",
    "kontaktinisAsmuo",
    "elPastas",
    "telefonas",
    "isorinesNuorodos",
    "skunduIstaiga",
    "skunduAdresas",
    "skunduPastoKodas",
    "skunduMiestas",
    "skunduSalis",
    "skunduTelefonas",
    "skunduElPastas",
    "skunduSvetaine",
    "tarpininkavimoIstaiga",
    "turinysHtml",
];

// ─── HTTP sesija su lietuvių kalba ─────────────────────────────────────────────

let cookieHeader = null;

async function ensureLithuanianSession() {
    if (cookieHeader) return;
    const url =
        `${ORIGIN}/ssi/changelanguage.asp?language_id=${LANGUAGE_ID}` +
        `&page=/ctm/Company/CompanyInformation/Index/0`;

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

async function fetchCompany(organizacijosId) {
    await ensureLithuanianSession();
    const url = `${ORIGIN}/ctm/Company/CompanyInformation/Index/${organizacijosId}`;
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

// <div class="span12"><i>Etiketė: </i>reikšmė</div> -> reikšmė (be etiketės).
function valueAfterItalic(container, labelSubstr) {
    for (const div of container.querySelectorAll(".span12")) {
        const i = div.querySelector("i");
        if (!i || !i.textContent.includes(labelSubstr)) continue;
        const clone = div.cloneNode(true);
        clone.querySelector("i")?.remove();
        return txt(clone);
    }
    return null;
}

// <address> su <br> atskirtomis eilutėmis -> masyvas netusčių eilučių.
function addressLines(addressEl) {
    if (!addressEl) return [];
    return (addressEl.innerHTML || "")
        .split(/<br\s*\/?>/i)
        .map((chunk) => {
            const { document } = parseHTML(`<div>${chunk}</div>`);
            return txt(document.querySelector("div"));
        })
        .filter(Boolean);
}

// dl.dl-horizontal -> { dt tekstas: dd tekstas }.
function parseDl(dl) {
    const map = {};
    if (!dl) return map;
    const dts = [...dl.querySelectorAll("dt")];
    const dds = [...dl.querySelectorAll("dd")];
    dts.forEach((dt, i) => {
        const key = txt(dt);
        if (key) map[key] = txt(dds[i]);
    });
    return map;
}

// Grąžina org. laukų objektą arba null, jei tai ne organizacijos puslapis.
export function parseCompany(html) {
    const { document } = parseHTML(html);

    const infoBlock = [...document.querySelectorAll(".container-default")].find(
        (c) => txt(c.querySelector(".header h2")) === "Organizacijos informacija",
    );
    if (!infoBlock) return null;

    const span4s = [...infoBlock.querySelectorAll(".content > .row-fluid > .span4")];
    const infoCol =
        span4s.find((c) =>
            /Pavadinimas ir apra/i.test(txt(c.querySelector(".element-title")) || ""),
        ) || span4s[0];
    const contactCol =
        span4s.find((c) =>
            /Kontaktin/i.test(txt(c.querySelector(".element-title")) || ""),
        ) || span4s[1];

    // ── Pavadinimas ir aprašymas ──
    // Pirmas .span12 be <i> vaiko – pavadinimas; pre-line .span12 – tipas.
    let pavadinimas = null;
    let tipas = null;
    for (const div of infoCol?.querySelectorAll(".span12") ?? []) {
        if (div.querySelector("i")) continue;
        const t = txt(div);
        if (!t) continue;
        if (!pavadinimas) pavadinimas = t;
        else if (/pre-line/.test(div.getAttribute("style") || "")) tipas = t;
    }
    const skyrius = valueAfterItalic(infoCol, "Skyrius");
    const imonesKodas = valueAfterItalic(infoCol, "Įmonės kodas");

    // ── Kontaktinė informacija ──
    const [adresas, pastoKodas, miestas, salis] = addressLines(
        contactCol?.querySelector("address"),
    );
    const kontaktinisAsmuo = txt(
        contactCol?.querySelector(".span12 i.icon-user")?.parentElement,
    );
    const elPastas =
        contactCol
            ?.querySelector('a[href^="mailto:"]')
            ?.getAttribute("href")
            ?.replace(/^mailto:/i, "")
            .trim() || null;
    const telefonas = txt(contactCol?.querySelector('abbr[title="Telefonas"]'));

    // ── Išorinės nuorodos (gali būti kelios) ──
    const isorinesBlock = [...infoBlock.querySelectorAll("h4")].find((h) =>
        /Išorinės nuorodos/i.test(h.textContent),
    )?.parentElement;
    const isorinesNuorodos = isorinesBlock
        ? [
              ...new Set(
                  [...isorinesBlock.querySelectorAll('a[href^="http"]')]
                      .map((a) => a.getAttribute("href")?.trim())
                      .filter(Boolean),
              ),
          ]
        : [];

    // ── Skundų pateikimo procedūra + tarpininkavimas ──
    const appealHeader = [...infoBlock.querySelectorAll("h4")].find((h) =>
        /Skundų pateikimo procedūra/i.test(h.textContent),
    );
    const appealRow = appealHeader?.parentElement;
    const dls = appealRow ? [...appealRow.querySelectorAll("dl")] : [];
    const skundai = parseDl(dls[0]);
    const tarpininkavimas = parseDl(dls[1]);
    const [skPasto, skMiestas] = (skundai["Pašto kodas, Miestas"] || "")
        .split(",")
        .map((s) => s.trim());

    return {
        pavadinimas,
        imonesKodas,
        tipas,
        skyrius,
        adresas: adresas ?? null,
        pastoKodas: pastoKodas ?? null,
        miestas: miestas ?? null,
        salis: salis ?? null,
        kontaktinisAsmuo,
        elPastas,
        telefonas,
        isorinesNuorodos,
        skunduIstaiga: skundai["Organizacijos pavadinimas"] ?? null,
        skunduAdresas: skundai["Gatvės pavadinimas"] ?? null,
        skunduPastoKodas: skPasto || null,
        skunduMiestas: skMiestas || null,
        skunduSalis: skundai["Šalis"] ?? null,
        skunduTelefonas: skundai["Telefonas"] ?? null,
        skunduElPastas: skundai["El. paštas"] ?? null,
        skunduSvetaine: skundai["Internetinis adresas (URL)"] ?? null,
        tarpininkavimoIstaiga: tarpininkavimas["Organizacijos pavadinimas"] ?? null,
        turinysHtml: minifyHtml(infoBlock.innerHTML),
    };
}

// ─── DB ─────────────────────────────────────────────────────────────────────

// Iš cvpp lentelių išrenka trūkstamus perkanciosiosOrganizacijosId ir įterpia
// į cvpp."organizacijos" (be turinio). Grąžina įterptų eilučių skaičių.
export async function seedOrganizacijos() {
    const { rowCount } = await postgres.query(`
        INSERT INTO cvpp."organizacijos" ("organizacijosId")
        SELECT DISTINCT id FROM (
            SELECT "perkanciosiosOrganizacijosId" AS id FROM cvpp."archyvoSkelbimai"
            UNION SELECT "perkanciosiosOrganizacijosId" FROM cvpp."pirkimai"
            UNION SELECT "perkanciosiosOrganizacijosId" FROM cvpp."planuojamiPirkimai"
            UNION SELECT "perkanciosiosOrganizacijosId" FROM cvpp."skelbimai"
        ) s
        WHERE id IS NOT NULL
        ON CONFLICT ("organizacijosId") DO NOTHING`);
    return rowCount ?? 0;
}

async function setStatus(organizacijosId, status) {
    await postgres.query(
        `UPDATE cvpp."organizacijos" SET nuskaitymas = $1 WHERE "organizacijosId" = $2;`,
        [status, organizacijosId],
    );
}

async function issaugoti(organizacijosId, content) {
    const setSql = CONTENT_COLUMNS.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    const values = CONTENT_COLUMNS.map((c) =>
        JSONB_COLUMNS.has(c)
            ? content[c] == null
                ? null
                : JSON.stringify(content[c])
            : (content[c] ?? null),
    );
    values.push(NUSKAITYMO_VERSIJA, organizacijosId);

    await postgres.query(
        `UPDATE cvpp."organizacijos"
         SET ${setSql}, nuskaitymas = $${CONTENT_COLUMNS.length + 1}
         WHERE "organizacijosId" = $${CONTENT_COLUMNS.length + 2}`,
        values,
    );
}

export async function scrapeVienaOrganizacija() {
    const { rows } = await postgres.query(
        `SELECT "organizacijosId"
         FROM cvpp."organizacijos"
         WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL
         LIMIT 1;`,
        [NUSKAITYMO_VERSIJA],
    );
    if (rows.length < 1) return false;

    const { organizacijosId } = rows[0];
    try {
        const { html } = await fetchCompany(organizacijosId);

        // Neviešas profilis: „Prieiga nesuteikta" – ne klaida. Pažymim atskiru
        // stulpeliu, o eilutę laikom apdorota (nuskaitymas = versija).
        if (/Prieiga nesuteikta|neturite teisės peržiūrėti/i.test(html)) {
            await postgres.query(
                `UPDATE cvpp."organizacijos"
                 SET "prieigaNesuteikta" = true, nuskaitymas = $1
                 WHERE "organizacijosId" = $2;`,
                [NUSKAITYMO_VERSIJA, organizacijosId],
            );
            logger.log(`[CVPP organizacija] ${organizacijosId}: prieiga nesuteikta`);
            return true;
        }

        const content = parseCompany(html);
        if (!content) throw new Error("nėra „Organizacijos informacija“ bloko");
        await issaugoti(organizacijosId, content);
        logger.log(`[CVPP organizacija] ${organizacijosId}: suparsinta`);
        return true;
    } catch (err) {
        logger.log(`[CVPP organizacija] ${organizacijosId}: klaida - ${err.message}`);
        try {
            await setStatus(organizacijosId, KLAIDOS_BUSENA);
        } catch (updateError) {
            logger.log(
                `[CVPP organizacija] ${organizacijosId}: nepavyko pažymėti klaidos - ${updateError.message}`,
            );
        }
        return true;
    }
}

// CLI
//   Be argumentų: seed'ina id iš cvpp lentelių ir nuskaito pagal būseną.
//   Dry run (be DB): node scrapeOrganizacijos.js <organizacijosId>
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const arg = process.argv[2];

    if (arg) {
        fetchCompany(Number(arg))
            .then(({ html }) => {
                console.log(JSON.stringify(parseCompany(html), null, 2));
            })
            .finally(() => postgres.end());
    } else {
        (async () => {
            const seeded = await seedOrganizacijos();
            logger.log(`[CVPP organizacija] Seed'inta naujų id: ${seeded}`);
            while (await scrapeVienaOrganizacija()) {}
            await postgres.end();
            logger.log("[CVPP organizacija] Nuskaitymas baigtas");
        })().catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
    }
}

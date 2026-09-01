// Planuojamų pirkimų detalės puslapio skreiperis.
// https://cvpp.eviesiejipirkimai.lt/PlannedProcurement/Details/{id}?type={tipoId}
// Būsena valdoma "nuskaitymas" stulpeliu (kaip scrapeNotice.js):
//   null  -> dar nenuskaityta,
//   >= 1  -> nuskaityta ta versija,
//   -1    -> klaida.
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "scrapePlanuojamiPirkimaiContent" });
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const NUSKAITYMO_VERSIJA = 1;
const KLAIDOS_BUSENA = -1;

// Detalės laukų DB stulpeliai (be "nuskaitymas", jis nustatomas atskirai).
const CONTENT_COLUMNS = [
    "metai",
    "pirkimoPavadinimas",
    "pirkimoTipas",
    "rusis",
    "bvpzKodas",
    "bvpzPavadinimas",
    "planuojamaApimtis",
    "matavimoVienetas",
    "planuojamaVerte",
    "numatomasTerminas",
    "arVidausSandoris",
    "arCpoKatalogas",
    "arRezervuotas",
    "pirkimoBudas",
    "pastabos",
];

function parseSkaicius(text) {
    if (text == null) return null;
    // Lietuviškas formatas: "." – tūkstančiai, "," – dešimtainis skyriklis.
    const cleaned = text
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function parseSveikas(text) {
    const n = parseSkaicius(text);
    return n == null ? null : Math.trunc(n);
}

function parseBoolean(text) {
    if (text == null) return null;
    const t = text.toLowerCase();
    if (t === "taip") return true;
    if (t === "ne") return false;
    return null;
}

// Iš detalės lentelės sudaro { label: reikšmė } žemėlapį.
function parseLaukai(document) {
    const table = document.querySelector("table.eps-text");
    if (!table) return {};

    const map = {};
    for (const tr of table.querySelectorAll(":scope > tr")) {
        const tds = tr.querySelectorAll(":scope > td");
        const label = tds[0]
            ?.querySelector("dt")
            ?.textContent.replace(/\s+/g, " ")
            .trim();
        if (!label) continue;
        map[label] = tds[1]?.textContent.replace(/\s+/g, " ").trim() || null;
    }
    return map;
}

function isTraukiLaukus(document) {
    const laukai = parseLaukai(document);

    // "39710000-2 Buitiniai elektros prietaisai" -> kodas + pavadinimas
    const bvpz = laukai["BVPŽ kodas"] || null;
    const bvpzMatch = bvpz?.match(/^(\S+)\s+(.*)$/);

    return {
        metai: parseSveikas(laukai["Metai"]),
        pirkimoPavadinimas: laukai["Pirkimo pavadinimas"] ?? null,
        pirkimoTipas: laukai["Pirkimo tipas"] ?? null,
        rusis: laukai["Rūšis"] ?? null,
        bvpzKodas: bvpzMatch ? bvpzMatch[1] : bvpz,
        bvpzPavadinimas: bvpzMatch ? bvpzMatch[2] : null,
        planuojamaApimtis: parseSkaicius(laukai["Planuojama apimtis"]),
        matavimoVienetas: laukai["Matavimo vienetas"] ?? null,
        planuojamaVerte: parseSkaicius(laukai["Planuojama vertė (Eur be PVM)"]),
        numatomasTerminas: parseSveikas(
            laukai[
                "Numatoma prekių tiekimo, paslaugų teikimo ar darbų atlikimo terminas"
            ],
        ),
        arVidausSandoris: parseBoolean(
            laukai["Ar bus sudaromas vidaus sandoris?"],
        ),
        arCpoKatalogas: parseBoolean(
            laukai["Ar Pirkimas bus atliekamas naudojantis CPO katalogu?"],
        ),
        arRezervuotas: parseBoolean(laukai["Ar pirkimas bus rezervuotas?"]),
        pirkimoBudas: laukai["Pirkimo būdo (procedūros) pavadinimas"] ?? null,
        pastabos: laukai["Pastabos"] ?? null,
    };
}

async function setStatus(planuojamoPirkimoId, status) {
    await postgres.query(
        `UPDATE cvpp."planuojamiPirkimai" SET nuskaitymas = $1 WHERE "planuojamoPirkimoId" = $2;`,
        [status, planuojamoPirkimoId],
    );
}

async function issaugotiTuriny(planuojamoPirkimoId, content) {
    const setSql = CONTENT_COLUMNS.map(
        (col, i) => `"${col}" = $${i + 1}`,
    ).join(", ");
    const values = CONTENT_COLUMNS.map((col) => content[col] ?? null);
    values.push(NUSKAITYMO_VERSIJA, planuojamoPirkimoId);

    await postgres.query(
        `UPDATE cvpp."planuojamiPirkimai"
         SET ${setSql}, nuskaitymas = $${CONTENT_COLUMNS.length + 1}
         WHERE "planuojamoPirkimoId" = $${CONTENT_COLUMNS.length + 2}`,
        values,
    );
}

export async function scrapeVienaPlanuojamaPirkima() {
    const { rows } = await postgres.query(
        `SELECT "planuojamoPirkimoId", "link"
         FROM cvpp."planuojamiPirkimai"
         WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL
         LIMIT 1;`,
        [NUSKAITYMO_VERSIJA],
    );

    if (rows.length < 1) return false;

    const { planuojamoPirkimoId, link } = rows[0];
    logger.log(`[CVPP planas] Apdorojamas ${planuojamoPirkimoId}`);

    try {
        if (!link) {
            logger.log(`[CVPP planas] ${planuojamoPirkimoId}: nėra link`);
            await setStatus(planuojamoPirkimoId, KLAIDOS_BUSENA);
            return true;
        }

        const response = await scrapeFetch(link);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const { document } = parseHTML(await response.text());

        const content = isTraukiLaukus(document);
        await issaugotiTuriny(planuojamoPirkimoId, content);
        logger.log(`[CVPP planas] ${planuojamoPirkimoId}: nuskaityta`);
        return true;
    } catch (error) {
        logger.log(
            `[CVPP planas] ${planuojamoPirkimoId}: klaida - ${error.message}`,
        );
        try {
            await setStatus(planuojamoPirkimoId, KLAIDOS_BUSENA);
        } catch (updateError) {
            logger.log(
                `[CVPP planas] ${planuojamoPirkimoId}: nepavyko pažymėti klaidos - ${updateError.message}`,
            );
        }
        return true;
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    (async () => {
        while (await scrapeVienaPlanuojamaPirkima()) {}
        await postgres.end();
        logger.log("[CVPP planas] Nuskaitymas baigtas");
    })().catch(async (err) => {
        console.error(err);
        await postgres.end();
        process.exit(1);
    });
}

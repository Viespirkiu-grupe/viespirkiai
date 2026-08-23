import { postgres } from "../../../postgres/postgres.js";
import { log } from "../../../utils/log.js";

// Aktų ATRADIMO sekimas: kas, kada ir iš kurios paieškos eilutės aktą pamatė,
// ir ką vėliau pagal tą atradimą rado `--stage documents`.
//
// Lentelės "eSeimasActDiscovery" čia NIEKAS nekuria — ją reikia paleisti ranka
// (modules/eSeimas/atradimuSekimas.sql). Jei jos nėra, sekimas išsijungia po
// pirmos užklausos ir scraper'is dirba toliau kaip anksčiau: tai tyrimo
// priedas, ne kelias, kuriuo galima nuversti pravažiavimą.

/** PostgreSQL: „undefined_table". */
const NĖRA_LENTELĖS = "42P01";

/** null = dar netikrinta; true/false = žinom. */
let lentelėYra = null;

/** Vieno įrašo klaida sekimo nesustabdo, o dingusi lentelė — sustabdo visam laikui. */
function apdorotiKlaidą(error, kur) {
    if (error?.code === NĖRA_LENTELĖS) {
        if (lentelėYra !== false) {
            log(`[e-Seimas] "eSeimasActDiscovery" nėra — atradimų sekimas išjungtas`
                + ` (paleisti: psql -f modules/eSeimas/atradimuSekimas.sql)`);
        }
        lentelėYra = false;
        return;
    }
    log(`[e-Seimas] atradimų sekimas (${kur}) nepavyko: ${error?.message ?? error}`);
}

/** Paieškos nuorodoje e-Seimas palieka sesijos UUID — pagal jį matyti bangos. */
function searchModelUuid(sourceUrl) {
    const match = /searchModelUUID=([0-9a-f-]{36})/i.exec(String(sourceUrl ?? ""));
    return match ? match[1] : null;
}

const sveikas = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const data = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value ?? "")) ? String(value).slice(0, 10) : null);

/**
 * Įrašo vieno paieškos PUSLAPIO eilutes.
 *
 * @param {Object} ctx
 * @param {"day"|"discover"|"recent"} ctx.source
 * @param {string|null} [ctx.searchFrom]
 * @param {string|null} [ctx.searchTo]
 * @param {number} [ctx.page]
 * @param {Object} [ctx.pagination] - žalias `response.pagination`
 * @param {Array} ctx.items - žali paieškos rezultatai (ta pati eilės tvarka)
 * @param {Set<string>} [ctx.nauji] - "category\0id" raktai, kurie ką tik pateko į eilę
 */
export async function recordDiscoveries({ source, searchFrom = null, searchTo = null, page = null, pagination = null, items = [], nauji = new Set() }) {
    if (lentelėYra === false || !items.length) return 0;

    // `total_items` reiškia „kiek rezultatų turi ŠI užklausa". Dienos paieškoje
    // (from = to) tai ir yra dienos pažadas, o `--discover` režime užklausa yra
    // „viskas iki datos", tad ten tas pats skaičius yra viso rėžio suma ir apie
    // dieną nesako nieko — tokiu atveju jo neįrašom (žr. dienuPazadai.sql, kur
    // dienos pažadai renkami atskirai, po vieną užklausą dienai).
    const dienosUžklausa = Boolean(searchFrom) && searchFrom === searchTo;

    const eilutės = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.category && item?.id);
    if (!eilutės.length) return 0;

    const stulpelis = (fn) => eilutės.map(fn);
    try {
        const { rowCount } = await postgres.query(
            `INSERT INTO "eSeimasActDiscovery" (
                 "category", "legalActId", "source", "searchFrom", "searchTo",
                 "page", "pageSize", "totalItems", "totalPages", "itemsOnPage",
                 "positionOnPage", "sourceIndex", "adoptedAt", "registeredAt",
                 "title", "sourceUrl", "searchModelUuid", "isNew", "item"
             )
             SELECT * FROM unnest(
                 $1::text[], $2::text[], $3::text[], $4::date[], $5::date[],
                 $6::int[], $7::int[], $8::int[], $9::int[], $10::int[],
                 $11::int[], $12::int[], $13::date[], $14::date[],
                 $15::text[], $16::text[], $17::uuid[], $18::boolean[], $19::jsonb[]
             )
             ON CONFLICT DO NOTHING`,
            [
                stulpelis(({ item }) => item.category),
                stulpelis(({ item }) => item.id),
                eilutės.map(() => source),
                eilutės.map(() => data(searchFrom)),
                eilutės.map(() => data(searchTo)),
                eilutės.map(() => sveikas(page)),
                eilutės.map(() => sveikas(pagination?.page_size)),
                eilutės.map(() => (dienosUžklausa ? sveikas(pagination?.total_items) : null)),
                eilutės.map(() => (dienosUžklausa ? sveikas(pagination?.total_pages) : null)),
                eilutės.map(() => items.length),
                stulpelis(({ index }) => index),
                stulpelis(({ item }) => sveikas(item.source_index)),
                stulpelis(({ item }) => data(item.adopted_at)),
                stulpelis(({ item }) => data(item.registered_at)),
                stulpelis(({ item }) => item.title ?? null),
                stulpelis(({ item }) => item.source_url ?? null),
                stulpelis(({ item }) => searchModelUuid(item.source_url)),
                stulpelis(({ item }) => nauji.has(`${item.category}\0${item.id}`)),
                stulpelis(({ item }) => JSON.stringify(item)),
            ],
        );
        lentelėYra = true;
        return rowCount ?? 0;
    } catch (error) {
        apdorotiKlaidą(error, "įrašymas");
        return 0;
    }
}

/**
 * Ką `--stage documents` rado atėjęs pagal atradimą. Žymim VISAS to akto
 * atradimo eilutes: jei tas pats aktas buvo pamatytas kelis kartus, mus
 * domina kiekvienas iš tų kelių.
 *
 * @param {"ok"|"notFound"|"error"} outcome
 * @param {number} attempts - kiek bandymų prireikė (arba sudegė)
 */
export async function recordDocumentOutcome(category, legalActId, outcome, { attempts = 1, error = null } = {}) {
    if (lentelėYra === false) return 0;
    try {
        const { rowCount } = await postgres.query(
            `UPDATE "eSeimasActDiscovery"
                SET "documentOutcome" = $3,
                    "documentCheckedAt" = now(),
                    "documentAttempts" = $4,
                    "documentError" = $5
              WHERE "category" = $1 AND "legalActId" = $2`,
            [category, legalActId, outcome, attempts, error ? String(error?.message ?? error).slice(0, 2000) : null],
        );
        lentelėYra = true;
        return rowCount ?? 0;
    } catch (e) {
        apdorotiKlaidą(e, "rezultato žymėjimas");
        return 0;
    }
}

/**
 * Akto atradimai, naujausias pirma — logo eilutei ir rankiniam tyrimui.
 * Grąžina [] ir tada, kai lentelės nėra.
 */
export async function getActDiscoveries(category, legalActId, { limit = 3 } = {}) {
    if (lentelėYra === false) return [];
    try {
        const { rows } = await postgres.query(
            `SELECT "source", "searchTo"::text AS "searchTo", "page", "totalItems", "totalPages",
                    "positionOnPage", "sourceIndex", "itemsOnPage", "adoptedAt"::text AS "adoptedAt",
                    "searchModelUuid", "discoveredAt"
               FROM "eSeimasActDiscovery"
              WHERE "category" = $1 AND "legalActId" = $2
              ORDER BY "discoveredAt" DESC
              LIMIT $3`,
            [category, legalActId, limit],
        );
        lentelėYra = true;
        return rows;
    } catch (error) {
        apdorotiKlaidą(error, "skaitymas");
        return [];
    }
}

/** „diena 2024-03-15 psl. 2/3 eil. 7/50 (viso 106)" — viena atradimo eilutė logui. */
export function formatDiscovery(row) {
    if (!row) return "atradimas nežinomas";
    const dalys = [
        row.source === "day" ? `diena ${row.searchTo ?? "?"}` : `${row.source} ≤${row.searchTo ?? "?"}`,
        `psl. ${row.page ?? "?"}/${row.totalPages ?? "?"}`,
        `eil. ${row.positionOnPage ?? "?"}/${row.itemsOnPage ?? "?"}`,
        `viso ${row.totalItems ?? "?"}`,
    ];
    if (row.sourceIndex != null) dalys.push(`idx ${row.sourceIndex}`);
    return dalys.join(" ");
}

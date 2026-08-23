import { postgres } from "../../../postgres/postgres.js";

// Dienų pažadai: kiek rezultatų e-Seimas paieška sako turinti vienai dienai
// (`from = to`, `pagination.total_items`). Lentelė "eSeimasDayPromise" —
// modules/eSeimas/dienuPazadai.sql.
//
// Skirtingai nuo atradimų sekimo, čia lentelės nebuvimo NEnutylim: `--promised`
// yra atskiras režimas, kurio visas darbas ir yra tos lentelės pildymas, tad be
// jos verčiau iškart aiški klaida nei tuščias pravažiavimas.

const NĖRA_LENTELĖS = "42P01";

/** Paaiškina, ko trūksta, jei lentelė dar nesukurta. */
export async function assertDayPromiseTable() {
    const { rows: [row] } = await postgres.query(`SELECT to_regclass($1) AS lentelė`, [`"eSeimasDayPromise"`]);
    if (!row?.lentelė) {
        throw new Error(`Nėra lentelės "eSeimasDayPromise" — paleisk:`
            + ` psql "$PG_URL" -f modules/eSeimas/dienuPazadai.sql`);
    }
}

/**
 * Dienos, kurioms pažado dar neturim (arba turim seną). Imam iš
 * "eSeimasScrapeDay" — ten guli visos scraper'iui žinomos dienos.
 *
 * @param {Object} [opts]
 * @param {number} [opts.refreshDays] - kartoti dienas, tikrintas seniau nei prieš tiek d.
 * @param {string[]} [opts.exclude] - šiame paleidime jau nepavykusios dienos
 */
export async function pickDaysWithoutPromise({
    limit = 100, from = null, to = null, refreshDays = null, exclude = [],
} = {}) {
    const { rows } = await postgres.query(
        `SELECT d."day"::text AS day
           FROM "eSeimasScrapeDay" d
           LEFT JOIN "eSeimasDayPromise" p ON p."day" = d."day"
          WHERE ($2::date IS NULL OR d."day" >= $2)
            AND ($3::date IS NULL OR d."day" <= $3)
            AND (p."day" IS NULL
                 OR ($4::int IS NOT NULL AND p."checkedAt" < now() - ($4 || ' days')::interval))
            AND d."day"::text <> ALL($5::text[])
          ORDER BY d."day" DESC
          LIMIT $1`,
        [limit, from, to, refreshDays, exclude],
    );
    return rows.map(row => row.day);
}

/**
 * Vienos dienos matavimas. `previousItems`/`changedAt` juda tik tada, kai
 * skaičius iš tikrųjų pasikeitė — kartotinis toks pat matavimas jų neužtrina.
 */
export async function recordDayPromise(day, { promisedItems = null, totalPages = null, pageSize = null, itemsOnFirstPage = null, queryMs = null, error = null } = {}) {
    try {
        await postgres.query(
            `INSERT INTO "eSeimasDayPromise" (
                 "day", "checkedAt", "promisedItems", "totalPages", "pageSize",
                 "itemsOnFirstPage", "queryMs", "lastError"
             ) VALUES ($1, now(), $2, $3, $4, $5, $6, $7)
             ON CONFLICT ("day") DO UPDATE SET
                 "checkedAt" = now(),
                 "promisedItems" = EXCLUDED."promisedItems",
                 "totalPages" = EXCLUDED."totalPages",
                 "pageSize" = EXCLUDED."pageSize",
                 "itemsOnFirstPage" = EXCLUDED."itemsOnFirstPage",
                 "queryMs" = EXCLUDED."queryMs",
                 "lastError" = EXCLUDED."lastError",
                 "checks" = "eSeimasDayPromise"."checks" + 1,
                 "previousItems" = CASE
                     WHEN EXCLUDED."promisedItems" IS DISTINCT FROM "eSeimasDayPromise"."promisedItems"
                     THEN "eSeimasDayPromise"."promisedItems"
                     ELSE "eSeimasDayPromise"."previousItems" END,
                 "changedAt" = CASE
                     WHEN EXCLUDED."promisedItems" IS DISTINCT FROM "eSeimasDayPromise"."promisedItems"
                     THEN now()
                     ELSE "eSeimasDayPromise"."changedAt" END`,
            [
                day, promisedItems, totalPages, pageSize, itemsOnFirstPage, queryMs,
                error ? String(error?.message ?? error).slice(0, 2000) : null,
            ],
        );
    } catch (e) {
        if (e?.code === NĖRA_LENTELĖS) {
            throw new Error(`Nėra lentelės "eSeimasDayPromise" — paleisk:`
                + ` psql "$PG_URL" -f modules/eSeimas/dienuPazadai.sql`);
        }
        throw e;
    }
}

/** Suvestinė po pravažiavimo: kiek dienų turi pažadą ir kiek jų iš viso. */
export async function getDayPromiseStatus() {
    const { rows: [row] } = await postgres.query(`
        SELECT (SELECT count(*) FROM "eSeimasScrapeDay") AS "dienuViso",
               (SELECT count(*) FROM "eSeimasDayPromise") AS "pamatuota",
               (SELECT count(*) FROM "eSeimasDayPromise" WHERE "lastError" IS NOT NULL) AS "suKlaidomis",
               (SELECT coalesce(sum("promisedItems"), 0) FROM "eSeimasDayPromise") AS "zadetaIsViso"
    `);
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

import { postgres } from "../../../postgres/postgres.js";
import { fixHtmlEntities } from "../../../utils/fixHtmlEntities.js";

export async function loadQuickwitRowsFromPostgres(hits) {
    const ids = hits.map((hit) => String(hit.pirkimoId)).filter(Boolean);
    if (!ids.length) return [];

    const { rows } = await postgres.query(
        `SELECT *
         FROM "eppsViesiejiPirkimai"."pirkimai"
         WHERE "pirkimoId" = ANY($1::int[])`,
        [ids],
    );
    const rowsById = new Map(rows.map((row) => [String(row.pirkimoId), row]));
    return ids.map((id) => rowsById.get(id)).filter(Boolean);
}

/**
 * Normalises a single row from the DB.
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiRezultata(r) {
    r.pavadinimas = fixHtmlEntities(r.pavadinimas ?? "");
    r.pirkimoVykdytojas = fixHtmlEntities(r.pirkimoVykdytojas ?? "");
    r.informacija = fixHtmlEntities(r.informacija ?? "");

    return r;
}


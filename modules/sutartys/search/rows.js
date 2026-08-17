import { postgres } from "../../../postgres/postgres.js";
import { fixHtmlEntities } from "../../../utils/fixHtmlEntities.js";
import { CONTRACT_TYPES } from "../contractTypes.js";
import { SUTARTYS_COLUMNS, SUTARTYS_FROM } from "./filter.js";

/**
 * @typedef {Record<string, any> & {
 *   sutartiesUnikalusId: string | number,
 *   tipas: string,
 *   kategorija: string,
 *   perkanciosiosOrganizacijosKodas: string,
 *   perkanciojiOrganizacija: string,
 *   pavadinimas: string,
 *   tiekejai: string[],
 *   tiekejaiKodai: string[],
 *   bvpzKodai: string[]
 * }} ContractSearchRow
 */

/**
 * Loads complete contract rows from PostgreSQL while preserving search engine order.
 * Missing or deleted PostgreSQL rows are omitted.
 * @param {{ id?: string | number }[]} searchRows
 * @returns {Promise<object[]>}
 */
export async function loadSearchRowsFromPostgres(searchRows) {
    const ids = searchRows
        .map((row) => Number(row.id))
        .filter(Number.isSafeInteger);

    if (ids.length === 0) return [];

    const { rows } = await postgres.query(
        `SELECT ${SUTARTYS_COLUMNS}
         FROM ${SUTARTYS_FROM}
         WHERE s."unikalusId" = ANY($1::bigint[])
           AND s.istrinta = false`,
        [ids],
    );
    const rowsById = new Map(
        rows.map((row) => [Number(row.sutartiesUnikalusId), row]),
    );

    return ids.map((id) => rowsById.get(id)).filter(Boolean);
}


/**
 * @param {Record<string, any>} r
 * @returns {ContractSearchRow}
 */
export function aptvarkytiRezultata(r) {
    if (r.id) {
        r.sutartiesUnikalusId = r.id;
        delete r.id;
    }
    if (r.sutartiesUnikalusID) {
        r.id = r.sutartiesUnikalusID;
        delete r.sutartiesUnikalusID;
    }

    r.bvpzKodai = [r.bvpzKodas, ...(r.papildomiBvpzKodai ?? [])];
    delete r.bvpzKodas;
    delete r.papildomiBvpzKodai;

    r.bvpzPavadinimai = [
        r.bvpzPavadinimas,
        ...(r.papildomiBvpzPavadinimai ?? []),
    ];
    delete r.bvpzPavadinimas;
    delete r.papildomiBvpzPavadinimai;

    r.tiekejai = [r.tiekejas, ...(r.papildomiTiekejai ?? [])];
    delete r.tiekejas;
    delete r.papildomiTiekejai;

    r.tiekejaiKodai = [r.tiekejoKodas, ...(r.papildomiTiekejaiKodai ?? [])];
    delete r.tiekejoKodas;
    delete r.papildomiTiekejaiKodai;

    r.pavadinimas = fixHtmlEntities(r.pavadinimas);
    r.perkanciojiOrganizacija = fixHtmlEntities(r.perkanciojiOrganizacija);
    r.tiekejai = r.tiekejai.map(fixHtmlEntities);

    const tipo = (r.tipas || "").trim().toUpperCase();
    r.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    if (r.dokumentai) {
        delete r.dokumentai;
    }

    return /** @type {ContractSearchRow} */ (r);
}


import { SCHEMA, irasyti } from "./db.js";

/**
 * @typedef {{
 *   pagalKoda: Map<string, number>,
 *   pagalVarda: Map<string, number>
 * }} SubjektuKesas
 */

/**
 * Įkelia jau esančius subjektus (party) į atmintį, kad importas galėtų
 * priskirti FK be papildomų užklausų.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<SubjektuKesas>}
 */
export async function ikeltiSubjektus(client) {
    const { rows } = await client.query(
        `SELECT id, registration_code, canonical_name FROM ${SCHEMA}.party`,
    );
    const kesas = { pagalKoda: new Map(), pagalVarda: new Map() };
    for (const row of rows) {
        const id = Number(row.id);
        if (row.registration_code) kesas.pagalKoda.set(row.registration_code, id);
        else kesas.pagalVarda.set(row.canonical_name.toLowerCase(), id);
    }
    return kesas;
}

/**
 * Įrašo trūkstamus subjektus ir papildo kešą.
 *
 * @param {import("pg").PoolClient} client
 * @param {SubjektuKesas} kesas
 * @param {{kodas: string|null, vardas: string, tipas?: string}[]} kandidatai
 */
export async function irasytiSubjektus(client, kesas, kandidatai) {
    const nauji = new Map();

    for (const { kodas, vardas, tipas } of kandidatai) {
        if (!vardas) continue;
        const raktas = kodas ?? `NAME:${vardas.toLowerCase()}`;
        if (nauji.has(raktas)) continue;
        if (kodas ? kesas.pagalKoda.has(kodas) : kesas.pagalVarda.has(vardas.toLowerCase())) {
            continue;
        }
        nauji.set(raktas, [tipas ?? (kodas ? "legal_entity" : "unknown"), kodas, vardas]);
    }

    if (!nauji.size) return;

    const rows = await irasyti(
        client, "party", ["kind", "registration_code", "canonical_name"],
        [...nauji.values()],
        { grazinti: "id, registration_code, canonical_name" },
    );

    for (const row of rows) {
        const id = Number(row.id);
        if (row.registration_code) kesas.pagalKoda.set(row.registration_code, id);
        else kesas.pagalVarda.set(row.canonical_name.toLowerCase(), id);
    }
}

/**
 * Subjekto id pagal kodą arba (kai kodo nėra) pagal pavadinimą.
 *
 * @param {SubjektuKesas} kesas
 * @param {string|null} kodas
 * @param {string|null} vardas
 * @returns {number|null}
 */
export function rastiSubjekta(kesas, kodas, vardas) {
    if (kodas && kesas.pagalKoda.has(kodas)) return kesas.pagalKoda.get(kodas);
    if (!kodas && vardas) return kesas.pagalVarda.get(vardas.toLowerCase()) ?? null;
    return null;
}

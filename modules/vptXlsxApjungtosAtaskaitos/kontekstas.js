import { ikeltiSubjektus } from "./subjektai.js";

/**
 * @typedef {{
 *   subjektai: import("./subjektai.js").SubjektuKesas,
 *   ataskaitos: Map<string, number>,
 *   dalys: Map<string, number>,
 *   dalyviai: Map<string, number>,
 *   pasiulymai: Map<string, number>,
 *   sutartys: Map<string, number>
 * }} Kontekstas
 */

/**
 * Importo metu naudojami raktų → id kešai.
 *
 * Raktai: ataskaitos `šeima:šaltinioId`, dalys `ataskaitosId:dalies numeris`,
 * dalyviai / pasiūlymai / sutartys `ataskaitosId:vaikoŠaltinioId`.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<Kontekstas>}
 */
export async function sukurtiKontekstą(client) {
    return {
        subjektai: await ikeltiSubjektus(client),
        ataskaitos: new Map(),
        dalys: new Map(),
        dalyviai: new Map(),
        pasiulymai: new Map(),
        sutartys: new Map(),
    };
}

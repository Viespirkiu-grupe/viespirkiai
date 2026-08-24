import { postgres } from "../../postgres/postgres.js";

/** Šio modulio PostgreSQL schema (cituota, tinka interpoliacijai į SQL). */
export const SCHEMA = '"vptXlsxApjungtosAtaskaitos"';

/** PostgreSQL riba – 65535 parametrai vienoje užklausoje. */
const MAX_PARAMETRU = 60_000;

/**
 * Įvykdo veiksmą vienoje transakcijoje ant bendro projekto pool'o.
 *
 * @template T
 * @param {(client: import("pg").PoolClient) => Promise<T>} veiksmas
 * @returns {Promise<T>}
 */
export async function transakcija(veiksmas) {
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        const rezultatas = await veiksmas(client);
        await client.query("COMMIT");
        return rezultatas;
    } catch (klaida) {
        await client.query("ROLLBACK");
        throw klaida;
    } finally {
        client.release();
    }
}

/**
 * Grupinis INSERT ... ON CONFLICT. Eilutės skaidomos porcijomis pagal
 * PostgreSQL parametrų ribą.
 *
 * @param {import("pg").PoolClient} client
 * @param {string} lentele - Lentelės vardas be schemos.
 * @param {string[]} stulpeliai
 * @param {unknown[][]} eilutes - Reikšmės ta pačia tvarka kaip `stulpeliai`.
 * @param {object} [nustatymai]
 * @param {string} [nustatymai.konfliktas] - Pvz. `(family, source_record_id)`;
 *   tuščias tekstas – `ON CONFLICT DO NOTHING` be konkretaus apribojimo
 *   (kai lentelė turi kelis unikalumo apribojimus).
 * @param {string[]} [nustatymai.atnaujinti] - Stulpeliai DO UPDATE daliai.
 * @param {string} [nustatymai.grazinti] - RETURNING sąrašas.
 * @returns {Promise<object[]>} RETURNING eilutės (jei prašyta).
 */
export async function irasyti(client, lentele, stulpeliai, eilutes, nustatymai = {}) {
    const { konfliktas, atnaujinti = [], grazinti } = nustatymai;
    if (!eilutes.length) return [];

    const konfliktoDalis = konfliktas === undefined
        ? ""
        : konfliktas === ""
            ? " ON CONFLICT DO NOTHING"
            : atnaujinti.length
                ? ` ON CONFLICT ${konfliktas} DO UPDATE SET ${
                    atnaujinti.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
                : ` ON CONFLICT ${konfliktas} DO NOTHING`;
    const grazinimas = grazinti ? ` RETURNING ${grazinti}` : "";
    const porcija = Math.max(1, Math.floor(MAX_PARAMETRU / stulpeliai.length));
    const rezultatai = [];

    for (let nuo = 0; nuo < eilutes.length; nuo += porcija) {
        const dalis = eilutes.slice(nuo, nuo + porcija);
        const reiksmes = [];
        const vietos = dalis.map((eilute, indeksas) => {
            const bazė = indeksas * stulpeliai.length;
            reiksmes.push(...eilute);
            return `(${stulpeliai.map((_, i) => `$${bazė + i + 1}`).join(", ")})`;
        });
        const { rows } = await client.query(
            `INSERT INTO ${SCHEMA}.${lentele} (${stulpeliai.join(", ")})
             VALUES ${vietos.join(", ")}${konfliktoDalis}${grazinimas}`,
            reiksmes,
        );
        if (grazinti) rezultatai.push(...rows);
    }

    return rezultatai;
}

/**
 * Žodyno lentelės upsert'as, grąžinantis `reikšmė → id` atvaizdį (grąžinami ir
 * jau egzistavę įrašai, nes naudojamas DO UPDATE).
 *
 * @param {import("pg").PoolClient} client
 * @param {string} lentele
 * @param {string} stulpelis - Unikalus teksto stulpelis (name, citation…).
 * @param {Iterable<string>} reiksmes
 * @returns {Promise<Map<string, number>>}
 */
export async function zodynas(client, lentele, stulpelis, reiksmes) {
    const unikalios = [...new Set([...reiksmes].filter(Boolean))];
    const rows = await irasyti(
        client, lentele, [stulpelis], unikalios.map((r) => [r]),
        {
            konfliktas: `(${stulpelis})`,
            atnaujinti: [stulpelis],
            grazinti: `id, ${stulpelis}`,
        },
    );
    return new Map(rows.map((row) => [row[stulpelis], Number(row.id)]));
}

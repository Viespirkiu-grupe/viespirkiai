import { postgres } from "../../postgres/postgres.js";
import { createTtlPromiseCache } from "../../utils/ttlPromiseCache.js";

// Nuotraukos data keičiasi kartą per mėnesį, tad pusvalandžio kešo pakanka, o
// kiekvienas puslapio atvaizdavimas nebedaro atskiros užklausos.
const kesas = createTtlPromiseCache(30 * 60 * 1000);

/**
 * Naujausios sėkmingai importuotos nuotraukos data.
 *
 * `regitra` yra append-only ir kaupia visų mėnesių eilutes, todėl aktualus
 * parkas atrenkamas per `regitraMatymai."atnaujinimoData"`.
 *
 * @returns {Promise<string|null>} YYYY-MM-DD arba null, jei dar nieko neimportuota.
 */
export async function gautiNaujausiaRegitrosData() {
    return kesas("naujausiaData", async () => {
        const { rows } = await postgres.query(
            `SELECT max("atnaujinimoData")::text AS data FROM regitra."matymai"`,
        );
        return rows[0]?.data ?? null;
    });
}

/**
 * Juridinio asmens transporto priemonės iš naujausios Regitros nuotraukos.
 *
 * DĖMESIO dėl `kiekis`: anonimizuotuose duomenyse nėra nei VIN, nei valstybinio
 * numerio, todėl vienodos TP (pvz. 92 identiški to paties parko L200) suplaukia
 * į vieną `regitra` eilutę. Tikrasis jų skaičius yra `regitraMatymai."kiekis"`,
 * tad bendra suma skaičiuojama per `sum(kiekis)`, o ne `count(*)`.
 *
 * @param {string} jarKodas
 * @param {object} [options]
 * @param {number|string} [options.limit]
 * @returns {Promise<{limit: number|string, rows: number, atnaujinimoData: string|null, transportoPriemones: object[]}>}
 */
export async function gautiRegitrosDuomenis(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    const atnaujinimoData = await gautiNaujausiaRegitrosData();
    if (!atnaujinimoData) {
        return {
            limit: useLimit ? limit : "max",
            rows: 0,
            atnaujinimoData: null,
            transportoPriemones: [],
        };
    }

    // Run count and fetch in parallel
    const [transportoPriemonesCountResult, transportoPriemonesRows] =
        await Promise.all([
            postgres.query(
                `SELECT COALESCE(SUM(m."kiekis"), 0) AS total
           FROM regitra."priemoniuTipai" r
           JOIN regitra."matymai" m ON m."md5" = r."md5"
           WHERE r."jarKodas" = $1
             AND m."atnaujinimoData" = $2;`,
                [jarKodas, atnaujinimoData],
            ),
            postgres.query(
                `SELECT r.*, m."kiekis", m."pirmaMatytaData", m."atnaujinimoData"
           FROM regitra."priemoniuTipai" r
           JOIN regitra."matymai" m ON m."md5" = r."md5"
           WHERE r."jarKodas" = $1
             AND m."atnaujinimoData" = $2
           ORDER BY r."pirmosiosRegistracijosData" ASC
           ${useLimit ? "LIMIT $3" : ""};`,
                useLimit
                    ? [jarKodas, atnaujinimoData, limit]
                    : [jarKodas, atnaujinimoData],
            ),
        ]);

    // `md5` yra vidinė eilutės tapatybė — nei svetainei, nei MCP atsakymui jos
    // nereikia, o kiekvienoje eilutėje ji būtų 32 simboliai triukšmo.
    const transportoPriemones = transportoPriemonesRows.rows.map(
        ({ md5, ...auto }) => auto,
    );

    return {
        limit: useLimit ? limit : "max",
        rows: parseInt(transportoPriemonesCountResult.rows[0].total, 10), // bendras TP skaičius (su dublikatais)
        atnaujinimoData,
        transportoPriemones, // limited rows
    };
}

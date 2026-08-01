import config from "../utils/config.js";

/**
 * Įvardintos (prepared) užklausos pagalbininkas.
 *
 * pg tokį `name` paruošia po kartą kiekvienai pool'o jungčiai, todėl kartotiniai
 * kvietimai nebemoka planavimo kainos. Didelėms užklausoms (pvz. sutarties
 * eilutė – ~4 KB SQL su LATERAL join'ais) tai yra didžioji laiko dalis:
 * išmatuota 8,2 ms → 3,3 ms vienam point lookup'ui.
 *
 * Reikalavimai:
 *  - `name` privalo 1:1 atitikti `text` (tas pats vardas su kitu tekstu toje
 *    pačioje jungtyje – pg klaida);
 *  - SQL turi būti statiškas (jokių interpoliuojamų filtrų/limitų), kad planas
 *    tiktų visiems kvietimams.
 *
 * `PG_PREPARED=false` išjungia – reikalinga, jei jungiamasi per pgbouncer
 * transaction pooling režimu be `max_prepared_statements`.
 */
const PREPARED = config.pgPrepared !== false;

/**
 * @param {string} name - unikalus paruoštos užklausos vardas.
 * @param {string} text - statiškas SQL.
 * @returns {(values?: any[]) => { name?: string, text: string, values?: any[] }}
 */
export function preparedStatement(name, text) {
    return (values) =>
        PREPARED ? { name, text, values } : { text, values };
}

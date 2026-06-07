/**
 * Žmogui suprantami `failai` lentelės būsenų aprašymai.
 *
 * `nuskaitytas`:
 *   - teigiamas (pvz. 12) = SĖKMĖ; skaičius yra nuskaitymo algoritmo versija
 *   - 0 = dar nenuskaityta (laukia eilėje arba pažymėta perskaitymui)
 *   - null = dar nenuskaityta (niekada nebandyta)
 *   - neigiamas = KLAIDA (žr. kodus žemiau)
 *
 * `parsiustas`:
 *   - 1 = parsiųsta
 *   - 0 = dar neparsiųsta
 *   - -1 = nepavyko parsiųsti
 *   - -5 = išskleista iš archyvo (parsiųsti nereikia)
 */

export const NUSKAITYMO_KLAIDOS = {
    "-1": "klaida: nepavyko nuskaityti teksto",
    "-2": "klaida: dokumentas apsaugotas slaptažodžiu",
    "-4": "klaida: tuščias arba sugadintas dokumentas",
    "-404": "klaida: failas nerastas šaltinyje",
};

export function aprasytiNuskaityma(nuskaitytas) {
    if (nuskaitytas == null || nuskaitytas === 0)
        return "dar nenuskaityta (laukia eilėje)";
    if (nuskaitytas > 0)
        return `sėkmingai nuskaityta (nuskaitymo versija ${nuskaitytas})`;
    return NUSKAITYMO_KLAIDOS[String(nuskaitytas)] || `klaida (kodas ${nuskaitytas})`;
}

export function aprasytiParsiusima(parsiustas) {
    switch (parsiustas) {
        case 1:
            return "parsiųsta";
        case 0:
            return "dar neparsiųsta";
        case -1:
            return "nepavyko parsiųsti";
        case -5:
            return "išskleista iš archyvo, galima gauti tiesiogiai";
        default:
            return parsiustas == null
                ? "dar neparsiųsta"
                : `nežinoma būsena (kodas ${parsiustas})`;
    }
}

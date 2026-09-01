/**
 * Bendras `pinreg."juridiniaiRysiai"` skaitymo fragmentas.
 *
 * Skaitytojai eina prie pačios lentelės (ne prie `juridiniaiRysiaiPilni`
 * view'o), kad `irasoTipas` liktų enum – pagal jį eina filtrai ir du daliniai
 * indeksai. Žodyniniai laukai prijungiami čia, senaisiais vardais, tad eilutės
 * forma JS pusėje nesikeičia.
 */
export const RYSIAI_SELECT = `r.*,
        rp."pavadinimas" AS "rysioPobudzioPavadinimas",
        tf."kodas"       AS "jaTeisinesFormosKodas",
        tf."pavadinimas" AS "jaTeisinesFormosPavadinimas"`;

export const RYSIAI_FROM = `pinreg."juridiniaiRysiai" r
        LEFT JOIN pinreg."rysiuPobudziai" rp ON rp."id" = r."rysioPobudzioId"
        LEFT JOIN pinreg."teisinesFormos"  tf ON tf."id" = r."teisinesFormosId"`;

/** Ryšio pobūdis WHERE sąlygoms (view'o stulpelio atitikmuo bazinėje lentelėje). */
export const RYSIO_POBUDIS_SQL = 'rp."pavadinimas"';

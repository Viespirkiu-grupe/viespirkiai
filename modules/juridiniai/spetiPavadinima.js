/*
Individualių įmonių (ir ūkinių bendrijų) pavadinimų spėjimas iš sutarčių.

Registrų centro JAR atviruose duomenyse individualių įmonių, jų filialų ir
ūkinių bendrijų pavadinimo laukas užpildytas tik teisine forma („Individuali
įmonė"), nes pavadinime yra savininko vardas. Tą patį juridinį asmenį viešųjų
pirkimų sutartyse perkančiosios organizacijos įrašo pilnu pavadinimu
(pvz. „Vytauto Kubiliaus individuali įmonė"), tad pavadinimą galima atspėti
paėmus dažniausią tiekėjo pavadinimą iš paskutinių sutarčių.

Tik tiekėjo pusė: individuali įmonė ar ūkinė bendrija niekada nebūna
perkančioji organizacija, tad pirkėjo pavadinimai tam pačiam kodui reikštų
klaidingą sutarties įrašą.

Rezultatas yra spėjimas ir vartotojui rodomas kaip toks, o ne kaip registro
duomuo.
*/

import { postgres } from "../../postgres/postgres.js";

// Formos, kurių pavadinimo RC neatskleidžia — `jarAsmenys."pavadinimas"` joms
// visada lygus formos pavadinimui.
export const BEVARDES_FORMOS = new Set([
    810, // Individuali įmonė
    811, // Individualios įmonės filialas
    210, // Tikroji ūkinė bendrija
    211, // Tikrosios ūkinės bendrijos filialas
    220, // Komanditinė ūkinė bendrija
    221, // Komanditinės ūkinės bendrijos filialas
]);

/**
 * Ar šio juridinio asmens pavadinimo registre iš tikrųjų nėra.
 * @param {{formosKodas?: number}} jar
 */
export function arBevardisAsmuo(jar) {
    return BEVARDES_FORMOS.has(Number(jar?.formosKodas));
}

// Kiek naujausių sutarčių imame balsavimui. Pakanka, kad atsijotų atsitiktiniai
// rašybos variantai, bet neužtemptų seno, jau pasikeitusio pavadinimo.
const SUTARCIU_LIMITAS = 50;

/**
 * Atspėja bevardžio juridinio asmens pavadinimą iš paskutinių jo sutarčių.
 * @param {number|string} jarKodas
 * @param {string} [registroPavadinimas] - JAR pavadinimas (teisinė forma), kurio
 *   atkartojimas sutartyje nieko naujo nepasako, tad į balsavimą neįtraukiamas
 * @returns {Promise<{pavadinimas: string, kiek: number, isViso: number}|null>}
 */
export async function spetiPavadinimaIsSutarciu(jarKodas, registroPavadinimas) {
    const kodas = String(jarKodas);

    const { rows } = await postgres.query(
        `WITH paskutines AS (
             (SELECT v."redagavimoData", s."pavadinimas"
              FROM "vpmSutartys"."sutartys" v
              JOIN "vpmSutartys"."salys" s ON s."id" = v."pirmoTiekejoPavadinimoId"
              WHERE v."pirmoTiekejoKodas" = $1 AND v."istrinta" = false
              ORDER BY v."redagavimoData" DESC NULLS LAST
              LIMIT ${SUTARCIU_LIMITAS})
             UNION ALL
             (SELECT v."redagavimoData", s."pavadinimas"
              FROM "vpmSutartys"."papildomiTiekejai" p
              JOIN "vpmSutartys"."sutartys" v ON v."unikalusId" = p."unikalusId" AND v."istrinta" = false
              JOIN "vpmSutartys"."salys" s ON s."id" = p."tiekejoPavadinimoId"
              WHERE p."tiekejoKodas" = $1
              ORDER BY v."redagavimoData" DESC NULLS LAST
              LIMIT ${SUTARCIU_LIMITAS})
         ),
         naujausios AS (
             SELECT "redagavimoData", "pavadinimas" FROM paskutines
             WHERE "pavadinimas" IS NOT NULL
               AND btrim("pavadinimas") <> ''
               AND lower(btrim("pavadinimas")) IS DISTINCT FROM lower(btrim($2))
             ORDER BY "redagavimoData" DESC NULLS LAST
             LIMIT ${SUTARCIU_LIMITAS}
         )
         -- Vienodo dažnio variantus (pvz. „R. Pivoriūno" vs „R Pivoriūno")
         -- skiria naujesnė sutartis — pavadinimas galėjo ir pasikeisti.
         SELECT "pavadinimas",
                count(*)::int AS "kiek",
                (SELECT count(*)::int FROM naujausios) AS "isViso"
         FROM naujausios
         GROUP BY "pavadinimas"
         ORDER BY "kiek" DESC, max("redagavimoData") DESC NULLS LAST
         LIMIT 1`,
        [kodas, registroPavadinimas || ""],
    );

    const geriausias = rows[0];
    if (!geriausias) return null;

    return {
        pavadinimas: geriausias.pavadinimas.trim(),
        kiek: geriausias.kiek,
        isViso: geriausias.isViso,
    };
}

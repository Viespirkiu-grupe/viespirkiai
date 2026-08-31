import { postgres } from "../../postgres/postgres.js";

/**
 * VPT juodieji sąrašai (`vptJuodiejiSarasai` schema). Abu sąrašai gyvena vienoje
 * lentelėje su `sarasoId` skirtuku, tad užtenka vienos užklausos abiem.
 *
 * Pagrindimai prikabinami LEFT JOIN'u pagal (sąrašas, JAR kodas, pirkimo nr.) –
 * išorinio rakto tarp jų nėra, nes dalis paaiškinimų sąraše atitikmens neturi
 * (žr. vptJuodiejiSarasaiSchema.sql).
 *
 * @param {string} jarKodas
 * @param {'nepatikimi' | 'melagingi'} sarasas
 */
async function gautiIrasus(jarKodas, sarasas) {
    const { rows } = await postgres.query(
        `SELECT t.*, s."kodas" AS "sarasas",
                CASE WHEN p."id" IS NULL THEN NULL ELSE to_jsonb(p) END AS "pagrindimas"
           FROM "vptJuodiejiSarasai"."tiekejai" t
           JOIN "vptJuodiejiSarasai"."sarasai" s ON s."id" = t."sarasoId"
           LEFT JOIN "vptJuodiejiSarasai"."pagrindimai" p
                  ON p."sarasoId" = t."sarasoId"
                 AND p."tiekejoJarKodas" = t."tiekejoJarKodas"
                 AND p."pirkimoNumeris" = t."pirkimoNumeris"
          WHERE t."tiekejoJarKodas" = $1
            AND s."kodas" = $2
          ORDER BY t."duomenuIvedimoData" DESC NULLS LAST`,
        [jarKodas, sarasas],
    );
    return rows;
}

export function gautiNepatikimuTiekejuIrasusPagalJarKoda(jarKodas) {
    return gautiIrasus(jarKodas, "nepatikimi");
}

export function gautiMelaginguTiekejuIrasusPagalJarKoda(jarKodas) {
    return gautiIrasus(jarKodas, "melagingi");
}

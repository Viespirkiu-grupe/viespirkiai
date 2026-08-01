-- Vienas eilutė per (pirkimas, tiekėjas, pirkimo dalis). Naudok get_failas_tekstas su ATN-1
-- xlsx failu (pavadinimas: PPA-*, ATN-*, Atn-1*) jei reikia papildomos detalės:
-- p.4=dalyviai, p.6=atmesti pasiūlymai su kainomis, p.7=pasiūlymų eilė su kainomis.
CREATE OR REPLACE VIEW v_dalyviai AS
SELECT a."pirkimoNumeris",
       a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       a."pirkimoBudas",
       a."sukurtaAt"                       AS "ataskaitosData",
       a."pirkimoObjektoPavadinimas",
       a."pagrindinisKodasBvpz",
       a."daliuSkaicius",
       a."interesuKonfliktasNustatytas",
       a."interesuKonfliktoPriemones",
       a."konkurencijaIskreipiantisAsmuo",
       a."konkurencijosPriemones",
       a."pretenzijaPateikta",
       a."ieskinysTeismui",
       d.kodas                             AS "tiekejoKodas",
       j.pavadinimas                       AS tiekejas,
       d."fizinisAsmuo",
       d.salis,
       p."daliesNumeris",
       p."eileNumeris",
       p."pasiulymoKaina",
       p."atmetimoPriezastis"
FROM atn1ataskaitos a
         JOIN atn1dalyviai d ON d."ataskaitaId" = a.id
         LEFT JOIN LATERAL (
             SELECT COALESCE(e."daliesNumeris", ap."daliesNumeris") AS "daliesNumeris",
                    e."eileNumeris"                                 AS "eileNumeris",
                    e.kaina::numeric                                AS "pasiulymoKaina",
                    ap.statusas                                     AS "atmetimoPriezastis"
             FROM "atn1pasiulymuEile" e
                      FULL OUTER JOIN "atn1atmestiPasiulymai" ap
                                      ON ap."ataskaitaId" = e."ataskaitaId"
                                          AND ap."dalyvioKodas" = e."dalyvioKodas"
                                          AND ap."daliesNumeris" = e."daliesNumeris"
             WHERE COALESCE(e."ataskaitaId", ap."ataskaitaId") = a.id
               AND COALESCE(e."dalyvioKodas", ap."dalyvioKodas") = d.kodas
         ) p ON true
         LEFT JOIN "jarAsmenys" j ON j."jarKodas"::text = d.kodas

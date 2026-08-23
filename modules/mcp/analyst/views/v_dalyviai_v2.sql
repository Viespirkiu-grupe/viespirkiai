-- Risk service's own copy of v_dalyviai, isolated under a _v2 suffix so the
-- three deployed indicators' collect.sql statements never depend on
-- whatever the shared analyst v_dalyviai view happens to look like at any
-- given time. Same definition as v_dalyviai.sql — keep the two in sync by
-- hand until the shared view is retired in favor of this one.
--
-- Viena eilutė per (pirkimas, tiekėjas, pirkimo dalis). PPA XLSX turinys.
-- xlsx failu (pavadinimas: PPA-*, ATN-*, Atn-1*) jei reikia papildomos detalės:
-- p.4=dalyviai, p.6=atmesti pasiūlymai su kainomis, p.7=pasiūlymų eilė su kainomis.
CREATE OR REPLACE VIEW v_dalyviai_v2 AS
SELECT a."pirkimoNumeris",
       a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       pb.pavadinimas                        AS "pirkimoBudas",
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
       salis.pavadinimas                    AS salis,
       p."daliesNumeris",
       p."eileNumeris",
       p."pasiulymoKaina",
       p."atmetimoPriezastis",
       p."atmetimoStatusas"
FROM "xlsxPPAataskaitos" a
         LEFT JOIN "xlsxPPApirkimoBudai" pb ON pb.id = a."pirkimoBudasId"
         JOIN "xlsxPPAdalyviai" d ON d."ataskaitaId" = a.id
         LEFT JOIN "xlsxPPAsalys" salis ON salis.id = d."salisId"
         LEFT JOIN LATERAL (
             SELECT COALESCE(e."daliesNumeris", ap."daliesNumeris") AS "daliesNumeris",
                    e."eileNumeris"                                 AS "eileNumeris",
                    e.kaina::numeric                                AS "pasiulymoKaina",
                    apr.pavadinimas                                 AS "atmetimoPriezastis",
                    aps.pavadinimas                                 AS "atmetimoStatusas"
             FROM "xlsxPPApasiulymuEile" e
                      FULL OUTER JOIN "xlsxPPAatmestiPasiulymai" ap
                                      ON ap."ataskaitaId" = e."ataskaitaId"
                                          AND ap."dalyvioKodas" = e."dalyvioKodas"
                                          AND ap."daliesNumeris" = e."daliesNumeris"
                      LEFT JOIN "xlsxPPAatmetimoPriezastys" apr
                                ON apr.id = ap."atmetimoPriezastysId"
                      LEFT JOIN "xlsxPPAatmestuPasiulymuStatusai" aps
                                ON aps.id = ap."statusasId"
             WHERE COALESCE(e."ataskaitaId", ap."ataskaitaId") = a.id
               AND COALESCE(e."dalyvioKodas", ap."dalyvioKodas") = d.kodas
         ) p ON true
         LEFT JOIN "jarAsmenys" j ON j."jarKodas"::text = d.kodas

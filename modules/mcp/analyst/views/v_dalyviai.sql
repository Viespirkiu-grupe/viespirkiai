CREATE TEMP VIEW v_dalyviai AS
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
       e."eileNumeris",
       e.kaina::numeric                    AS "pasiulymoKaina",
       ap.statusas                         AS "atmetimoPriezastis"
FROM atn1ataskaitos a
         JOIN atn1dalyviai d ON d."ataskaitaId" = a.id
         LEFT JOIN "atn1pasiulymuEile" e
                   ON e."ataskaitaId" = a.id AND e."dalyvioKodas" = d.kodas
         LEFT JOIN "atn1atmestiPasiulymai" ap
                   ON ap."ataskaitaId" = a.id AND ap."dalyvioKodas" = d.kodas
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = d.kodas

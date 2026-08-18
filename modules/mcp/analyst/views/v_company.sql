CREATE OR REPLACE VIEW v_company AS
SELECT j."jarKodas"::text,
       j.pavadinimas,
       COALESCE(
           ja."adresas",
           NULLIF(concat_ws(', ',
               sav."pavadinimas",
               gyv."pavadinimas",
               NULLIF(concat_ws(' ',
                   gatve."pavadinimas",
                   NULLIF(concat(
                       pastatas."nr",
                       CASE WHEN pastatas."korpusoNr" IS NOT NULL
                           THEN ' K' || pastatas."korpusoNr" ELSE '' END,
                       CASE WHEN patalpa."patalpaNr" IS NOT NULL
                           THEN '-' || patalpa."patalpaNr" ELSE '' END
                   ), '')
               ), ''),
               pastatas."pastoKodas"
           ), '')
       ) AS adresas,
       j."registravimoData",
       forma."pavadinimas" AS "formosPavadinimas",
       statusas."pavadinimas" AS "statusoPavadinimas",
       j."statusasNuo",
       s.data                                                                       AS "sodraData",
       (COALESCE(s.draustieji, 0) + COALESCE(s.draustieji2, 0))                     AS darbuotojai,
       s."vidutinisAtlyginimas",
       s."imokuSuma",
       melagingas."nuo"                                                             AS "melagingisTiekejasNuo",
       melagingas."iki"                                                             AS "melagingisTiekejasIki",
       nepatikimas."nuo"                                                            AS "nepatikimasTiekejasNuo",
       nepatikimas."iki"                                                            AS "nepatikimasTiekejasIki",
       (SELECT COUNT(*)
        FROM "vdiPazeidimai" v
        WHERE v."jarKodas" = j."jarKodas"::text)                                    AS "vdiPazeidimuSkaicius",
       (SELECT COUNT(*)
        FROM "teismoNuosprendziaiDalyviai" d
        WHERE d.kodas = j."jarKodas"::text)                                         AS "bylosSkaicius",
       (SELECT COUNT(*)
        FROM domenai d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                              AS "domenaiSkaicius",
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                                   AS "neskelbiamosDerybosSkaicius"
FROM "jarAsmenys" j
         LEFT JOIN "jarFormos" forma ON forma."kodas" = j."formosKodas"
         LEFT JOIN "jarStatusai" statusas ON statusas."kodas" = j."statusoKodas"
         LEFT JOIN "jarAsmenuAdresai" ja ON ja."jarKodas" = j."jarKodas"
         LEFT JOIN "arPatalposAdresai" patalpa ON patalpa."patKodas" = ja."aobKodas"
         LEFT JOIN "arPastataiSklypaiAdresai" pastatas
                   ON pastatas."kodas" = COALESCE(patalpa."aobKodas", ja."aobKodas")
         LEFT JOIN "arGatves" gatve ON gatve."kodas" = pastatas."gatKodas"
         LEFT JOIN "arGyvenvietesRibos" gyv ON gyv."kodas" = pastatas."gyvKodas"
         LEFT JOIN "arSavivaldybes" sav
                   ON sav."kodas" = COALESCE(pastatas."savKodas", gyv."savivaldybesKodas")
         LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM "sodraMonthly"
    WHERE "jarKodas" = j."jarKodas"::integer
    ORDER BY data DESC NULLS LAST
    LIMIT 1
    ) s ON true
         -- Time-bounded facts, exposed as their own validity interval rather than a
         -- CURRENT_DATE-evaluated boolean: a run at a given data_as_of cutoff must
         -- be able to decide "in force at that cutoff" for itself (compare cutoff
         -- against nuo/iki), not get an answer baked in against today's wall clock.
         -- A company can have more than one entry (one per case); this picks the
         -- most current one -- open-ended (iki IS NULL) first, else the latest iki.
         LEFT JOIN LATERAL (
    SELECT "dataNuoKuriosSkaiciuojamasTerminas" AS "nuo", "itrauktasIki" AS "iki"
    FROM "melagingiTiekejai"
    WHERE "tiekejoJarKodas" = j."jarKodas"::text
    ORDER BY ("itrauktasIki" IS NULL) DESC, "itrauktasIki" DESC, "dataNuoKuriosSkaiciuojamasTerminas" DESC
    LIMIT 1
    ) melagingas ON true
         LEFT JOIN LATERAL (
    SELECT "dataNuoKuriosSkaiciuojama" AS "nuo", "itrauktaIki" AS "iki"
    FROM "nepatikimiTiekejai"
    WHERE "tiekejoJarKodas" = j."jarKodas"::text
    ORDER BY ("itrauktaIki" IS NULL) DESC, "itrauktaIki" DESC, "dataNuoKuriosSkaiciuojama" DESC
    LIMIT 1
    ) nepatikimas ON true

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
       EXISTS(SELECT 1
              FROM "melagingiTiekejai" m
              WHERE m."tiekejoJarKodas" = j."jarKodas"::text
                AND (m."itrauktasIki" IS NULL OR m."itrauktasIki" >= CURRENT_DATE)) AS "melagingisTiekejas",
       EXISTS(SELECT 1
              FROM "nepatikimiTiekejai" n
              WHERE n."tiekejoJarKodas" = j."jarKodas"::text
                AND (n."itrauktaIki" IS NULL OR n."itrauktaIki" >= CURRENT_DATE))   AS "nepatikimasTiekejas",
       (SELECT COUNT(*)
        FROM "vdiPazeidimai" v
        WHERE v."jarKodas" = j."jarKodas"::text)                                    AS "vdiPazeidimuSkaicius",
       (SELECT COUNT(*)
        FROM liteko."dalyviaiPilni" d
        WHERE d.kodas = j."jarKodas"::text)                                         AS "bylosSkaicius",
       (SELECT COUNT(*)
        FROM domenai."domenaiPilni" d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                              AS "domenaiSkaicius",
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                                   AS "neskelbiamosDerybosSkaicius"
FROM "jarAsmenys" j
         LEFT JOIN "jarFormos" forma ON forma."kodas" = j."formosKodas"
         LEFT JOIN "jarStatusai" statusas ON statusas."kodas" = j."statusoKodas"
         LEFT JOIN "jarAsmenuAdresai" ja ON ja."jarKodas" = j."jarKodas"
         LEFT JOIN "adresuRegistras"."patalposAdresai" patalpa ON patalpa."patKodas" = ja."aobKodas"::int
         LEFT JOIN "adresuRegistras"."pastataiSklypaiAdresai" pastatas
                   ON pastatas."kodas" = COALESCE(patalpa."aobKodas", ja."aobKodas"::int)
         LEFT JOIN "adresuRegistras"."gatves" gatve ON gatve."kodas" = pastatas."gatKodas"
         LEFT JOIN "adresuRegistras"."gyvenvietesRibos" gyv ON gyv."kodas" = pastatas."gyvKodas"
         LEFT JOIN "adresuRegistras"."savivaldybes" sav
                   ON sav."kodas" = COALESCE(pastatas."savKodas", gyv."savivaldybesKodas")
         LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM "sodraMonthly"
    WHERE "jarKodas" = j."jarKodas"::integer
    ORDER BY data DESC NULLS LAST
    LIMIT 1
    ) s ON true

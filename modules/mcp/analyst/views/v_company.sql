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
        FROM vdi.pazeidimai v
        JOIN vdi.subjektai vs ON vs.id = v."subjektoId"
        WHERE vs."jarKodas" = j."jarKodas"::integer)                                AS "vdiPazeidimuSkaicius",
       (SELECT COUNT(*)
        FROM liteko."dalyviaiPilni" d
        WHERE d.kodas = j."jarKodas"::text)                                         AS "bylosSkaicius",
       (SELECT COUNT(*)
        FROM domenai."domenaiPilni" d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                              AS "domenaiSkaicius",
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                                   AS "neskelbiamosDerybosSkaicius"
FROM "rcJar"."asmenys" j
         LEFT JOIN "rcJar"."formos" forma ON forma."kodas" = j."formosKodas"
         LEFT JOIN "rcJar"."statusai" statusas ON statusas."kodas" = j."statusoKodas"
         LEFT JOIN "rcJar"."asmenuAdresai" ja ON ja."jarKodas" = j."jarKodas"
         LEFT JOIN "adresuRegistras"."patalposAdresai" patalpa ON patalpa."patKodas" = ja."aobKodas"::int
         LEFT JOIN "adresuRegistras"."pastataiSklypaiAdresai" pastatas
                   ON pastatas."kodas" = COALESCE(patalpa."aobKodas", ja."aobKodas"::int)
         LEFT JOIN "adresuRegistras"."gatves" gatve ON gatve."kodas" = pastatas."gatKodas"
         LEFT JOIN "adresuRegistras"."gyvenvietesRibos" gyv ON gyv."kodas" = pastatas."gyvKodas"
         LEFT JOIN "adresuRegistras"."savivaldybes" sav
                   ON sav."kodas" = COALESCE(pastatas."savKodas", gyv."savivaldybesKodas")
         LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM sodra."menesiniai"
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
         --
         -- Both juodieji sąrašai now live in one "vptJuodiejiSarasai"."tiekejai"
         -- table keyed by "sarasoId"; the per-list start date (buvę
         -- "dataNuoKuriosSkaiciuojamasTerminas" ir "dataNuoKuriosSkaiciuojama")
         -- normalised into the shared "terminoPradzia" column.
         LEFT JOIN LATERAL (
    SELECT m."terminoPradzia" AS "nuo", m."itrauktasIki" AS "iki"
    FROM "vptJuodiejiSarasai"."tiekejai" m
    JOIN "vptJuodiejiSarasai"."sarasai" ms ON ms."id" = m."sarasoId"
    WHERE m."tiekejoJarKodas" = j."jarKodas"::text
      AND ms."kodas" = 'melagingi'
    ORDER BY (m."itrauktasIki" IS NULL) DESC, m."itrauktasIki" DESC, m."terminoPradzia" DESC
    LIMIT 1
    ) melagingas ON true
         LEFT JOIN LATERAL (
    SELECT n."terminoPradzia" AS "nuo", n."itrauktasIki" AS "iki"
    FROM "vptJuodiejiSarasai"."tiekejai" n
    JOIN "vptJuodiejiSarasai"."sarasai" ns ON ns."id" = n."sarasoId"
    WHERE n."tiekejoJarKodas" = j."jarKodas"::text
      AND ns."kodas" = 'nepatikimi'
    ORDER BY (n."itrauktasIki" IS NULL) DESC, n."itrauktasIki" DESC, n."terminoPradzia" DESC
    LIMIT 1
    ) nepatikimas ON true

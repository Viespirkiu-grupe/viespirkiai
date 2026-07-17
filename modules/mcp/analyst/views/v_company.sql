CREATE OR REPLACE VIEW v_company AS
SELECT j."jarKodas"::text,
       j.pavadinimas,
       j.adresas,
       j."registravimoData",
       j."formosPavadinimas",
       j."statusoPavadinimas",
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
        FROM "teismoNuosprendziaiDalyviai" d
        WHERE d.kodas = j."jarKodas"::text)                                         AS "bylosSkaicius",
       (SELECT COUNT(*)
        FROM domenai d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                              AS "domenaiSkaicius",
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                                   AS "neskelbiamosDerybosSkaicius"
FROM "jarCsv" j
         LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM "sodraMonthly"
    WHERE "jarKodas" = j."jarKodas"::integer
    ORDER BY data DESC NULLS LAST
    LIMIT 1
    ) s ON true

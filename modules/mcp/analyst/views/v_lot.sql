-- A "lot" (pirkimo dalis) is one independently-competed slice of a
-- procurement notice; see
-- docs/indicators-story/procurement-number-clarification.md. Each row is a
-- distinct (pirkimoNumeris, daliesNumeris) pair reconstructed from
-- public.v_dalyviai.
--
-- "subjektoRaktas" is composed as saltinis || ':' || pirkimoNumeris || ':' ||
-- daliesNumeris.

CREATE OR REPLACE VIEW v_lot AS
SELECT (COALESCE(l.saltinis, 'unknown') || ':' || l."pirkimoNumeris" || ':' ||
        l."daliesNumeris") AS "subjektoRaktas",
       l.saltinis,
       l."pirkimoNumeris",
       l."daliesNumeris",
       l."pirkimoBudas",
       l."ataskaitosData"
FROM (
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                AS "daliesNumeris",
           -- 'cvpis' if pirkimoNumeris matches a numeric viesiejiPirkimai.pirkimoId;
           -- else 'cvpp' if it matches a cvppViesiejiPirkimai row with
           -- skelbimoTipas = 'Skelbimas apie pirkimą'; else NULL. Mirrors the
           -- precedence in v_pirkimas.sql.
           CASE
               WHEN d."pirkimoNumeris" ~ '^[0-9]+$'
                   AND EXISTS (SELECT 1
                               FROM "viesiejiPirkimai" vp
                               WHERE vp."pirkimoId" = d."pirkimoNumeris"::integer)
                   THEN 'cvpis'
               WHEN EXISTS (SELECT 1
                            FROM "cvppViesiejiPirkimai" c
                            WHERE c."pirkimoNumeris" = d."pirkimoNumeris"
                              AND c."skelbimoTipas" = 'Skelbimas apie pirkimą')
                   THEN 'cvpp'
           END                                             AS saltinis,
           -- EXISTS rather than a join: cvppViesiejiPirkimai is keyed by
           -- skelbimoKodas, so one pirkimoNumeris can match more than one row
           -- there.
           min(d."pirkimoBudas")                           AS "pirkimoBudas",
           max(d."ataskaitosData")                         AS "ataskaitosData"
    FROM public.v_dalyviai d
    GROUP BY 1, 2, 3
) l

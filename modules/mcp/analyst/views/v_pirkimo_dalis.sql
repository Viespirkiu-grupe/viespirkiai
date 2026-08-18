-- A "lot" (pirkimo dalis) is one independently-competed slice of a
-- procurement notice; see
-- docs/indicators-story/procurement-number-clarification.md. Each row is a
-- distinct (pirkimoNumeris, daliesNumeris) pair reconstructed from
-- public.v_dalyviai.
--
-- "subjektoRaktas" is composed as saltinis || ':' || pirkimoNumeris || ':' ||
-- daliesNumeris.
--
-- "daliesPavadinimas" is the lot's own name, as reported in section III.5 of
-- the ATN-1/PPA report (xlsxPPApirkimoDalys); NULL when that section wasn't
-- filled in or the lot number couldn't be matched.

CREATE OR REPLACE VIEW v_pirkimo_dalis AS
SELECT (COALESCE(l.saltinis, 'unknown') || ':' || l."pirkimoNumeris" || ':' ||
        l."daliesNumeris") AS "subjektoRaktas",
       l.saltinis,
       l."pirkimoNumeris",
       l."daliesNumeris",
       l."daliesPavadinimas",
       l."pirkimoBudas",
       l."ataskaitosData"
FROM (
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                AS "daliesNumeris",
           -- 'cvpis' if pirkimoNumeris matches a numeric viesiejiPirkimai.pirkimoId;
           -- else 'cvpp' if it matches a cvppViesiejiPirkimai row with
           -- skelbimoTipas = 'Skelbimas apie pirkimą'; else NULL. Mirrors the
           -- precedence in v_pirkimas.sql.
           -- Compared as text (as v_pirkimas.sql does), not cast to integer:
           -- real pirkimoNumeris values (e.g. 3782102904) overflow int4.
           CASE
               WHEN d."pirkimoNumeris" ~ '^[0-9]+$'
                   AND EXISTS (SELECT 1
                               FROM "viesiejiPirkimai" vp
                               WHERE vp."pirkimoId"::text = d."pirkimoNumeris")
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
           max(d."ataskaitosData")                         AS "ataskaitosData",
           -- xlsxPPApirkimoDalys carries the lot's own name (III.5 of the
           -- ATN-1/PPA report), keyed by ataskaitaId, not pirkimoNumeris --
           -- so this reaches it the same way the rest of this codebase links
           -- PPA data (see v_dalyviai.sql): a value match on
           -- pirkimoNumeris/daliesNumeris, not an FK.
           -- Wrapped in max() because it's constant within the group (a
           -- function of the two GROUP BY columns), not an aggregation choice.
           max((SELECT apd."daliesPavadinimas"
                FROM "xlsxPPAataskaitos" aa
                         JOIN "xlsxPPApirkimoDalys" apd ON apd."ataskaitaId" = aa.id
                WHERE aa."pirkimoNumeris" = d."pirkimoNumeris"
                  AND COALESCE(apd."daliesNumeris", '0') = COALESCE(d."daliesNumeris", '0')
                ORDER BY aa."sukurtaAt" DESC
                LIMIT 1))                                  AS "daliesPavadinimas"
    FROM public.v_dalyviai d
    GROUP BY 1, 2, 3
) l

-- Pirkimo dalis (lot) — one independently-competed slice of a procurement
-- notice. Each lot is judged and awarded on its own, so a competition measure
-- taken at procurement grain hides an uncompetitive lot inside a healthy
-- total; see docs/indicators-story/domain-model.md.
--
-- Grain: one row per (saltinis, pirkimoNumeris, daliesNumeris).
-- "subjektoRaktas" is saltinis || ':' || pirkimoNumeris || ':' || daliesNumeris.
--
-- A lot becomes known two independent ways, and this entity is the union of
-- both:
--
--   * "deklaruota" — the buyer declared the lot in the procurement notice.
--     Every lot of every notice-published procurement is known this way, with
--     its own name, whether or not anyone ever bid on it.
--   * "stebeta" — participants were observed competing in the lot, through a
--     procurement-procedure report (PPA). This is where bids, prices and
--     rejections come from, and it exists for far fewer procurements.
--
-- Keeping both, and stating which applies per row, is what lets an indicator
-- distinguish "this lot had one bidder" from "we have never seen this lot's
-- bidders". A declared lot with no observed participation is a real lot with
-- unknown competition, not a lot with no competition.

CREATE OR REPLACE VIEW v_pirkimo_dalis AS
WITH deklaruotos AS (
    -- Notice side: lots as published in the procurement notice. Only CVP IS
    -- carries a lot breakdown; the CVPP fallback has no equivalent table.
    SELECT vp."pirkimoId"::text            AS "pirkimoNumeris",
           d.numeris::text                 AS "daliesNumeris",
           d.pavadinimas                   AS "daliesPavadinimas",
           vp."pirkimoBudas",
           vp."paskelbimoData"::timestamp  AS "paskelbimoData"
    FROM "viesiejiPirkimaiDalys" d
             JOIN "viesiejiPirkimai" vp ON vp."pirkimoId" = d."pirkimoId"
    WHERE d.rusis = 'dalis'
      AND d.numeris IS NOT NULL
), stebetos AS (
    -- Participation side: lots reconstructed by grouping the observed bidders.
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0') AS "daliesNumeris",
           min(d."pirkimoBudas")            AS "pirkimoBudas",
           max(d."ataskaitosData")          AS "ataskaitosData",
           count(*)                         AS "dalyviuSkaicius",
           count(d."pasiulymoKaina")        AS "kainuSkaicius",
           count(d."atmetimoPriezastis")    AS "atmestuSkaicius"
    FROM public.v_dalyviai d
    GROUP BY 1, 2
), sujungta AS (
    SELECT COALESCE(dk."pirkimoNumeris", st."pirkimoNumeris")   AS "pirkimoNumeris",
           COALESCE(dk."daliesNumeris", st."daliesNumeris")     AS "daliesNumeris",
           dk."daliesPavadinimas",
           COALESCE(dk."pirkimoBudas", st."pirkimoBudas")       AS "pirkimoBudas",
           dk."paskelbimoData",
           st."ataskaitosData",
           (dk."pirkimoNumeris" IS NOT NULL)                    AS deklaruota,
           (st."pirkimoNumeris" IS NOT NULL)                    AS stebeta,
           st."dalyviuSkaicius",
           st."kainuSkaicius",
           st."atmestuSkaicius"
    FROM deklaruotos dk
             FULL OUTER JOIN stebetos st
                             ON st."pirkimoNumeris" = dk."pirkimoNumeris"
                                 AND st."daliesNumeris" = dk."daliesNumeris"
)
SELECT (COALESCE(l.saltinis, 'unknown') || ':' || l."pirkimoNumeris" || ':' ||
        l."daliesNumeris")           AS "subjektoRaktas",
       l.saltinis,
       l."pirkimoNumeris",
       l."daliesNumeris",
       l."daliesPavadinimas",
       l."pirkimoBudas",
       l."paskelbimoData",
       l."ataskaitosData",
       l.deklaruota,
       l.stebeta,
       l."dalyviuSkaicius",
       l."kainuSkaicius",
       l."atmestuSkaicius"
FROM (
    SELECT s.*,
           -- 'cvpis' if pirkimoNumeris matches a viesiejiPirkimai.pirkimoId;
           -- else 'cvpp' if it matches a cvppViesiejiPirkimai contract notice;
           -- else NULL. Mirrors the precedence in v_pirkimas.sql.
           -- Compared as text, not cast to integer: real pirkimoNumeris values
           -- (e.g. 3782102904) overflow int4.
           CASE
               WHEN s."pirkimoNumeris" ~ '^[0-9]+$'
                   AND EXISTS (SELECT 1
                               FROM "viesiejiPirkimai" vp
                               WHERE vp."pirkimoId"::text = s."pirkimoNumeris")
                   THEN 'cvpis'
               -- EXISTS rather than a join: cvppViesiejiPirkimai is keyed by
               -- skelbimoKodas, so one pirkimoNumeris can match more than one
               -- row there.
               WHEN EXISTS (SELECT 1
                            FROM "cvppViesiejiPirkimai" c
                            WHERE c."pirkimoNumeris" = s."pirkimoNumeris"
                              AND c."skelbimoTipas" = 'Skelbimas apie pirkimą')
                   THEN 'cvpp'
           END AS saltinis
    FROM sujungta s
) l

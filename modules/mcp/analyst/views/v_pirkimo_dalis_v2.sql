-- Risk service's own copy of v_pirkimo_dalis, isolated under a _v2 suffix so
-- the Procurement Reader (modules/risk/procurementReader.ts) never depends
-- on whatever the shared analyst v_pirkimo_dalis view happens to look like
-- at any given time. Same definition as v_pirkimo_dalis.sql, except its
-- "stebetos" CTE reads v_dalyviai_v2 instead of v_dalyviai, keeping the
-- whole risk-service view chain isolated end to end. Keep the two files in
-- sync by hand until the shared view is retired in favor of this one.
--
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

CREATE OR REPLACE VIEW v_pirkimo_dalis_v2 AS
WITH deklaruotos AS (
    -- Notice side: lots as published in the procurement notice. Only CVP IS
    -- carries a lot breakdown; the CVPP fallback has no equivalent table.
    SELECT vp."pirkimoId"::text            AS "pirkimoNumeris",
           d.numeris::text                 AS "daliesNumeris",
           d.pavadinimas                   AS "daliesPavadinimas",
           vp."pirkimoBudas",
           vp."paskelbimoData"::timestamp  AS "paskelbimoData"
    FROM "eppsViesiejiPirkimai"."dalys" d
             JOIN "eppsViesiejiPirkimai"."pirkimai" vp ON vp."pirkimoId" = d."pirkimoId"
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
    FROM public.v_dalyviai_v2 d
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
    -- 'cvpis' if pirkimoNumeris matches a viesiejiPirkimai.pirkimoId; else
    -- 'cvpp' if it matches a cvppViesiejiPirkimai contract notice; else NULL.
    -- Mirrors the precedence in v_pirkimas_v2.sql. Compared as text, not cast
    -- to integer: real pirkimoNumeris values (e.g. 3782102904) overflow int4.
    --
    -- LEFT JOIN to a DISTINCT key set rather than two EXISTS inside a CASE.
    -- Both spellings mean the same thing, but the CASE form is evaluated once
    -- per output column that reads it — "saltinis" and "subjektoRaktas" both
    -- do — and the planner emits a separate hashed SubPlan per evaluation, so
    -- cvppViesiejiPirkimai (121 MB) was seq-scanned twice per query and
    -- viesiejiPirkimai's key index scanned twice. As joins, each key set is
    -- built once. DISTINCT is what keeps this a join and not a row multiplier:
    -- cvppViesiejiPirkimai is keyed by skelbimoKodas, so one pirkimoNumeris
    -- can match more than one row there.
    SELECT s.*,
           CASE
               WHEN s."pirkimoNumeris" ~ '^[0-9]+$' AND cvpis."pirkimoNumeris" IS NOT NULL
                   THEN 'cvpis'
               WHEN cvpp."pirkimoNumeris" IS NOT NULL
                   THEN 'cvpp'
           END AS saltinis
    FROM sujungta s
             LEFT JOIN (SELECT DISTINCT vp."pirkimoId"::text AS "pirkimoNumeris"
                        FROM "eppsViesiejiPirkimai"."pirkimai" vp) cvpis
                       ON cvpis."pirkimoNumeris" = s."pirkimoNumeris"
             LEFT JOIN (SELECT DISTINCT c."pirkimoNumeris"
                        FROM cvpp."archyvoSkelbimai" c
                        WHERE c."skelbimoTipas" = 'Skelbimas apie pirkimą') cvpp
                       ON cvpp."pirkimoNumeris" = s."pirkimoNumeris"
) l

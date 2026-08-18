-- Dalyvių pora — two suppliers that have competed in the same lot, as a
-- subject in its own right.
--
-- Bid rotation, a recurrent winner among co-bidders, shared owners and common
-- control are all statements about a *pair of bidders*, not about either
-- company alone and not about any single procurement. Those indicators need
-- one durable subject per pair, carrying the pair's whole co-bidding history.
--
-- Grain: one row per unordered pair of supplier codes. The key is
-- order-independent by construction — "tiekejoKodasA" is always the
-- lexicographically smaller code — so the pair (X, Y) and the pair (Y, X) are
-- the same subject and cannot both exist.
--
-- Co-bidding is observed only where a lot's participants are known, so this
-- entity inherits the coverage of v_dalyviai exactly. A pair that never
-- appears here has not been shown to be independent; it has not been observed.
--
-- A pair exists only between two parties, so a participant whose recorded code
-- names no party at all — blank, or the sentinel '-' — forms no pair. That is
-- the only exclusion: codes are otherwise kept as recorded, including foreign
-- ones ('LV4000366589', '0629706-0') and messy ones. Dropping a row from a
-- domain entity asserts "this is not a subject", which is a much stronger
-- claim than "this code is hard to resolve"; the latter is a data-sufficiency
-- question and belongs to the indicator, not to the model.

CREATE OR REPLACE VIEW v_dalyviu_pora AS
WITH dalyviai AS (
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0') AS "daliesNumeris",
           d."tiekejoKodas",
           d."eileNumeris",
           d."pasiulymoKaina",
           d."atmetimoPriezastis",
           d."ataskaitosData"
    FROM public.v_dalyviai d
    WHERE d."tiekejoKodas" ~ '[A-Za-z0-9]'
), poros AS (
    SELECT least(a."tiekejoKodas", b."tiekejoKodas")    AS "tiekejoKodasA",
           greatest(a."tiekejoKodas", b."tiekejoKodas") AS "tiekejoKodasB",
           a."pirkimoNumeris",
           a."daliesNumeris",
           a."ataskaitosData",
           -- Laimėtoju laikomas pirmas pasiūlymų eilėje ir neatmestas
           -- dalyvis; NULL "eileNumeris" reiškia, kad eilė nežinoma, todėl
           -- toks dalyvis laimėtoju nelaikomas.
           (a."eileNumeris" = 1 AND a."atmetimoPriezastis" IS NULL) AS "aLaimejo",
           (b."eileNumeris" = 1 AND b."atmetimoPriezastis" IS NULL) AS "bLaimejo"
    FROM dalyviai a
             JOIN dalyviai b
                  ON b."pirkimoNumeris" = a."pirkimoNumeris"
                      AND b."daliesNumeris" = a."daliesNumeris"
                      AND a."tiekejoKodas" < b."tiekejoKodas"
)
SELECT p."tiekejoKodasA" || ':' || p."tiekejoKodasB" AS "porosRaktas",
       p."tiekejoKodasA",
       p."tiekejoKodasB",
       ja.pavadinimas                                 AS "tiekejasA",
       jb.pavadinimas                                 AS "tiekejasB",
       count(*)                                       AS "kartuDaliuSkaicius",
       count(DISTINCT p."pirkimoNumeris")             AS "kartuPirkimuSkaicius",
       count(*) FILTER (WHERE p."aLaimejo")           AS "laimejoA",
       count(*) FILTER (WHERE p."bLaimejo")           AS "laimejoB",
       count(*) FILTER (WHERE NOT p."aLaimejo" AND NOT p."bLaimejo")
                                                      AS "laimejoKitas",
       min(p."ataskaitosData")                        AS "pirmasKartas",
       max(p."ataskaitosData")                        AS "paskutinisKartas"
FROM poros p
         LEFT JOIN "jarAsmenys" ja ON ja."jarKodas"::text = p."tiekejoKodasA"
         LEFT JOIN "jarAsmenys" jb ON jb."jarKodas"::text = p."tiekejoKodasB"
GROUP BY 1, 2, 3, 4, 5

-- LT-COM-02 — Mažas dalyvių skaičius (low number of bidders): supplemental
-- participation facts, prefetched once per run (RelationFactsIndicator.prepare()).
-- See docs/indicators-story/risk-service-architecture-v2.md §1.
--
-- $1 data_as_of cutoff: filters d."ataskaitosData" <= $1.
-- $2 optional subject filter: d."pirkimoNumeris" = ANY($2::text[]), or NULL
--    for every pirkimoNumeris.
--
-- Subject identity now comes from the Lot the Procurement Reader already
-- loaded, not from this statement. totalBids counts every distinct
-- participant recorded for the lot, whether or not their bid was later
-- rejected (unlike LT-COM-01) — see public.v_dalyviai_v2.
--
-- One row per (pirkimoNumeris, daliesNumeris).
--
-- Columns left of AS are Lithuanian; aliases right of AS are English.

SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
       COALESCE(d."daliesNumeris", '0')                                              AS "daliesNumeris",
       min(d."pirkimoBudas")                                                         AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
       -- Rendered as ISO-8601 UTC text so the value does not depend on the
       -- session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
FROM public.v_dalyviai_v2 d
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0');

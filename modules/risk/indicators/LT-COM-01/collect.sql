-- LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid): supplemental
-- participation facts, prefetched once per run (RelationFactsIndicator.prepare()).
-- See docs/indicators-story/risk-service-architecture-v2.md §1.
--
-- $1 data_as_of cutoff: filters d."ataskaitosData" <= $1.
-- $2 optional subject filter: d."pirkimoNumeris" = ANY($2::text[]), or NULL
--    for every pirkimoNumeris.
--
-- Subject identity (subjectKey, procurementSource, procurementId) now comes
-- from the Lot the Procurement Reader already loaded, not from this
-- statement — it only supplies what v_pirkimo_dalis_v2's own dalyviuSkaicius/
-- atmestuSkaicius cannot give faithfully: a DISTINCT-tiekejoKodas count (see
-- v_pirkimo_dalis_v2.sql's stebetos CTE, which counts rows, not distinct
-- suppliers).
--
-- One row per (pirkimoNumeris, daliesNumeris). "Valid" bids exclude rows
-- present in the rejected-bids side of public.v_dalyviai_v2 (rejected/
-- withdrawn/not-invited).
--
-- Columns left of AS are Lithuanian; aliases right of AS are English.
    
SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
       COALESCE(d."daliesNumeris", '0')                                              AS "daliesNumeris",
       min(d."pirkimoBudas")                                                         AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
       count(DISTINCT d."tiekejoKodas") FILTER (WHERE d."atmetimoPriezastis" IS NULL)::int
                                                                                     AS "validBids",
       -- Rendered as ISO-8601 UTC text so the value does not depend on the
       -- session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
FROM public.v_dalyviai_v2 d
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0');

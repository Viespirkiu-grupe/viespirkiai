-- LT-COM-03 — Konsultuotas ar kviestas tik vienas tiekėjas (only one supplier
-- invited or consulted): supplemental cross-lot participation facts,
-- prefetched once per run (RelationFactsIndicator.prepare()). See
-- docs/indicators-story/risk-service-architecture-v2.md §1.
--
-- $1 data_as_of cutoff: filters d."ataskaitosData" <= $1.
-- $2 optional subject filter: d."pirkimoNumeris" = ANY($2::text[]), or NULL
--    for every pirkimoNumeris.
--
-- One row per "pirkimoNumeris" (all its lots' ATN-1 rows rolled into one
-- subject), unlike LT-COM-01/LT-COM-02, which group by lot. totalSuppliers
-- counts every distinct supplier recorded anywhere in the procurement,
-- whether or not their bid was later rejected, and regardless of which lot
-- they bid on — this cross-lot union is exactly why this indicator queries
-- public.v_dalyviai_v2 directly instead of deriving anything from
-- Procurement.lots (each Lot only knows its own participants).
--
-- Subject identity now comes from the ProcurementSubject the Procurement
-- Reader already loaded.
--
-- Columns left of AS are Lithuanian; aliases right of AS are English.

SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
       min(d."pirkimoBudas")                                                         AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                         AS "totalSuppliers",
       -- Rendered as ISO-8601 UTC text so the value does not depend on the
       -- session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                         AS "reportedAt"
FROM public.v_dalyviai_v2 d
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY d."pirkimoNumeris";

-- LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid): the facts.
-- See docs/indicators-story/risk-service-architecture.md §5.
--
-- $1 data_as_of cutoff: filters d."ataskaitosData" <= $1.
-- $2 optional subject filter: d."pirkimoNumeris" = ANY($2::text[]), or NULL
--    for every pirkimoNumeris.
--
-- One row per (pirkimoNumeris, daliesNumeris). "Valid" bids exclude rows
-- present in atn1atmestiPasiulymai (rejected/withdrawn/not-invited); see
-- public.v_dalyviai.
--
-- subjectKey, procurementSource, procurementId come from public.v_lot.
-- method and reportedAt are aggregated here from rows at or before $1,
-- rather than taken from v_lot's own (not cutoff-filtered) pirkimoBudas
-- and ataskaitosData.
--
-- Columns left of AS are Lithuanian; aliases right of AS are English.

SELECT l."subjektoRaktas"                                                            AS "subjectKey",
       l.saltinis                                                                    AS "procurementSource",
       l."pirkimoNumeris"                                                            AS "procurementId",
       min(d."pirkimoBudas")                                                         AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
       count(DISTINCT d."tiekejoKodas") FILTER (WHERE d."atmetimoPriezastis" IS NULL)::int
                                                                                     AS "validBids",
       -- Rendered as ISO-8601 UTC text so the value does not depend on the
       -- session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
FROM public.v_dalyviai d
         -- Inner join: v_lot's rows are built from v_dalyviai (v_lot.sql).
         JOIN public.v_lot l ON l."pirkimoNumeris" = d."pirkimoNumeris"
                            AND l."daliesNumeris" = COALESCE(d."daliesNumeris", '0')
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY l."subjektoRaktas", l.saltinis, l."pirkimoNumeris";

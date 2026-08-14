-- LT-COM-03 — Konsultuotas ar kviestas tik vienas tiekėjas (only one supplier
-- invited or consulted): the facts.
--
-- $1 data_as_of cutoff. An ATN-1 procedure-completion report recorded after
--    the cutoff is invisible to the run, which is what makes a rerun at an
--    earlier cutoff reproducible (risk-service-architecture.md §5).
-- $2 optional subject filter: an array of ATN-1 "pirkimoNumeris" values, or
--    NULL for a normal full run.
--
-- Unit of analysis is the procurement: one row per "pirkimoNumeris", rolling
-- every one of its lots' ATN-1 report rows into a single subject — unlike
-- LT-COM-01/LT-COM-02, which measure one lot at a time. totalSuppliers counts
-- every distinct supplier recorded anywhere in the procurement, whether or
-- not their bid was later rejected — this indicator measures how many
-- suppliers the buyer ever engaged, not the outcome of the evaluation — see
-- public.v_dalyviai.
--
-- This statement measures and does not judge: no state, no threshold, no
-- indicator identity. Those belong to rules.ts and the shared machinery.
-- Everything left of an AS is the ingestion schema's and stays Lithuanian;
-- everything right of it is the risk service's and is English.

SELECT (COALESCE(p.saltinis, 'unknown') || ':' || d."pirkimoNumeris")               AS "subjectKey",
       p.saltinis                                                                   AS "procurementSource",
       d."pirkimoNumeris"                                                           AS "procurementId",
       min(d."pirkimoBudas")                                                        AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                        AS "totalSuppliers",
       -- Rendered as ISO-8601 UTC text rather than left as a timestamptz: it
       -- ends up in `evidence`, and the writer compares evidence for equality,
       -- so it must not depend on the session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                         AS "reportedAt"
FROM public.v_dalyviai d
         LEFT JOIN public.v_pirkimas p ON p."pirkimoId" = d."pirkimoNumeris"
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY p.saltinis, d."pirkimoNumeris";

-- LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid).
-- $1 evaluation run id (unused: run_id is attached by the Risk Signals Writer)
-- $2 data_as_of cutoff (carried on every row; this indicator has no
--    deadline/time-window comparison of its own — an ATN-1 report either
--    exists or doesn't)
-- $3 effective parameter entries as of the cutoff (jsonb array)
-- $4 optional subject filter: an array of ATN-1 "pirkimoNumeris" values, or
--    NULL for a normal full run
--
-- Unit of analysis is the lot: one row per (pirkimoNumeris, daliesNumeris) in
-- the ATN-1 procedure-completion report. "Valid" means the participant is
-- absent from atn1atmestiPasiulymai (rejected/withdrawn/not-invited) for that
-- lot — see public.v_dalyviai.

WITH run AS (
    -- $1 has no other use in this indicator; cast it once so Postgres can
    -- infer its parameter type ("could not determine data type of parameter"
    -- otherwise).
    SELECT $1::bigint AS run_id
),
     lots AS (
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                                                AS "daliesNumeris",
           count(DISTINCT d."tiekejoKodas")                                                 AS total_bids,
           count(DISTINCT d."tiekejoKodas") FILTER (WHERE d."atmetimoPriezastis" IS NULL)   AS valid_bids,
           min(d."pirkimoBudas")                                                            AS pirkimo_budas,
           min(d."ataskaitosData")                                                          AS ataskaitos_data
    FROM public.v_dalyviai d
    WHERE ($4::text[] IS NULL OR d."pirkimoNumeris" = ANY ($4::text[]))
    GROUP BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0')
),
     matched AS (
         SELECT l.*,
                p.saltinis,
                pe.param_entry -> 'values'                  AS applied_parameters,
                pe.param_entry -> 'scope' -> 'methods'       AS method_scope
         FROM lots l
                  LEFT JOIN public.v_pirkimas p ON p."pirkimoId" = l."pirkimoNumeris"
                  LEFT JOIN LATERAL (
             SELECT entry.value AS param_entry
             FROM jsonb_array_elements($3::jsonb) AS entry(value)
             WHERE (entry.value -> 'scope' -> 'methods') IS NULL
                OR (entry.value -> 'scope' -> 'methods') ? l.pirkimo_budas
             LIMIT 1
             ) pe ON true
     ),
     classified AS (
         SELECT matched.*,
                CASE
                    WHEN saltinis IS NULL THEN 'insufficient_data'
                    WHEN method_scope IS NOT NULL AND NOT (method_scope ? pirkimo_budas) THEN 'not_applicable'
                    WHEN total_bids = 0 THEN 'insufficient_data'
                    WHEN valid_bids = 1 THEN 'triggered'
                    ELSE 'not_triggered'
                    END AS state
         FROM matched
     )
SELECT 'LT-COM-01'::text                                                       AS "indicatorId",
       1::integer                                                              AS "indicatorVersion",
       'lot'::text                                                             AS "subjectType",
       (COALESCE(saltinis, 'unknown') || ':' || "pirkimoNumeris" || ':' || "daliesNumeris") AS "subjectKey",
       saltinis                                                                AS "procurementSource",
       "pirkimoNumeris"                                                        AS "procurementId",
       state                                                                   AS "state",
       CASE
           WHEN state IN ('triggered', 'not_triggered')
               THEN jsonb_build_object('totalBids', total_bids, 'validBids', valid_bids)
           END                                                                 AS "rawValue",
       CASE
           WHEN state IN ('triggered', 'not_triggered') THEN jsonb_build_object('validBids', 1)
           END                                                                 AS "threshold",
       applied_parameters                                                      AS "appliedParameters",
       CASE
           WHEN state IN ('triggered', 'not_triggered') THEN jsonb_build_object(
                   'pirkimoBudas', pirkimo_budas,
                   'ataskaitosData', ataskaitos_data,
                   'source', 'ATN-1 ataskaita'
               )
           ELSE '{}'::jsonb
           END                                                                 AS "evidence",
       (CASE WHEN saltinis IS NULL THEN jsonb_build_array('procurementSource') ELSE '[]'::jsonb END)
                                                                                AS "missingData",
       $2::text                                                                AS "dataAsOf"
FROM classified;

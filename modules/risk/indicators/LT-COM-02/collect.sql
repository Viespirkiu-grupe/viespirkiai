-- LT-COM-02 — Mažas dalyvių skaičius (low number of bidders): the facts.
--
-- $1 data_as_of cutoff. An ATN-1 procedure-completion report recorded after
--    the cutoff is invisible to the run, which is what makes a rerun at an
--    earlier cutoff reproducible (risk-service-architecture.md §5).
-- $2 optional subject filter: an array of ATN-1 "pirkimoNumeris" values, or
--    NULL for a normal full run.
--
-- Unit of analysis is the lot: one row per (pirkimoNumeris, daliesNumeris) in
-- the ATN-1 report. totalBids counts every distinct participant recorded for
-- the lot, whether or not their bid was later rejected — this indicator
-- measures participation, not post-evaluation validity (that is LT-COM-01) —
-- see public.v_dalyviai.
--
-- Lot identity comes from public.v_lot, which is the single definition of what
-- a lot is called; spelling `subjectKey` by hand here in each of the 17
-- lot-grain indicators is how the same lot ends up with two keys that no longer
-- roll up. v_lot carries identity ONLY — no counts — because a measurement
-- shared across indicators could change what an already-reviewed
-- indicatorVersion computes without its version changing (§5).
--
-- Note what is NOT taken from v_lot: `method` and `reportedAt` are still
-- aggregated from the cutoff-filtered rows below. v_lot cannot see $1, so its
-- own pirkimoBudas/ataskaitosData summarise every report a lot ever had,
-- including ones after the cutoff. Reading them from there would quietly break
-- the rerun-reproducibility that $1 exists to provide.
--
-- This statement measures and does not judge: no state, no threshold, no
-- indicator identity. Those belong to rules.ts and the shared machinery.
-- Everything left of an AS is the ingestion schema's and stays Lithuanian;
-- everything right of it is the risk service's and is English.

SELECT l."subjektoRaktas"                                                            AS "subjectKey",
       l.saltinis                                                                    AS "procurementSource",
       l."pirkimoNumeris"                                                            AS "procurementId",
       min(d."pirkimoBudas")                                                         AS "method",
       count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
       -- Rendered as ISO-8601 UTC text rather than left as a timestamptz: it
       -- ends up in `evidence`, and the writer compares evidence for equality,
       -- so it must not depend on the session time zone.
       to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
FROM public.v_dalyviai d
         -- Inner join, not LEFT: v_lot is built from v_dalyviai, so every bid row
         -- has a lot. A lot whose notice has not been ingested still appears —
         -- v_lot gives it procurementSource NULL and an 'unknown:' key, and
         -- rules.ts turns that into insufficient_data rather than dropping it.
         JOIN public.v_lot l ON l."pirkimoNumeris" = d."pirkimoNumeris"
                            AND l."daliesNumeris" = COALESCE(d."daliesNumeris", '0')
WHERE d."ataskaitosData" <= $1::timestamptz
  AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
GROUP BY l."subjektoRaktas", l.saltinis, l."pirkimoNumeris";

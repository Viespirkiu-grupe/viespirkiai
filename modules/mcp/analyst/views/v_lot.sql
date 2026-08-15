-- One row per procurement lot: identity and provenance only, no measurements.
--
-- A "lot" (pirkimo dalis) is one independently-competed slice of a procurement
-- notice; see docs/indicators-story/procurement-number-clarification.md. It is
-- not a stored row anywhere — it is the distinct (pirkimoNumeris, daliesNumeris)
-- pairs that v_dalyviai can reconstruct from ATN-1 report detail.
--
-- WHY THIS VIEW EXISTS. `subjectKey` is the durable name a lot carries into
-- risk.risk_signals, and the catalogue lists 17 lot-grain indicators that must
-- all spell it the same way. Built by hand in each indicator's collect.sql it
-- would eventually drift, and a drifted key silently splits one lot into two
-- subjects that no longer roll up. Defining it once here is the point.
--
-- WHAT IS DELIBERATELY ABSENT. No bid counts, prices, or rejection totals.
-- Those are measurements, and each indicator's measurement is reviewed and
-- pinned to its indicatorVersion; hoisting them into a shared view would let an
-- edit here change what an already-reviewed indicator computes without its
-- version changing (risk-service-architecture.md §5). Indicators keep reading
-- bid-grain detail straight from v_dalyviai and aggregate it themselves.
--
-- Columns are Lithuanian, like every other view here. `subjektoRaktas` is the
-- composed lot identity; the risk service renames it to `subjectKey` in its own
-- collect.sql, which is exactly where that boundary belongs — those files
-- already state the rule that everything left of an AS is the ingestion
-- schema's and stays Lithuanian, everything right of it is English.

CREATE OR REPLACE VIEW v_lot AS
SELECT (COALESCE(l.saltinis, 'unknown') || ':' || l."pirkimoNumeris" || ':' ||
        l."daliesNumeris") AS "subjektoRaktas",
       l.saltinis,
       l."pirkimoNumeris",
       l."daliesNumeris",
       l."pirkimoBudas",
       l."ataskaitosData"
FROM (
    SELECT d."pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                AS "daliesNumeris",
           -- Which publication system the notice came from. This mirrors the
           -- precedence v_pirkimas applies (CVP IS wins; CVPP is the fallback,
           -- and only for 'Skelbimas apie pirkimą'). NULL when neither matches —
           -- an ATN-1 report can land before its notice finishes ingesting, and
           -- the indicators turn that into `insufficient_data` rather than a guess.
           --
           -- KEEP IN SYNC WITH v_pirkimas.sql. Resolving through v_pirkimas
           -- itself would be the DRY choice and was the first implementation,
           -- but that view exposes "pirkimoId" as p."pirkimoId"::text, so any
           -- predicate against it pushes down as ("pirkimoId")::text = $x — a
           -- cast on the column, which the integer index
           -- viesiejiPirkimai_pirkimoId_key cannot serve. Every lookup then
           -- seq-scans 264k rows: measured 89s for this view versus 8.4s here,
           -- against a 3.7s v_dalyviai floor. An expression index on
           -- viesiejiPirkimai (("pirkimoId")::text) would make the pushdown
           -- indexable and let this collapse back into a plain join on
           -- v_pirkimas, deleting the duplication below.
           CASE
               WHEN d."pirkimoNumeris" ~ '^[0-9]+$'
                   AND EXISTS (SELECT 1
                               FROM "viesiejiPirkimai" vp
                               WHERE vp."pirkimoId" = d."pirkimoNumeris"::integer)
                   THEN 'cvpis'
               WHEN EXISTS (SELECT 1
                            FROM "cvppViesiejiPirkimai" c
                            WHERE c."pirkimoNumeris" = d."pirkimoNumeris"
                              AND c."skelbimoTipas" = 'Skelbimas apie pirkimą')
                   THEN 'cvpp'
           END                                             AS saltinis,
           -- EXISTS rather than a join on either side: cvppViesiejiPirkimai is
           -- keyed by skelbimoKodas, so 45 procurement numbers carry more than
           -- one notice row, and joining them raw would multiply a lot's rows.
           -- No ATN-1 report reaches one of those 45 today, but that is a
           -- coverage accident, not a constraint — collapsing it here means no
           -- indicator can inherit the fan-out.
           min(d."pirkimoBudas")                           AS "pirkimoBudas",
           max(d."ataskaitosData")                         AS "ataskaitosData"
    FROM public.v_dalyviai d
    GROUP BY 1, 2, 3
) l

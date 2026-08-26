-- Risk service's own view, _v2-suffixed by the same convention as
-- v_pirkimas_v2/v_dalyviai_v2/v_pirkimo_dalis_v2/v_pirkimo_pabaiga_v2
-- (procurementPublicViews.ts's header explains why: applied fresh as a CTE
-- per query rather than persisted). Like v_pirkimo_pabaiga_v2, there is no
-- persisted non-_v2 counterpart to fork from at this narrow shape: the full
-- public.v_sutartys view (v_sutartys.sql) carries many more columns (BVPŽ
-- codes, company names, ...) LT-OTH-04 does not need, and forking that whole
-- shape here would be speculative work for a future Contract Risk Decision
-- Service indicator, not this one — so this reads "vpmSutartys" directly
-- instead, the same base table v_sutartys.sql itself reads for these
-- columns.
--
-- Pirkimo sutartys — every non-deleted, dated contract whose own
-- pirkimoNumeris plausibly names a real procurement (matches ^[0-9]+$, the
-- same guard v_pirkimo_dalis_v2.sql uses before trusting a pirkimoNumeris
-- value enough to test it against a cvpis notice — see
-- docs/indicators-story/domain-model.md §6.2's "dirty pirkimoNumeris"
-- warning). Grain: one row per contract (sutartiesUnikalusId).
--
-- pirkimoNumeris is a free-text field on the contract side and only
-- resolves to a real cvpis procurement for a documented minority of
-- contracts obliged to carry one (domain-model.md §5.2, "v_pirkimas →
-- v_sutartys": 28,367 of 466,358, 6.1%) — this view does not attempt to
-- validate the match against viesiejiPirkimai itself (unlike
-- v_pirkimo_dalis_v2's "saltinis" derivation), leaving that to the
-- Procurement Reader's own scoping (it only ever asks for pirkimoNumeris
-- values already known to be real procurements).

CREATE OR REPLACE VIEW v_pirkimo_sutartys_v2 AS
SELECT s."unikalusId"          AS "sutartiesUnikalusId",
       s."pirkimoNumeris"      AS "pirkimoNumeris",
       s."sudarymoData"::date  AS "sudarymoData"
FROM "vpmSutartys" s
WHERE s.istrinta IS NOT TRUE
  AND s."sudarymoData" IS NOT NULL
  AND s."pirkimoNumeris" ~ '^[0-9]+$'

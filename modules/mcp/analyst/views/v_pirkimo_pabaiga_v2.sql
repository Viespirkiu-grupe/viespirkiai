-- Risk service's own view, _v2-suffixed by the same convention as
-- v_pirkimas_v2/v_dalyviai_v2/v_pirkimo_dalis_v2 (procurementPublicViews.ts's
-- header explains why: applied fresh as a CTE per query rather than
-- persisted, since the query role has no CREATE privilege on `public`).
-- Unlike those three, there is no already-persisted non-_v2
-- "v_pirkimo_pabaiga" in the shared analyst schema this forks from or could
-- clash with — this entity is new — so no sibling file exists to keep in
-- sync. The _v2 suffix here means "not yet persisted", not "forked from an
-- existing view"; this is the definition that becomes the real view once it
-- is eventually persisted. Also unlike those three, it reads its base tables
-- directly and has no dependency on any other _v2 view.
--
-- Pirkimo procedūros pabaiga — one row per (pirkimas, dalis) procedure-ending
-- decision recorded in the ATN-1/PPA procedure report
-- (xlsxPPAataskaitos/xlsxPPAproceduruPabaiga).
--
-- Deliberately does NOT go through v_dalyviai_v2: that view only produces a
-- row when xlsxPPAdalyviai has a matching participant, so a procedure that
-- ended because no supplier submitted anything at all ("Per nustatytą
-- terminą tiekėjams nepateikus nė vienos paraiškos, pasiūlymo...") would
-- silently disappear — exactly the outcome this entity exists to keep.
-- Reading xlsxPPAataskaitos/xlsxPPAproceduruPabaiga directly avoids that.
--
-- Grain: one row per (pirkimoNumeris, daliesNumeris). "proceduruPabaiga" is
-- the report's own closed-vocabulary outcome label (one of a handful of
-- statutory phrasings, e.g. "Sudarius pirkimo sutartį..." for a concluded
-- contract, or one of several unsuccessful/terminated phrasings) — an
-- indicator matches against a short list of known labels, the same
-- convention v_dalyviai_v2's "atmetimoStatusas" already uses, never a
-- free-text pattern. "preliminariSutartis" (LT-PRI-06) and "pretenzijaPateikta"
-- (LT-TRA-07) are both procurement-level facts on the report itself, not
-- per-lot — carried on every row of this view so the reader's GROUP BY
-- pirkimoNumeris can bool_or() each across every lot and every report
-- revision. "sprendimoPriezastys" (LT-TRA-06) is the report's free-text
-- statement of why the lot's procedure ended the way it did.

CREATE OR REPLACE VIEW v_pirkimo_pabaiga_v2 AS
SELECT a."pirkimoNumeris"                    AS "pirkimoNumeris",
       COALESCE(pb."daliesNumeris", '0')     AS "daliesNumeris",
       a."sukurtaAt"                         AS "ataskaitosData",
       pb."proceduruPabaiga"                 AS "proceduruPabaiga",
       pb."sprendimoPriemimoData"            AS "sprendimoPriemimoData",
       pb."sprendimoPriezastys"              AS "sprendimoPriezastys",
       a."preliminariSutartis"               AS "preliminariSutartis",
       a."pretenzijaPateikta"                AS "pretenzijaPateikta"
FROM "xlsxPPAataskaitos" a
         JOIN "xlsxPPAproceduruPabaiga" pb ON pb."ataskaitaId" = a.id
WHERE pb."proceduruPabaiga" IS NOT NULL
  AND pb."proceduruPabaiga" != ''

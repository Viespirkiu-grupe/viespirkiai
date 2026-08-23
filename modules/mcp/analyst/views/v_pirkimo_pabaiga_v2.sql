-- Risk service's own copy of v_pirkimo_pabaiga, isolated under a _v2 suffix
-- so the Procurement Reader (modules/risk/procurementReader.ts) never
-- depends on whatever the shared analyst v_pirkimo_pabaiga view happens to
-- look like at any given time. Same definition as v_pirkimo_pabaiga.sql —
-- keep the two in sync by hand until the shared view is retired in favor of
-- this one. Unlike v_pirkimas_v2/v_dalyviai_v2/v_pirkimo_dalis_v2, this view
-- reads its base tables directly and has no dependency on any other _v2
-- view.
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
-- free-text pattern.

CREATE OR REPLACE VIEW v_pirkimo_pabaiga_v2 AS
SELECT a."pirkimoNumeris"                    AS "pirkimoNumeris",
       COALESCE(pb."daliesNumeris", '0')     AS "daliesNumeris",
       a."sukurtaAt"                         AS "ataskaitosData",
       pb."proceduruPabaiga"                 AS "proceduruPabaiga",
       pb."sprendimoPriemimoData"            AS "sprendimoPriemimoData"
FROM "xlsxPPAataskaitos" a
         JOIN "xlsxPPAproceduruPabaiga" pb ON pb."ataskaitaId" = a.id
WHERE pb."proceduruPabaiga" IS NOT NULL
  AND pb."proceduruPabaiga" != ''

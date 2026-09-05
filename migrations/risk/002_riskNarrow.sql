-- Schema `risk`, revision 2: narrow the fact tables, move everything that
-- repeats into lookup tables. 001_risk.sql is applied and holds live data, so
-- it is not edited — this file rebuilds on top of it.
--
-- Why (measured against production, 2026-09-05, 4 042 969 signal rows /
-- 1129 MB — 630 MB heap + 499 MB indexes):
--
--   * "subjectType", "threshold" and "appliedParameters" are functionally
--     dependent on "indicatorId" alone (no indicator has more than one
--     distinct value of any of the three), yet a ~110-byte jsonb parameter
--     blob was stored on every row that had one. -> risk."indicators" and
--     risk."parameterSets".
--   * "indicatorId" (26 values), "state" (4), "subjectType" (5) and
--     "procurementSource" (2) were plain text repeated per row. Lookup
--     tables, not enums: every one of these sets grows, and a lookup row can
--     be added or renamed without ALTER TYPE rewriting a 4M-row table.
--   * "subjectKey" repeated the parent decision's own natural key on every
--     row (verified: 0 procurement-subject rows differ from
--     "procurementSource":"procurementId"). Now stored with that prefix
--     stripped — '' for a procurement, '<dalis>' for a lot,
--     '<dalis>:<tiekejoKodas>' for a bid.
--   * "missingData" was text[] NOT NULL DEFAULT '{}', so 3 205 594 rows paid
--     for an empty array. Now smallint[] into risk."missingFields", NULL when
--     there is nothing missing.
--   * "createdAt" per signal duplicated the parent's "updatedAt" (signals are
--     only ever replaced wholesale). Dropped.
--   * "signalsIndicatorStateIdx" was 212 MB with idx_scan = 0. Replaced by a
--     partial index over triggered signals only (~34k rows).
--   * risk."vProcurementSummaries" aggregated all 4M rows with
--     array_agg(DISTINCT ...) per read. The counts are now maintained on the
--     decisions row by the Decision Writer, in the same transaction.
--
-- Expected result: ~320 MB for risk."signals", measured by building the same
-- projection over a 5% sample. All four states are still stored (dropping
-- 'not_applicable' would have reached ~133 MB but makes "evaluated and not
-- applicable" derived rather than recorded — deliberately not done).
--
-- Note: 'cvpis' becomes 'cvpIs' inside the `risk` schema only, to follow the
-- repo's camelCase convention. The analyst views (v_pirkimas_v2.sql and
-- friends) and the MCP contract still emit 'cvpis' as `saltinis`; the risk
-- boundary maps between them (services/procurement-risk/lookups.ts).
--
-- Runs as one transaction, so old and new tables coexist at peak (~1.5 GB).

BEGIN;

-- Both are USERSET and scoped to this transaction. The 4M-row load sorts once
-- for the primary key and hash-aggregates a few times over the old table;
-- the default 4 MB work_mem turns every one of those into an external merge.
SET LOCAL maintenance_work_mem = '2GB';
SET LOCAL work_mem = '512MB';

-- 1. Lookup tables ---------------------------------------------------------
--
-- Each is (id, code): a small, growable dictionary the fact tables reference
-- by smallint. `code` is the value the application layer speaks.

CREATE TABLE risk."procurementSources" (
    "id"    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "code"  text NOT NULL UNIQUE
);

-- 'unknown' is a real value, not a placeholder: riskDecisionEngine.ts uses it
-- when a procurement carries no `saltinis`.
INSERT INTO risk."procurementSources" ("code") VALUES ('cvpIs'), ('cvpp'), ('unknown');

CREATE TABLE risk."subjectTypes" (
    "id"    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "code"  text NOT NULL UNIQUE
);

INSERT INTO risk."subjectTypes" ("code")
VALUES ('procurement'), ('lot'), ('bid'), ('contract'), ('supplier');

CREATE TABLE risk."signalStates" (
    "id"    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "code"  text NOT NULL UNIQUE
);

-- 'calculation_error' is in types.ts's SignalState but was rejected by
-- 001_risk.sql's CHECK; seeded here so the union is representable.
INSERT INTO risk."signalStates" ("code")
VALUES ('triggered'), ('not_triggered'), ('insufficient_data'),
       ('not_applicable'), ('calculation_error');

-- Field names an indicator reports as missing. Grows with the indicators, so
-- the Decision Writer inserts unseen codes on the fly.
CREATE TABLE risk."missingFields" (
    "id"    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "code"  text NOT NULL UNIQUE
);

INSERT INTO risk."missingFields" ("code")
SELECT DISTINCT unnest("missingData") FROM risk."signals" WHERE "missingData" <> '{}' ORDER BY 1;

-- 2. Indicator and parameter dictionaries ----------------------------------
--
-- One row per deployed (code, version). "subjectType" lives here rather than
-- on the signal because it never varies within an indicator.

CREATE TABLE risk."indicators" (
    "id"           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "code"         text NOT NULL,
    "version"      smallint NOT NULL,
    "subjectType"  smallint NOT NULL REFERENCES risk."subjectTypes" ("id"),

    UNIQUE ("code", "version")
);

INSERT INTO risk."indicators" ("code", "version", "subjectType")
SELECT DISTINCT s."indicatorId", s."indicatorVersion"::smallint, st."id"
FROM risk."signals" s
         JOIN risk."subjectTypes" st ON st."code" = s."subjectType"
ORDER BY 1, 2;

-- The (threshold, appliedParameters) pair a signal was evaluated against.
-- Deliberately NOT folded into risk."indicators": parameters can be retuned
-- without a version bump, and a stored signal must keep pointing at the pair
-- that actually produced it. 25 distinct pairs across 4M signals today.
--
-- NULLS NOT DISTINCT so a wholly-NULL pair could only ever exist once; in
-- practice a signal with no parameters stores NULL in "parameterSet" instead.
CREATE TABLE risk."parameterSets" (
    "id"                 smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "threshold"          jsonb,
    "appliedParameters"  jsonb,

    UNIQUE NULLS NOT DISTINCT ("threshold", "appliedParameters")
);

-- The two columns are null together or not at all (verified across all
-- 4 042 969 rows), so the non-null subset is the whole dictionary.
--
-- DISTINCT ON the indicator rather than DISTINCT on the jsonb pair: the pair
-- is unique within an indicator (verified), so this sorts 396k rows by
-- (text, int) instead of hashing 396k jsonb values. ON CONFLICT covers the
-- case of two indicators sharing one parameter set.
INSERT INTO risk."parameterSets" ("threshold", "appliedParameters")
SELECT DISTINCT ON ("indicatorId", "indicatorVersion") "threshold", "appliedParameters"
FROM risk."signals"
WHERE "threshold" IS NOT NULL OR "appliedParameters" IS NOT NULL
ORDER BY "indicatorId", "indicatorVersion"
ON CONFLICT DO NOTHING;

-- 3. Rebuilt decisions table -----------------------------------------------
--
-- "id" narrows bigint -> int (max today: 265 616). That is worth far more on
-- risk."signals"' 4M-row FK column than it is here. The summary counters are
-- maintained by the Decision Writer in the same transaction as the signals
-- they describe; max signals for one procurement is 1524, so smallint holds.

CREATE TABLE risk."procurementDecisionsNew" (
    "id"                     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "source"                 smallint NOT NULL REFERENCES risk."procurementSources" ("id"),
    "procurementId"          text NOT NULL,
    "dataAsOf"               timestamptz NOT NULL,

    "triggeredCount"         smallint NOT NULL DEFAULT 0,
    "notTriggeredCount"      smallint NOT NULL DEFAULT 0,
    "insufficientDataCount"  smallint NOT NULL DEFAULT 0,
    "notApplicableCount"     smallint NOT NULL DEFAULT 0,
    "triggeredIndicators"    smallint[] NOT NULL DEFAULT '{}',

    "createdAt"              timestamptz NOT NULL DEFAULT now(),
    "updatedAt"              timestamptz NOT NULL DEFAULT now(),

    -- Temporary name: the old table still holds "procurementDecisionsNaturalKey"
    -- at this point, and a UNIQUE constraint's backing index shares one
    -- per-schema namespace with it. Renamed to the real name after the swap (§6).
    CONSTRAINT "procurementDecisionsNaturalKeyNew" UNIQUE ("source", "procurementId")
);

INSERT INTO risk."procurementDecisionsNew"
    ("id", "source", "procurementId", "dataAsOf", "createdAt", "updatedAt")
OVERRIDING SYSTEM VALUE
SELECT d."id"::int, ps."id", d."procurementId", d."dataAsOf", d."createdAt", d."updatedAt"
FROM risk."procurementDecisions" d
         JOIN risk."procurementSources" ps
              ON ps."code" = CASE d."procurementSource" WHEN 'cvpis' THEN 'cvpIs' ELSE d."procurementSource" END;

SELECT setval(pg_get_serial_sequence('risk."procurementDecisionsNew"', 'id'),
              coalesce((SELECT max("id") FROM risk."procurementDecisionsNew"), 0) + 1,
              false);

-- 4. Rebuilt signals table -------------------------------------------------

-- Deliberately created bare: no primary key and, above all, no FOREIGN KEY
-- clauses. A foreign key declared up front fires a per-row trigger during the
-- load, which for 4M rows across four references is ~16M individual index
-- probes and is what makes the naive version of this migration take half an
-- hour. The same constraints are added after the load (§4b), where each is
-- validated by a single join.
CREATE TABLE risk."signalsNew" (
    "decisionId"    int NOT NULL,
    "indicator"     smallint NOT NULL,
    "state"         smallint NOT NULL,
    "parameterSet"  smallint,

    -- Prefixless: '' (procurement), '<dalis>' (lot), '<dalis>:<tiekejoKodas>'
    -- (bid). The parent row supplies the source and procurement id.
    "subjectKey"    text NOT NULL,
    "rawValue"      jsonb,
    -- NULL, not '{}', when nothing is missing. No FK is possible on array
    -- elements; risk."missingFields" is the intended referent.
    "missingData"   smallint[]
);

-- The (threshold, appliedParameters) pair a signal carries is unique within
-- its indicator, so the parameter set can be reached through a smallint join
-- instead of comparing jsonb 4M times. 26 rows.
CREATE TEMP TABLE "indicatorParameterSet" ON COMMIT DROP AS
SELECT i."id" AS "indicator", p."id" AS "parameterSet"
FROM (
    SELECT DISTINCT ON ("indicatorId", "indicatorVersion")
           "indicatorId", "indicatorVersion", "threshold", "appliedParameters"
    FROM risk."signals"
    WHERE "threshold" IS NOT NULL OR "appliedParameters" IS NOT NULL
    ORDER BY "indicatorId", "indicatorVersion"
) t
         JOIN risk."indicators" i ON i."code" = t."indicatorId" AND i."version" = t."indicatorVersion"
         JOIN risk."parameterSets" p
              ON p."threshold" IS NOT DISTINCT FROM t."threshold"
                  AND p."appliedParameters" IS NOT DISTINCT FROM t."appliedParameters";

-- The prefix is everything up to and including the second colon, whatever the
-- source is spelled like — so this survives the 'cvpis' -> 'cvpIs' rename and
-- the 18 bid keys whose tiekejoKodas itself contains a colon.
INSERT INTO risk."signalsNew"
    ("decisionId", "indicator", "state", "parameterSet", "subjectKey", "rawValue", "missingData")
SELECT s."decisionId"::int,
       i."id",
       st."id",
       ips."parameterSet",
       regexp_replace(s."subjectKey", '^[^:]*:[^:]*:?', ''),
       s."rawValue",
       CASE WHEN s."missingData" = '{}' THEN NULL ELSE (
           SELECT array_agg(mf."id" ORDER BY u.ord)
           FROM unnest(s."missingData") WITH ORDINALITY AS u(code, ord)
                    JOIN risk."missingFields" mf ON mf."code" = u.code
       ) END
FROM risk."signals" s
         JOIN risk."indicators" i
              ON i."code" = s."indicatorId" AND i."version" = s."indicatorVersion"
         JOIN risk."signalStates" st ON st."code" = s."state"
         -- Gated on the signal actually having parameters: an indicator that
         -- owns a parameter set still emits parameterless signals
         -- (insufficient_data, not_applicable), which must store NULL here.
         LEFT JOIN "indicatorParameterSet" ips
              ON ips."indicator" = i."id" AND s."threshold" IS NOT NULL;

-- 4b. Constraints and indexes, all after the load ---------------------------
--
-- One sort for the key, and one join per foreign key, instead of an index
-- insert and four trigger fires per row.

ALTER TABLE risk."signalsNew"
    ADD CONSTRAINT "signalsPkey" PRIMARY KEY ("decisionId", "indicator", "subjectKey");

ALTER TABLE risk."signalsNew"
    ADD CONSTRAINT "signalsDecisionFk" FOREIGN KEY ("decisionId")
        REFERENCES risk."procurementDecisionsNew" ("id") ON DELETE CASCADE,
    ADD CONSTRAINT "signalsIndicatorFk" FOREIGN KEY ("indicator")
        REFERENCES risk."indicators" ("id"),
    ADD CONSTRAINT "signalsStateFk" FOREIGN KEY ("state")
        REFERENCES risk."signalStates" ("id"),
    ADD CONSTRAINT "signalsParameterSetFk" FOREIGN KEY ("parameterSet")
        REFERENCES risk."parameterSets" ("id");

-- The only list-side read: which procurements a given indicator triggered.
-- Partial, so it covers ~34k rows instead of all 4M.
--
-- An index predicate may not contain a subquery, so the 'triggered' id has to
-- be baked in as a literal. Looked up here rather than hard-coded, and stable
-- afterwards because a lookup row's id never changes.
DO $$
DECLARE
    "triggeredId" smallint := (SELECT "id" FROM risk."signalStates" WHERE "code" = 'triggered');
BEGIN
    EXECUTE format(
        'CREATE INDEX "signalsTriggeredByIndicatorIdx" ON risk."signalsNew" ("indicator") '
        'INCLUDE ("decisionId") WHERE "state" = %s', "triggeredId");
END $$;

-- 5. Backfill the decision counters ----------------------------------------
--
-- The table was created in this transaction, so it has no statistics at all
-- and the planner would size the aggregate below off a default guess.

ANALYZE risk."signalsNew";


UPDATE risk."procurementDecisionsNew" d
SET "triggeredCount"        = c."triggered",
    "notTriggeredCount"     = c."notTriggered",
    "insufficientDataCount" = c."insufficientData",
    "notApplicableCount"    = c."notApplicable",
    "triggeredIndicators"   = c."triggeredIndicators"
FROM (
    SELECT s."decisionId",
           count(*) FILTER (WHERE st."code" = 'triggered')::smallint         AS "triggered",
           count(*) FILTER (WHERE st."code" = 'not_triggered')::smallint     AS "notTriggered",
           count(*) FILTER (WHERE st."code" = 'insufficient_data')::smallint AS "insufficientData",
           count(*) FILTER (WHERE st."code" = 'not_applicable')::smallint    AS "notApplicable",
           coalesce(array_agg(DISTINCT s."indicator") FILTER (WHERE st."code" = 'triggered'), '{}'::smallint[]) AS "triggeredIndicators"
    FROM risk."signalsNew" s
             JOIN risk."signalStates" st ON st."id" = s."state"
    GROUP BY s."decisionId"
) c
WHERE d."id" = c."decisionId";

-- 6. Swap ------------------------------------------------------------------

DROP VIEW risk."vProcurementSummaries";
DROP TABLE risk."signals";
DROP TABLE risk."procurementDecisions";

ALTER TABLE risk."signalsNew" RENAME TO "signals";
ALTER TABLE risk."procurementDecisionsNew" RENAME TO "procurementDecisions";

-- Now that the old table is gone, the names it held are free again.
ALTER TABLE risk."procurementDecisions"
    RENAME CONSTRAINT "procurementDecisionsNaturalKeyNew" TO "procurementDecisionsNaturalKey";
ALTER INDEX risk."procurementDecisionsNew_pkey" RENAME TO "procurementDecisions_pkey";
ALTER TABLE risk."signals" RENAME CONSTRAINT "signalsPkey" TO "signals_pkey";

-- Freshness listings; unused as of this migration (idx_scan = 0 on its
-- predecessor) but kept — it is 4 MB and the operator listing is planned.
CREATE INDEX "procurementDecisionsUpdatedAtIdx"
    ON risk."procurementDecisions" ("updatedAt" DESC);

-- 7. Read-path view --------------------------------------------------------
--
-- Now a projection of stored counters rather than an aggregate over every
-- signal. "triggeredIndicators" is exposed as indicator codes, which is what
-- the caller wants; the stored form is smallint ids.

CREATE VIEW risk."vProcurementSummaries" AS
SELECT ps."code"                                             AS "procurementSource",
       d."procurementId",
       d."triggeredCount",
       d."insufficientDataCount",
       d."notApplicableCount",
       d."triggeredCount" + d."notTriggeredCount"
           + d."insufficientDataCount" + d."notApplicableCount" AS "evaluatedCount",
       ARRAY(SELECT i."code" FROM risk."indicators" i
             WHERE i."id" = ANY (d."triggeredIndicators") ORDER BY i."code") AS "triggeredIndicators",
       d."updatedAt"
FROM risk."procurementDecisions" d
         JOIN risk."procurementSources" ps ON ps."id" = d."source";

COMMIT;

ANALYZE risk."signals";
ANALYZE risk."procurementDecisions";

-- Schema `risk`: risk signals and decisions for public procurement, plus the
-- roles/grants that read and write it. Flattened (2026-09) from what was
-- originally six incremental migrations (001-006) once no risk data existed
-- anywhere worth preserving through an upgrade path — this is the schema
-- those migrations converged to, created directly. See
-- docs/indicators-story/risk-service-architecture.md §2.4 for the design
-- these tables implement.
--
-- Identifiers follow the repo's camelCase convention (as in ppa."dalyviai",
-- "eppsViesiejiPirkimai"."pirkimai"), so every table, column, view and index
-- name below is quoted. Table names carry no `risk` prefix — the schema
-- already says that.
--
-- Per repo convention (docs/indicators-story/risk-indicator-implementation-
-- plan.md), this file is not edited in place once risk data exists — the
-- next schema change is a new migration, 002_<name>.sql.

CREATE SCHEMA IF NOT EXISTS risk;

-- 1. Roles -------------------------------------------------------------------
--
-- `risk_calc` is intentionally NOT created here: the risk schema lives in the
-- main database alongside the `public` canonical facts, and both reads and
-- writes currently go through the application's own pool
-- (postgres/postgres.js). Splitting the read side onto a dedicated read-only
-- role is a follow-up.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'risk_rw') THEN
        CREATE ROLE risk_rw LOGIN PASSWORD 'risk_rw';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'risk_ro') THEN
        CREATE ROLE risk_ro LOGIN PASSWORD 'risk_ro';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA risk TO risk_rw, risk_ro;

-- 2. Procurement risk decisions -------------------------------------------
--
-- Current-state, not a snapshot: one row per procurement, refreshed in place
-- by INSERT ... ON CONFLICT DO UPDATE on the natural key below — metadata
-- only, no signals (those live in "signals", §3).

CREATE TABLE risk."procurementDecisions" (
    "id"                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "procurementSource"  text NOT NULL,
    "procurementId"      text NOT NULL,
    "dataAsOf"           timestamptz NOT NULL,
    "createdAt"          timestamptz NOT NULL DEFAULT now(),
    "updatedAt"          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "procurementDecisionsNaturalKey"
        UNIQUE ("procurementSource", "procurementId")
);

-- Freshness listings.
CREATE INDEX "procurementDecisionsUpdatedAtIdx"
    ON risk."procurementDecisions" ("updatedAt" DESC);

-- 3. Risk signals -----------------------------------------------------------
--
-- Current-state, one row per signal, linked to its procurement only via
-- "decisionId" (surrogate FK) — no "dataAsOf" column (that cutoff lives once
-- on the parent "procurementDecisions" row). A refresh DELETEs a
-- procurement's rows here and INSERTs the freshly evaluated set; never
-- UPDATEd.

CREATE TABLE risk."signals" (
    "decisionId"         bigint NOT NULL REFERENCES risk."procurementDecisions" ("id") ON DELETE CASCADE,

    "indicatorId"        text NOT NULL,
    "indicatorVersion"   integer NOT NULL,
    "subjectType"        text NOT NULL,
    "subjectKey"         text NOT NULL,

    "state"              text NOT NULL,
    "rawValue"           jsonb,
    "threshold"          jsonb,
    "appliedParameters"  jsonb,
    "missingData"        text[] NOT NULL DEFAULT '{}',

    "createdAt"          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "signalsSubjectTypeCheck"
        CHECK ("subjectType" IN ('procurement', 'lot', 'bid', 'contract', 'supplier')),
    CONSTRAINT "signalsStateCheck"
        CHECK ("state" IN ('triggered', 'not_triggered', 'insufficient_data', 'not_applicable')),

    -- One signal per indicator version per subject per procurement; also the
    -- FK access path — "all signals for this procurement" (the GUI's main
    -- read) leads with "decisionId".
    PRIMARY KEY ("decisionId", "indicatorId", "indicatorVersion", "subjectType", "subjectKey")
);

-- List filters: which procurements a given indicator triggered. INCLUDE
-- carries the only column that read needs afterwards, so it stays index-only
-- instead of touching the heap once per matching signal.
CREATE INDEX "signalsIndicatorStateIdx"
    ON risk."signals" ("indicatorId", "state") INCLUDE ("decisionId");

-- 4. Read-path views -----------------------------------------------------------

-- List-page read model: per-procurement summary computed from that row's own
-- "signals". Grouped by the decisions row's primary key — the other d.*
-- columns are functionally dependent on it, so Postgres allows selecting them
-- without repeating them as grouping keys, and hashes one bigint per group
-- instead of four wider columns.
CREATE VIEW risk."vProcurementSummaries" AS
SELECT d."procurementSource",
       d."procurementId",
       count(*) FILTER (WHERE s."state" = 'triggered')         AS "triggeredCount",
       count(*) FILTER (WHERE s."state" = 'insufficient_data') AS "insufficientDataCount",
       count(*) FILTER (WHERE s."state" = 'not_applicable')    AS "notApplicableCount",
       count(*)                                                AS "evaluatedCount",
       array_agg(DISTINCT s."indicatorId")
           FILTER (WHERE s."state" = 'triggered')              AS "triggeredIndicators",
       d."updatedAt"
FROM risk."procurementDecisions" d
         JOIN risk."signals" s ON s."decisionId" = d."id"
GROUP BY d."id";

-- 5. Grants -------------------------------------------------------------------
--
-- risk_rw: Process 2, recording results — INSERT/UPDATE on the upsert
-- tables; SELECT, INSERT, DELETE on "signals" (wiped and reinserted per
-- procurement, never edited — no UPDATE grant, and nothing to retain/expire).
-- risk_ro: Process 3, read-only visualisation.

GRANT SELECT, INSERT, UPDATE ON risk."procurementDecisions" TO risk_rw;
GRANT SELECT, INSERT, DELETE ON risk."signals" TO risk_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA risk TO risk_rw;
GRANT SELECT ON risk."vProcurementSummaries" TO risk_rw;

GRANT SELECT ON risk."procurementDecisions", risk."signals" TO risk_ro;
GRANT SELECT ON risk."vProcurementSummaries" TO risk_ro;

-- Schema `risk`: risk signals and decisions for public procurement, plus the
-- roles/grants that read and write it. Flattened (2026-09) from what was
-- originally six incremental migrations (001-006) once no risk data existed
-- anywhere worth preserving through an upgrade path — this is the schema
-- those migrations converged to, created directly. See
-- docs/indicators-story/risk-service-architecture.md §2.4 for the design
-- these tables implement.
--
-- Per repo convention (docs/indicators-story/risk-indicator-implementation-
-- plan.md), this file is not edited in place once risk data exists — the
-- next schema change is a new migration, 002_<name>.sql.

CREATE SCHEMA IF NOT EXISTS risk;

-- 1. Roles -------------------------------------------------------------------
--
-- `risk_calc` is intentionally NOT created here: this local database holds
-- only the `risk` schema (no `public` canonical facts), so calculation reads
-- go through the existing pool against the real database instead. See the
-- comment in postgres/riskDb.js.

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

-- 2. Evaluation runs -----------------------------------------------------

CREATE TABLE risk.risk_evaluation_runs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data_as_of   timestamptz NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text NOT NULL,
    statistics   jsonb,
    error        text,
    CONSTRAINT risk_evaluation_runs_status_check
        CHECK (status IN ('running', 'succeeded', 'partial', 'failed'))
);

CREATE INDEX risk_evaluation_runs_latest_idx
    ON risk.risk_evaluation_runs (started_at DESC);

-- Invariant: at most one open run.
CREATE UNIQUE INDEX risk_evaluation_runs_single_active_idx
    ON risk.risk_evaluation_runs ((status)) WHERE status = 'running';

-- 3. Procurement risk decisions -------------------------------------------
--
-- Current-state, not a snapshot: one row per procurement, refreshed in place
-- by INSERT ... ON CONFLICT DO UPDATE on the natural key below — metadata
-- only, no signals (those live in risk_signals, §4).

CREATE TABLE risk.risk_procurement_decisions (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    procurement_source text NOT NULL,
    procurement_id     text NOT NULL,
    run_id             bigint NOT NULL REFERENCES risk.risk_evaluation_runs (id),
    data_as_of         timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT risk_procurement_decisions_natural_key
        UNIQUE (procurement_source, procurement_id)
);

-- "What did run N touch"; FK maintenance.
CREATE INDEX risk_procurement_decisions_run_id_idx
    ON risk.risk_procurement_decisions (run_id);

-- Freshness listings.
CREATE INDEX risk_procurement_decisions_updated_at_idx
    ON risk.risk_procurement_decisions (updated_at DESC);

-- 4. Risk signals -------------------------------------------------------------
--
-- Current-state, one row per signal, linked to its procurement only via
-- decision_id (surrogate FK) — no run_id, no data_as_of column (that cutoff
-- lives once on the parent risk_procurement_decisions row). A refresh
-- DELETEs a procurement's rows here and INSERTs the freshly evaluated set;
-- never UPDATEd.

CREATE TABLE risk.risk_signals (
    decision_id         bigint NOT NULL REFERENCES risk.risk_procurement_decisions (id) ON DELETE CASCADE,

    indicator_id        text NOT NULL,
    indicator_version   integer NOT NULL,
    subject_type        text NOT NULL,
    subject_key         text NOT NULL,

    state                text NOT NULL,
    raw_value            jsonb,
    threshold            jsonb,
    applied_parameters   jsonb,
    missing_data         text[] NOT NULL DEFAULT '{}',

    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT risk_signals_subject_type_check
        CHECK (subject_type IN ('procurement', 'lot', 'bid', 'contract', 'supplier')),
    CONSTRAINT risk_signals_state_check
        CHECK (state IN ('triggered', 'not_triggered', 'insufficient_data', 'not_applicable')),

    -- One signal per indicator version per subject per procurement; also the
    -- FK access path — "all signals for this procurement" (the GUI's main
    -- read) leads with decision_id.
    PRIMARY KEY (decision_id, indicator_id, indicator_version, subject_type, subject_key)
);

-- List filters: which procurements a given indicator triggered.
CREATE INDEX risk_signals_indicator_state_idx
    ON risk.risk_signals (indicator_id, state);

-- 5. Read-path views -----------------------------------------------------------

-- One definition of "the current run", so the read model and the
-- application cannot disagree about provenance. Not a read filter — every
-- risk_procurement_decisions row is already current under the upsert model.
CREATE VIEW risk.v_latest_run AS
SELECT *
FROM risk.risk_evaluation_runs
WHERE status IN ('succeeded', 'partial')
ORDER BY started_at DESC
LIMIT 1;

-- List-page read model: per-procurement summary computed from that row's own
-- risk_signals.
CREATE VIEW risk.v_procurement_summaries AS
SELECT d.procurement_source,
       d.procurement_id,
       count(*) FILTER (WHERE s.state = 'triggered')          AS triggered_count,
       count(*) FILTER (WHERE s.state = 'insufficient_data')  AS insufficient_data_count,
       count(*) FILTER (WHERE s.state = 'not_applicable')     AS not_applicable_count,
       count(*)                                                AS evaluated_count,
       array_agg(DISTINCT s.indicator_id)
           FILTER (WHERE s.state = 'triggered')                AS triggered_indicators,
       d.run_id,
       d.updated_at
FROM risk.risk_procurement_decisions d
         JOIN risk.risk_signals s ON s.decision_id = d.id
GROUP BY d.procurement_source, d.procurement_id, d.run_id, d.updated_at;

-- 6. Grants -------------------------------------------------------------------
--
-- risk_rw: Process 2, recording results — INSERT/UPDATE on the upsert
-- tables; SELECT, INSERT, DELETE on risk_signals (wiped and reinserted per
-- procurement, never edited — no UPDATE grant, and nothing to retain/expire).
-- risk_ro: Process 3, read-only visualisation.

GRANT SELECT, INSERT, UPDATE ON risk.risk_evaluation_runs TO risk_rw;
GRANT SELECT, INSERT, UPDATE ON risk.risk_procurement_decisions TO risk_rw;
GRANT SELECT, INSERT, DELETE ON risk.risk_signals TO risk_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA risk TO risk_rw;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_rw;

GRANT SELECT ON risk.risk_evaluation_runs, risk.risk_procurement_decisions, risk.risk_signals TO risk_ro;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_ro;

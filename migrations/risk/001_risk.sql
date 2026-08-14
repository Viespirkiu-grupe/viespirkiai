-- Schema `risk`: risk signals for public procurement.
-- DDL per docs/indicators-story/risk-schema.md — two tables and one view.

CREATE SCHEMA IF NOT EXISTS risk;

-- 1. Evaluation runs -----------------------------------------------------

CREATE TABLE IF NOT EXISTS risk.evaluation_runs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data_as_of   timestamptz NOT NULL,
    code_commit  text NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    status       text NOT NULL,
    statistics   jsonb,
    error        text,
    CONSTRAINT evaluation_runs_status_check
        CHECK (status IN ('running', 'succeeded', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS evaluation_runs_latest_idx
    ON risk.evaluation_runs (started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_runs_single_active_idx
    ON risk.evaluation_runs ((status)) WHERE status = 'running';

-- 2. Risk signals ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS risk.risk_signals (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- which run produced it
    run_id             bigint NOT NULL REFERENCES risk.evaluation_runs (id) ON DELETE CASCADE,

    -- what it is about
    subject_type       text NOT NULL,
    subject_key        text NOT NULL,
    procurement_source text,
    procurement_id     text,

    -- which indicator
    indicator_id       text NOT NULL,
    indicator_version  integer NOT NULL,
    applied_parameters jsonb,

    -- the result
    state              text NOT NULL,
    raw_value          jsonb,
    threshold          jsonb,
    evidence           jsonb,
    missing_data       jsonb,
    error_info         jsonb,
    duration_ms        integer,

    -- the run's cutoff, copied so a row explains itself without a join
    data_as_of         timestamptz NOT NULL,

    CONSTRAINT risk_signals_subject_type_check
        CHECK (subject_type IN ('procurement', 'lot', 'contract', 'supplier')),
    CONSTRAINT risk_signals_state_check
        CHECK (state IN ('triggered', 'not_triggered', 'insufficient_data', 'not_applicable', 'calculation_error'))
);

-- The integrity rule of a snapshot: one result per subject and indicator
-- within a run. Its leading run_id also serves the subject lookup below.
CREATE UNIQUE INDEX IF NOT EXISTS risk_signals_run_subject_idx
    ON risk.risk_signals (run_id, subject_type, subject_key, indicator_id);

-- Procurement detail page: every indicator state for one procurement, in the
-- run the site is showing.
CREATE INDEX IF NOT EXISTS risk_signals_run_procurement_idx
    ON risk.risk_signals (run_id, procurement_source, procurement_id);

-- Methodology page and list filters: subjects one indicator triggered.
CREATE INDEX IF NOT EXISTS risk_signals_run_triggered_idx
    ON risk.risk_signals (run_id, indicator_id) WHERE state = 'triggered';

CREATE INDEX IF NOT EXISTS risk_signals_evidence_gin
    ON risk.risk_signals USING gin (evidence jsonb_path_ops);

-- 3. The run the site shows -----------------------------------------------

-- One definition of "latest successful run", so the read model, the retention
-- job and the application cannot disagree about which snapshot is live. A
-- 'partial' run counts: it completed, and the indicators that failed in it
-- simply contributed no rows.
CREATE OR REPLACE VIEW risk.v_latest_run AS
SELECT *
FROM risk.evaluation_runs
WHERE status IN ('succeeded', 'partial')
ORDER BY started_at DESC
LIMIT 1;

-- 4. List-page read model --------------------------------------------------

CREATE OR REPLACE VIEW risk.v_procurement_summaries AS
SELECT s.procurement_source,
       s.procurement_id,
       count(*) FILTER (WHERE s.state = 'triggered')                         AS triggered_count,
       count(*) FILTER (WHERE s.state = 'insufficient_data')                 AS insufficient_data_count,
       count(*) FILTER (WHERE s.state = 'not_applicable')                    AS not_applicable_count,
       count(*) FILTER (WHERE s.state = 'calculation_error')                 AS error_count,
       count(*)                                                              AS evaluated_count,
       array_agg(DISTINCT s.indicator_id) FILTER (WHERE s.state = 'triggered') AS triggered_indicators,
       min(s.run_id)                                                         AS run_id,
       min(s.data_as_of)                                                     AS data_as_of
FROM risk.risk_signals s
         JOIN risk.v_latest_run r ON r.id = s.run_id
WHERE s.procurement_id IS NOT NULL
GROUP BY s.procurement_source, s.procurement_id;

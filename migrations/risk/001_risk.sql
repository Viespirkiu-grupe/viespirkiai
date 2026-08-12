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

    -- time
    data_as_of         timestamptz NOT NULL,
    valid_from         timestamptz NOT NULL DEFAULT now(),
    valid_to           timestamptz,
    checked_at         timestamptz NOT NULL DEFAULT now(),
    run_id             bigint REFERENCES risk.evaluation_runs (id),

    CONSTRAINT risk_signals_subject_type_check
        CHECK (subject_type IN ('procurement', 'lot', 'contract', 'supplier')),
    CONSTRAINT risk_signals_state_check
        CHECK (state IN ('triggered', 'not_triggered', 'insufficient_data', 'not_applicable', 'calculation_error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_signals_current_idx
    ON risk.risk_signals (subject_type, subject_key, indicator_id) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS risk_signals_procurement_current_idx
    ON risk.risk_signals (procurement_source, procurement_id) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS risk_signals_procurement_history_idx
    ON risk.risk_signals (procurement_source, procurement_id, valid_from DESC);

CREATE INDEX IF NOT EXISTS risk_signals_triggered_idx
    ON risk.risk_signals (indicator_id, data_as_of DESC) WHERE valid_to IS NULL AND state = 'triggered';

CREATE INDEX IF NOT EXISTS risk_signals_closed_idx
    ON risk.risk_signals (valid_to) WHERE valid_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS risk_signals_run_idx
    ON risk.risk_signals (run_id);

CREATE INDEX IF NOT EXISTS risk_signals_evidence_gin
    ON risk.risk_signals USING gin (evidence jsonb_path_ops);

-- 3. List-page read model --------------------------------------------------

CREATE OR REPLACE VIEW risk.v_procurement_summaries AS
SELECT procurement_source,
       procurement_id,
       count(*) FILTER (WHERE state = 'triggered')                       AS triggered_count,
       count(*) FILTER (WHERE state = 'insufficient_data')               AS insufficient_data_count,
       count(*) FILTER (WHERE state = 'not_applicable')                  AS not_applicable_count,
       count(*) FILTER (WHERE state = 'calculation_error')               AS error_count,
       count(*)                                                          AS evaluated_count,
       array_agg(DISTINCT indicator_id) FILTER (WHERE state = 'triggered') AS triggered_indicators,
       max(data_as_of)                                                   AS data_as_of,
       min(checked_at)                                                   AS oldest_checked_at
FROM risk.risk_signals
WHERE valid_to IS NULL
  AND procurement_id IS NOT NULL
GROUP BY procurement_source, procurement_id;

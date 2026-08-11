-- =============================================================================
-- Schema `risk` — risk signals for public procurement
--
-- Companion to: risk-indicators-public-page-and-maintenance.md (§7)
-- Status:       design draft
--
-- Identifiers are English throughout, to stay aligned with international and EU
-- procurement-fraud terminology. Lithuanian appears only as label VALUES that
-- the GUI renders, and those live in the indicator catalogue in Git, never in
-- this schema.
--
--   risk.evaluation_runs          one row per evaluation run
--   risk.risk_signals             current signals and their recent history
--   risk.v_procurement_summaries  list-page aggregate
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS risk;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()


-- =============================================================================
-- 1. Evaluation runs
--
-- One row per run of the Procurement Risk Service. Answers "did the job run,
-- and did it succeed" — which is what lets the site state how fresh its signals
-- are instead of showing stale flags with unearned confidence.
-- =============================================================================

CREATE TABLE risk.evaluation_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 'scheduled' | 'backfill' | 'manual'
    trigger_reason  text        NOT NULL,

    -- Source-data cutoff. Every calculation in this run reads facts as of this
    -- instant, so a run is reproducible and cannot leak future data.
    data_as_of      timestamptz NOT NULL,

    -- Git commit that defined the indicators in this run, and the hash of the
    -- registry built from it.
    code_commit     text        NOT NULL,
    registry_hash   text,

    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,

    -- 'running' | 'succeeded' | 'partial' | 'failed'
    status          text        NOT NULL,

    -- Per-indicator outcome counts and timings, e.g.
    --   {"R003": {"rows": 8421, "triggered": 96, "ms": 1840},
    --    "R018": {"rows": 8421, "error": "statement timeout", "ms": 30000}}
    statistics      jsonb,
    error           text
);

CREATE INDEX evaluation_runs_latest_idx
    ON risk.evaluation_runs (started_at DESC);

-- At most one run in flight at a time.
CREATE UNIQUE INDEX evaluation_runs_single_active_idx
    ON risk.evaluation_runs ((status))
    WHERE status = 'running';


-- =============================================================================
-- 2. Risk signals
--
-- Current state and recent history in one table, separated by a validity
-- interval:
--
--   * current rows have valid_to IS NULL
--   * a run computing the SAME result only bumps `last_checked_at`
--   * a run computing a DIFFERENT result closes the old row and inserts a new
--     one
--
-- Writing only on change is what keeps the table small: once a procurement is
-- awarded and closed its indicators are frozen, so most evaluations repeat the
-- previous run exactly and produce no row.
--
-- Result columns are never updated after insert. Only `last_checked_at`,
-- `last_checked_run_id` and `valid_to` change.
-- =============================================================================

CREATE TABLE risk.risk_signals (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- ---- WHAT IT IS ABOUT ---------------------------------------------------
    -- 'procurement' | 'lot' | 'contract' | 'supplier'
    subject_type         text NOT NULL,
    subject_key          text NOT NULL,

    -- Navigation keys for the procurement and list pages. NULL for a
    -- supplier-level signal.
    procurement_source   text,
    procurement_id       text,

    -- ---- WHICH INDICATOR ----------------------------------------------------
    -- These three columns resolve the full definition in Git.
    indicator_id         text    NOT NULL,   -- 'R003', 'LT001'
    indicator_version    integer NOT NULL,
    code_commit          text,

    -- The effective parameter values that were applied, e.g.
    --   {"minimumDays": 10, "dayCounting": "calendar_days",
    --    "validFrom": "2026-07-01"}
    applied_parameters   jsonb,

    -- ---- THE RESULT ---------------------------------------------------------
    -- 'triggered' | 'not_triggered' | 'insufficient_data' | 'not_applicable'
    -- | 'calculation_error'. All five are stored, so the page can distinguish
    -- "checked, clean" from "never evaluated" from "the calculation failed".
    state                text NOT NULL,

    raw_value            jsonb,          -- what was measured
    threshold            jsonb,          -- what it was compared against
    strength             numeric(6,5),   -- 0..1
    severity             text,           -- 'info' | 'low' | 'medium' | 'high'
    confidence           numeric(6,5),   -- 0..1

    -- Structured facts the page renders its Lithuanian explanation from. The
    -- wording template lives in catalogue.generated.json, keyed by indicator and
    -- version, so correcting text never touches these rows.
    evidence             jsonb,
    missing_data         jsonb,

    error_info           jsonb,          -- only when state = 'calculation_error'
    duration_ms          integer,

    -- ---- TIME ---------------------------------------------------------------
    data_as_of           timestamptz NOT NULL,   -- source cutoff of the run that
                                                 -- produced this result
    valid_from           timestamptz NOT NULL DEFAULT now(),
    valid_to             timestamptz,            -- NULL = current

    -- Last run that recomputed this result and got the same answer. Shown in
    -- the GUI as "tikrinta".
    last_checked_at      timestamptz NOT NULL DEFAULT now(),
    last_checked_run_id  uuid REFERENCES risk.evaluation_runs(id),
    run_id               uuid REFERENCES risk.evaluation_runs(id),

    -- Hash of the result columns only. Excludes `code_commit`, run IDs and all
    -- timestamps, so an unrelated commit cannot register as a changed signal.
    result_hash          text NOT NULL
);

-- The current-state pointer: one live row per subject and indicator. Also makes
-- a repeated run idempotent. Version is not part of the key, so activating a
-- new indicator version closes the old row and opens a new one.
CREATE UNIQUE INDEX risk_signals_current_idx
    ON risk.risk_signals (subject_type, subject_key, indicator_id)
    WHERE valid_to IS NULL;

-- Procurement detail page: every current indicator state for one procurement.
CREATE INDEX risk_signals_procurement_current_idx
    ON risk.risk_signals (procurement_source, procurement_id)
    WHERE valid_to IS NULL;

-- Procurement history panel: recent changes for one procurement.
CREATE INDEX risk_signals_procurement_history_idx
    ON risk.risk_signals (procurement_source, procurement_id, valid_from DESC);

-- Methodology page and list filters: currently triggered subjects per indicator.
CREATE INDEX risk_signals_triggered_idx
    ON risk.risk_signals (indicator_id, data_as_of DESC)
    WHERE valid_to IS NULL AND state = 'triggered';

-- Retention sweep.
CREATE INDEX risk_signals_closed_idx
    ON risk.risk_signals (valid_to)
    WHERE valid_to IS NOT NULL;

-- "What did this run change".
CREATE INDEX risk_signals_run_idx
    ON risk.risk_signals (run_id);

CREATE INDEX risk_signals_evidence_gin
    ON risk.risk_signals USING gin (evidence jsonb_path_ops);


-- =============================================================================
-- 3. List-page read model
--
-- A view. Promote to a MATERIALIZED VIEW refreshed at the end of each run if
-- measurement on the real corpus shows it is too slow.
-- =============================================================================

CREATE VIEW risk.v_procurement_summaries AS
SELECT
    s.procurement_source,
    s.procurement_id,
    count(*) FILTER (WHERE s.state = 'triggered')          AS triggered_count,
    count(*) FILTER (WHERE s.state = 'insufficient_data')  AS insufficient_data_count,
    count(*) FILTER (WHERE s.state = 'not_applicable')     AS not_applicable_count,
    count(*) FILTER (WHERE s.state = 'calculation_error')  AS error_count,
    count(*)                                               AS evaluated_count,
    coalesce(sum(s.strength) FILTER (WHERE s.state = 'triggered'), 0)
                                                           AS attention_points,
    -- Ranked explicitly: a text max() would order these alphabetically
    -- (high < info < low < medium) and report the wrong severity.
    (ARRAY['info','low','medium','high'])[
        max(array_position(ARRAY['info','low','medium','high'], s.severity))
            FILTER (WHERE s.state = 'triggered')]          AS max_severity,
    array_agg(DISTINCT s.indicator_id)
        FILTER (WHERE s.state = 'triggered')               AS triggered_indicators,
    max(s.data_as_of)                                      AS data_as_of,
    min(s.last_checked_at)                                 AS oldest_checked_at
FROM risk.risk_signals s
WHERE s.valid_to IS NULL
  AND s.procurement_id IS NOT NULL
GROUP BY s.procurement_source, s.procurement_id;

COMMENT ON VIEW risk.v_procurement_summaries IS
    'List-page aggregate over current signals. Join public.v_pirkimas for stage, '
    'deadline and event date.';


-- =============================================================================
-- 4. Retention
--
-- viespirkiai displays risk, it does not manage it. A closed signal is one the
-- GUI no longer shows as current, so it is kept for one month to support the
-- recent-changes panel and then deleted.
--
-- Run as a scheduled maintenance job, not from the application path:
--
--   DELETE FROM risk.risk_signals
--   WHERE valid_to IS NOT NULL
--     AND valid_to < now() - interval '1 month';
--
-- Current rows (valid_to IS NULL) are never deleted, however old they are: an
-- untouched procurement keeps its signals until an indicator changes them.
--
-- Evaluation runs are ~365 rows a year and are kept.
-- =============================================================================

-- Splits risk_signals back out of risk_procurement_decisions.signals (jsonb,
-- 004_decisions.sql) into its own table, per
-- docs/indicators-story/risk-service-architecture.md §2.4: current-state,
-- one row per signal, linked to its procurement only via decision_id
-- (surrogate FK) — no run_id, no data_as_of column (that cutoff lives once
-- on the parent risk_procurement_decisions row). A refresh DELETEs a
-- procurement's rows here and INSERTs the freshly evaluated set; never
-- UPDATEd.
--
-- Per repo convention (docs/indicators-story/risk-indicator-implementation-
-- plan.md), an already-numbered migration is never edited in place — this is
-- the next migration, not an edit to 004_decisions.sql.

DROP VIEW IF EXISTS risk.v_procurement_summaries;

-- 1. risk_signals -----------------------------------------------------------

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

-- 2. risk_procurement_decisions no longer carries signals --------------------

DROP INDEX IF EXISTS risk_procurement_decisions_signals_gin_idx;
ALTER TABLE risk.risk_procurement_decisions DROP COLUMN IF EXISTS signals;

-- 3. Read-path view, recomputed from risk_signals ----------------------------

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

-- 4. Grants -------------------------------------------------------------------
-- Replaces 004_decisions.sql's risk_signals-via-jsonb grants: risk_rw needs
-- SELECT, INSERT, DELETE on risk_signals (no UPDATE — rows are wiped and
-- reinserted, never edited); no grant on risk_procurement_decisions changes.

GRANT SELECT, INSERT, DELETE ON risk.risk_signals TO risk_rw;
GRANT SELECT ON risk.risk_signals TO risk_ro;
GRANT SELECT ON risk.v_procurement_summaries TO risk_rw, risk_ro;

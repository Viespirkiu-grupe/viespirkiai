-- Replaces the flattened-signal snapshot model (001_risk.sql, 003_bid_subject.sql)
-- with the current-state upsert model per
-- docs/indicators-story/risk-service-architecture.md §2.4.
--
-- No backward compatibility: this is a forward-only migration that drops the
-- old tables/views and creates the new ones. Per repo convention
-- (docs/indicators-story/risk-indicator-implementation-plan.md), an
-- already-numbered migration is never edited in place — this is the next
-- migration, not an edit to 001_risk.sql.

DROP VIEW IF EXISTS risk.v_procurement_summaries;
DROP VIEW IF EXISTS risk.v_latest_run;
DROP TABLE IF EXISTS risk.risk_signals;
DROP TABLE IF EXISTS risk.evaluation_runs;

-- 1. Evaluation runs ------------------------------------------------------

CREATE TABLE risk.risk_evaluation_runs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data_as_of   timestamptz NOT NULL,
    code_commit  text NOT NULL,
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

-- 2. Procurement risk decisions -------------------------------------------

CREATE TABLE risk.risk_procurement_decisions (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    procurement_source text NOT NULL,
    procurement_id     text NOT NULL,
    run_id             bigint NOT NULL REFERENCES risk.risk_evaluation_runs (id),
    signals            jsonb NOT NULL,
    data_as_of         timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT risk_procurement_decisions_natural_key
        UNIQUE (procurement_source, procurement_id)
);

-- List filters: which procurements a given indicator triggered.
CREATE INDEX risk_procurement_decisions_signals_gin_idx
    ON risk.risk_procurement_decisions USING gin (signals jsonb_path_ops);

-- "What did run N touch"; FK maintenance.
CREATE INDEX risk_procurement_decisions_run_id_idx
    ON risk.risk_procurement_decisions (run_id);

-- Freshness listings.
CREATE INDEX risk_procurement_decisions_updated_at_idx
    ON risk.risk_procurement_decisions (updated_at DESC);

-- 3. Read-path views -------------------------------------------------------

-- Provenance only — no longer a read filter.
CREATE VIEW risk.v_latest_run AS
SELECT *
FROM risk.risk_evaluation_runs
WHERE status IN ('succeeded', 'partial')
ORDER BY started_at DESC
LIMIT 1;

-- Per-procurement summary computed from each row's own `signals` jsonb — no
-- join to a "current run" any more; every row is already current.
CREATE VIEW risk.v_procurement_summaries AS
SELECT d.procurement_source,
       d.procurement_id,
       count(*) FILTER (WHERE sig.value ->> 'state' = 'triggered')          AS triggered_count,
       count(*) FILTER (WHERE sig.value ->> 'state' = 'insufficient_data')  AS insufficient_data_count,
       count(*) FILTER (WHERE sig.value ->> 'state' = 'not_applicable')     AS not_applicable_count,
       count(*)                                                            AS evaluated_count,
       array_agg(DISTINCT sig.value ->> 'indicatorId')
           FILTER (WHERE sig.value ->> 'state' = 'triggered')               AS triggered_indicators,
       d.run_id,
       d.updated_at
FROM risk.risk_procurement_decisions d
         CROSS JOIN LATERAL jsonb_array_elements(d.signals) AS sig(value)
GROUP BY d.procurement_source, d.procurement_id, d.run_id, d.updated_at;

-- 4. Grants -----------------------------------------------------------------
-- Replaces 002_roles.sql's risk_signals/evaluation_runs grants: risk_rw needs
-- INSERT and UPDATE, no more DELETE — nothing is retained/expired under the
-- upsert model. Dropping the old tables above already dropped their grants.

GRANT SELECT, INSERT, UPDATE ON risk.risk_evaluation_runs TO risk_rw;
GRANT SELECT, INSERT, UPDATE ON risk.risk_procurement_decisions TO risk_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA risk TO risk_rw;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_rw;

GRANT SELECT ON risk.risk_evaluation_runs, risk.risk_procurement_decisions TO risk_ro;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_ro;

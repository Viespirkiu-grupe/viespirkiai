-- Local roles for the `risk` schema, matching the grants table in
-- docs/indicators-story/risk-service-architecture.md §1.2.
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

-- risk_rw: Process 2, recording results, and the scheduled retention job.
-- Indicators are derived and can be recalculated at any time, so the writer
-- and the retention sweep share one role instead of DELETE being fenced off
-- behind a separate credential: a run row is opened and later closed, so
-- evaluation_runs needs UPDATE, and risk_signals needs DELETE for retention
-- to clear superseded run snapshots.
GRANT SELECT, INSERT, UPDATE ON risk.evaluation_runs TO risk_rw;
GRANT SELECT, INSERT, DELETE ON risk.risk_signals TO risk_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA risk TO risk_rw;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_rw;

-- risk_ro: Process 3, read-only visualisation.
GRANT SELECT ON risk.evaluation_runs, risk.risk_signals TO risk_ro;
GRANT SELECT ON risk.v_latest_run, risk.v_procurement_summaries TO risk_ro;

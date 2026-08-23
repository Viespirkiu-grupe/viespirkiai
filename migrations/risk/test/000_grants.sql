-- Local-only: risk_rw needs to create/read the test-only `public` tables and
-- views on this sandbox database. This has no production equivalent — the
-- real database's `public` schema is Data Ingestion's, and Process 2 only
-- ever gets SELECT on it via risk_calc (risk-service-architecture.md §1.2).
GRANT ALL ON SCHEMA public TO risk_rw;

-- Also local-only: lets test suites DELETE their own fixture rows between
-- runs. Under the upsert model risk_rw holds no production DELETE at all —
-- rows are overwritten, never removed — so both grants below are entirely
-- test-only.
GRANT DELETE ON risk.risk_procurement_decisions, risk.risk_evaluation_runs TO risk_rw;

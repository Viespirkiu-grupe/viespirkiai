-- Local-only: risk_rw needs to create/read the test-only `public` tables and
-- views on this sandbox database. This has no production equivalent — the
-- real database's `public` schema is Data Ingestion's, and Process 2 only
-- ever gets SELECT on it via risk_calc (risk-service-architecture.md §1.2).
GRANT ALL ON SCHEMA public TO risk_rw;

-- Also local-only: lets test suites DELETE their own fixture rows between
-- runs. Production risk_rw already holds DELETE on risk.risk_signals
-- (risk-service-architecture.md §1.2); risk.evaluation_runs has no production
-- DELETE grant, so that part of this grant is test-only.
GRANT DELETE ON risk.risk_signals, risk.evaluation_runs TO risk_rw;

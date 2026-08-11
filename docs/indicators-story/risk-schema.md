# Schema `risk` — risk signals for public procurement

Companion to: [risk-indicators-public-page-and-maintenance.md](risk-indicators-public-page-and-maintenance.md) (§7)
Status: design draft

Identifiers are English throughout, to stay aligned with international and EU procurement-fraud terminology. Lithuanian
appears only as label VALUES that the GUI renders, and those live in the indicator catalogue in Git, never in this
schema.

| Object                         | Kind  | Purpose                                  |
|--------------------------------|-------|------------------------------------------|
| `risk.evaluation_runs`         | table | one row per evaluation run               |
| `risk.risk_signals`            | table | current signals and their recent history |
| `risk.v_procurement_summaries` | view  | list-page aggregate                      |

## 1. Evaluation runs

One row per run of the Procurement Risk Service. Answers "did the job run, and did it succeed" — which is what lets the
site state how fresh its signals are instead of showing stale flags with unearned confidence.

### `risk.evaluation_runs`

| Column        | Type                                  | Indexed | Description                                                                                                                                                                |
|---------------|---------------------------------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`          | `bigint GENERATED ALWAYS AS IDENTITY` | PK      | Sequential run number.                                                                                                                                                     |
| `data_as_of`  | `timestamptz NOT NULL`                |         | Source-data cutoff. Every calculation in this run reads facts as of this instant, so a run is reproducible and cannot leak future data.                                    |
| `started_at`  | `timestamptz NOT NULL DEFAULT now()`  | ✅      |                                                                                                                                                                            |
| `finished_at` | `timestamptz`                         |         |                                                                                                                                                                            |
| `status`      | `text NOT NULL`                       | ✅      | One of `'running'`, `'succeeded'`, `'partial'`, `'failed'`.                                                                                                                |
| `statistics`  | `jsonb`                               |         | Per-indicator outcome counts and timings, e.g. `{"R003": {"rows": 8421, "triggered": 96, "ms": 1840}, "R018": {"rows": 8421, "error": "statement timeout", "ms": 30000}}`. |
| `error`       | `text`                                |         |                                                                                                                                                                            |

**Indexes**

| Name                                | Definition                                                           | Reason                               |
|-------------------------------------|----------------------------------------------------------------------|--------------------------------------|
| `evaluation_runs_latest_idx`        | `ON risk.evaluation_runs (started_at DESC)`                          | Fetch the most recent run(s).        |
| `evaluation_runs_single_active_idx` | `UNIQUE ON risk.evaluation_runs ((status)) WHERE status = 'running'` | At most one run in flight at a time. |

## 2. Risk signals

Current state and recent history in one table, separated by a validity interval:

- current rows have `valid_to IS NULL`
- a run computing the SAME result only bumps `checked_at`
- a run computing a DIFFERENT result closes the old row and inserts a new one

Writing only on change is what keeps the table small: once a procurement is awarded and closed its indicators are
frozen, so most evaluations repeat the previous run exactly and produce no row.

"Same result" is decided by comparing the new observation against the current row on the result columns only —
`indicator_version`, `applied_parameters`, `state`, `raw_value`, `threshold`, `evidence`, `missing_data` — using
`IS DISTINCT FROM`, so a NULL on either side compares correctly. Timestamps, `run_id` and `duration_ms` are excluded,
which is what stops an unrelated redeploy from registering as a changed signal. `error_info` is excluded too, so a
failure that retries with a different message does not churn a new row every night.

Result columns are never updated after insert. Only `checked_at` and `valid_to` change.

### `risk.risk_signals`

| Column               | Type                                         | Indexed | Description                                                                                                                                                                                                                        |
|----------------------|----------------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`                 | `bigint GENERATED ALWAYS AS IDENTITY`        | PK      |                                                                                                                                                                                                                                    |
| **WHAT IT IS ABOUT** |                                              |         |                                                                                                                                                                                                                                    |
| `subject_type`       | `text NOT NULL`                              | ✅      | One of `'procurement'`, `'lot'`, `'contract'`, `'supplier'`.                                                                                                                                                                       |
| `subject_key`        | `text NOT NULL`                              | ✅      |                                                                                                                                                                                                                                    |
| `procurement_source` | `text`                                       | ✅      | Navigation key for the procurement and list pages. NULL for a supplier-level signal.                                                                                                                                               |
| `procurement_id`     | `text`                                       | ✅      | Navigation key for the procurement and list pages. NULL for a supplier-level signal.                                                                                                                                               |
| **WHICH INDICATOR**  |                                              |         |                                                                                                                                                                                                                                    |
| `indicator_id`       | `text NOT NULL`                              | ✅      | Canonical indicator id such as `LT-SUP-13`.                                                                                                                                                                                        |
| `indicator_version`  | `text NOT NULL`                              |         | Taken from risk indicator definition in `definition.ts`                                                                                                                                                                            |
| `applied_parameters` | `jsonb`                                      |         | The effective parameter values that were applied, e.g. `{"minimumDays": 10, "dayCounting": "calendar_days", "validFrom": "2026-07-01"}`.                                                                                           |
| **THE RESULT**       |                                              |         |                                                                                                                                                                                                                                    |
| `state`              | `text NOT NULL`                              | ✅      | One of `'triggered'`, `'not_triggered'`, `'insufficient_data'`, `'not_applicable'`, `'calculation_error'`. All five are stored, so the page can distinguish "checked, clean" from "never evaluated" from "the calculation failed". |
| `raw_value`          | `jsonb`                                      |         | What was measured.                                                                                                                                                                                                                 |
| `threshold`          | `jsonb`                                      |         | What it was compared against.                                                                                                                                                                                                      |
| `evidence`           | `jsonb`                                      | ✅      | Structured facts the page renders its Lithuanian explanation from. The wording template lives in `catalogue.generated.json`, keyed by indicator and version, so correcting text never touches these rows.                          |
| `missing_data`       | `jsonb`                                      |         | Input fields that were absent, e.g. `["winningBidAmount", "estimatedValue"]`. This is how the page states data coverage — it is the honest, derivable replacement for a per-signal confidence score.                               |
| `error_info`         | `jsonb`                                      |         | Only set when `state = 'calculation_error'`.                                                                                                                                                                                       |
| `duration_ms`        | `integer`                                    |         |                                                                                                                                                                                                                                    |
| **TIME**             |                                              |         |                                                                                                                                                                                                                                    |
| `data_as_of`         | `timestamptz NOT NULL`                       | ✅      | Source cutoff of the run that produced this result.                                                                                                                                                                                |
| `valid_from`         | `timestamptz NOT NULL DEFAULT now()`         | ✅      |                                                                                                                                                                                                                                    |
| `valid_to`           | `timestamptz`                                | ✅      | NULL means current.                                                                                                                                                                                                                |
| `checked_at`         | `timestamptz NOT NULL DEFAULT now()`         |         | Last run that recomputed this result and got the same answer. Shown in the GUI as "tikrinta". Without it, "checked last night, unchanged" would be indistinguishable from "not checked since March".                               |
| `run_id`             | `bigint REFERENCES risk.evaluation_runs(id)` | ✅      | The run that produced this row. `checked_at` moves on without it, so `run_id` stays the provenance of the result and is not rewritten on re-confirmation.                                                                          |

**Indexes**

| Name                                   | Definition                                                                                            | Reason                                                                                                                                                                                                                 |
|----------------------------------------|-------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `risk_signals_current_idx`             | `UNIQUE ON risk.risk_signals (subject_type, subject_key, indicator_id) WHERE valid_to IS NULL`        | The current-state pointer: one live row per subject and indicator. Also makes a repeated run idempotent. Version is not part of the key, so activating a new indicator version closes the old row and opens a new one. |
| `risk_signals_procurement_current_idx` | `ON risk.risk_signals (procurement_source, procurement_id) WHERE valid_to IS NULL`                    | Procurement detail page: every current indicator state for one procurement.                                                                                                                                            |
| `risk_signals_procurement_history_idx` | `ON risk.risk_signals (procurement_source, procurement_id, valid_from DESC)`                          | Procurement history panel: recent changes for one procurement.                                                                                                                                                         |
| `risk_signals_triggered_idx`           | `ON risk.risk_signals (indicator_id, data_as_of DESC) WHERE valid_to IS NULL AND state = 'triggered'` | Methodology page and list filters: currently triggered subjects per indicator.                                                                                                                                         |
| `risk_signals_closed_idx`              | `ON risk.risk_signals (valid_to) WHERE valid_to IS NOT NULL`                                          | Retention sweep.                                                                                                                                                                                                       |
| `risk_signals_run_idx`                 | `ON risk.risk_signals (run_id)`                                                                       | "What did this run change".                                                                                                                                                                                            |
| `risk_signals_evidence_gin`            | `USING gin (evidence jsonb_path_ops)`                                                                 |                                                                                                                                                                                                                        |

## 3. List-page read model

A view. Promote to a `MATERIALIZED VIEW` refreshed at the end of each run if measurement on the real corpus shows it is
too slow.

### `risk.v_procurement_summaries`

Aggregate over `risk.risk_signals` (`WHERE valid_to IS NULL AND procurement_id IS NOT NULL`, grouped by
`procurement_source, procurement_id`):

| Column                    | Derivation                                                            | Description                                                                              |
|---------------------------|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| `procurement_source`      | group key                                                             |                                                                                          |
| `procurement_id`          | group key                                                             |                                                                                          |
| `triggered_count`         | `count(*) FILTER (WHERE state = 'triggered')`                         |                                                                                          |
| `insufficient_data_count` | `count(*) FILTER (WHERE state = 'insufficient_data')`                 |                                                                                          |
| `not_applicable_count`    | `count(*) FILTER (WHERE state = 'not_applicable')`                    |                                                                                          |
| `error_count`             | `count(*) FILTER (WHERE state = 'calculation_error')`                 |                                                                                          |
| `evaluated_count`         | `count(*)`                                                            |                                                                                          |
| `triggered_indicators`    | `array_agg(DISTINCT indicator_id) FILTER (WHERE state = 'triggered')` | Also the severity handle — see below.                                                    |
| `data_as_of`              | `max(data_as_of)`                                                     |                                                                                          |
| `oldest_checked_at`       | `min(checked_at)`                                                     | The weakest freshness claim on the page: the list may say "tikrinta" no later than this. |

Join `public.v_pirkimas` for stage, deadline and event date.

**No `attention_points` and no `max_severity`.** Both were aggregates over per-row `strength` and `severity`, which the
signal row no longer carries: strength was never comparable between a day-count indicator and a single-bid indicator, so
summing it produced a ranking that looked calibrated and was not, and severity is a constant of
`(indicator_id, indicator_version)` that lives in `catalogue.generated.json`. Default ordering is therefore
`triggered_count DESC, data_as_of DESC` — countable, explainable and requiring no calibration.

**Severity still filters, without being a column.** The page expands a severity filter into the indicator IDs the
catalogue assigns that severity and matches with array overlap:

```sql
WHERE triggered_indicators && ARRAY['LT-COM-01', 'LT-SUP-13']  -- the catalogue's 'high' set
```

Severity thus stays in Git and never becomes a database row. What this does not give is severity-weighted *sorting*
across a paginated list, since that has to happen in SQL. If the list page proves it needs it, the option that does not
put an indicator definition in the database is to have the deploy step generate a small
`risk.indicator_severity(indicator_id, indicator_version, rank)` lookup from `catalogue.generated.json` — a derived
build artefact, dropped and rebuilt on deploy, never edited. Deferred until measured need.

## 4. Retention

viespirkiai displays risk, it does not manage it. A closed signal is one the GUI no longer shows as current, so it is
kept for one month to support the recent-changes panel and then deleted.

Run as a scheduled maintenance job, not from the application path:

```sql
DELETE
FROM risk.risk_signals
WHERE valid_to IS NOT NULL
  AND valid_to < now() - interval '1 month';
```

Current rows (`valid_to IS NULL`) are never deleted, however old they are: an untouched procurement keeps its signals
until an indicator changes them.

Evaluation runs are ~365 rows a year and are kept.

# Procurement Risk Decision Service — Full-Batch Execution Results

Status: draft — QA starting point

Snapshot of the first full-data run of the **4.1 Procurement Risk Decision Service (56)** indicators ([
`indicators-canonical.md`](../indicators-canonical.md)), read directly from `risk.risk_signals` and
`risk.risk_procurement_decisions` (local risk Postgres, `docker/risk/compose.yml`).

## 0. Run identification

| Field                                             | Value                                                                                                   |
|---------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `run_id`                                          | 603                                                                                                     |
| `code_commit`                                     | `53ebb1bd79106005f13e317ef0bd7ca9ffef0354` ("SQL querying performance improvement")                     |
| `data_as_of`                                      | 2026-08-28 08:49:03 UTC                                                                                 |
| `started_at` / `finished_at`                      | 2026-08-28 08:49:03 UTC → 2026-08-28 08:53:27 UTC                                                       |
| `status`                                          | `succeeded`                                                                                             |
| Distinct `run_id` values across all decision rows | 1 — the full 265,088-procurement set was produced by this single run, not a mix of stale and fresh rows |
| Decisions with zero signal rows                   | 0 — every procurement decision has at least one evaluated signal                                        |

## 1. Coverage gap: canonical "Accepted" vs. actually deployed (fixed 2026-08-31)

The canonical catalogue used to mark **27** Procurement-Risk-Decision-Service indicators `Accepted`, while
[`deployedIndicators.ts`](../../../modules/risk/deployedIndicators.ts) only ever registered **24**. Three
`bid`-subject indicators carried `Accepted` in `indicators-canonical.md` with no `decision.ts`/`definition.ts` and never
ran in this batch:

| Code      | Canonical indicator                                     | Canonical category |
|-----------|---------------------------------------------------------|--------------------|
| LT-COM-21 | Non-genuine, incomplete, or incapable bid               | Competition        |
| LT-PRI-09 | Heavily discounted bid                                  | Pricing            |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract | Pricing            |

Root cause (confirmed from git history, not a code/engine bug): on 2026-08-23, commit `552e00a` ("added cannot implement
note") triaged the whole `bid` subject table, using `Accepted` loosely to mean "the concept survives triage" rather than
"it's built" — `LT-COM-20`'s own README, written the same day, explicitly names these three as the *next* consumers of
the `bid` `SubjectType` infrastructure it introduces, i.e. still to be written. Four days later, commit `0f7e4a5` (
"updates") introduced the stricter legend now at the top of §4.1 ("`Accepted` — implemented and registered") but only
re-audited the `procurement`/`lot` tables, never the `bid` table — so these three rows kept their pre-redefinition label
under a definition it no longer satisfied. Every indicator implemented afterward correctly bundles its code +
`deployedIndicators.ts` registration + the canonical-doc `Accepted` flip in one commit (e.g. `72085fd "LT-COM-10"`);
these three simply predate that pattern.

**Fixed**: `indicators-canonical.md` §4.1 now has a distinct `Accepted, not yet implemented` note value, and
LT-COM-21/LT-PRI-09/LT-PRI-11 are relabeled accordingly, so the doc no longer overstates what's deployed. This document
continues to report only the 24 indicators that actually executed in run 603.

## 2. Overall summary

| Metric                                                                | Value                                         |
|-----------------------------------------------------------------------|-----------------------------------------------|
| Total procurements investigated (`risk_procurement_decisions` rows)   | **265,088**                                   |
| — sourced from `cvpp`                                                 | 213,435 (80.5%)                               |
| — sourced from `cvpis`                                                | 51,653 (19.5%)                                |
| Total signal rows produced (`risk_signals`)                           | 3,971,234                                     |
| Procurements with **at least one** `triggered` signal (any indicator) | **9,367** (3.5% of all procurements)          |
| — of which sourced from `cvpp`                                        | **0**                                         |
| — of which sourced from `cvpis`                                       | **9,367** (18.1% of all `cvpis` procurements) |
| Distinct lot subjects evaluated                                       | 49,428                                        |
| Distinct bid subjects evaluated                                       | 30,810                                        |

**Every triggered signal, at every subject grain (procurement, lot, bid), belongs to a `cvpis`-sourced procurement.**
`cvpp`-sourced procurements (213,435 of 265,088, i.e. the majority of the warehouse) never trigger anything — confirmed
by the `not_applicable` count sitting at exactly 213,435 on almost every procurement-level indicator (LT-PRO-08 is the
only exception, at 225,525; see §4). This tracks the canonical doc's note that the ATN-1-report-backed data
(`v_dalyviai`, `xlsxPPAataskaitos`, etc.) covers only the `cvpis` source, but it means the service is currently silent
on 4 out of 5 procurements in the warehouse — worth confirming this is expected before QA treats a `cvpp` procurement's
clean signal set as "reviewed and found low-risk" rather than "not evaluable."

### 2.1 How many indicators fire together (of the 9,367 triggering procurements)

| Distinct indicators triggered | Procurements |
|------------------------------:|-------------:|
|                             1 |        4,317 |
|                             2 |        1,718 |
|                             3 |        1,746 |
|                             4 |          978 |
|                             5 |          357 |
|                             6 |          131 |
|                             7 |           67 |
|                             8 |           23 |
|                             9 |           14 |
|                            10 |           11 |
|                            11 |            4 |
|                            12 |            1 |

46% of triggering procurements trip exactly one indicator; the 12-indicator outlier is a good manual QA candidate —
worth pulling by hand to confirm it's a genuinely high-risk procurement and not a data artifact causing over-triggering.

## 3. Accepted indicators — coverage matrix by subject

Counts are row counts in `risk.risk_signals` for `run_id = 603`. **Times triggered** = `state = 'triggered'` rows (one
row per lot/bid for lot/bid-subject indicators, so it can exceed procurement count). **Procurements triggered**
= distinct `decision_id` among triggered rows. **Trigger rate** = triggered ÷ (triggered + not_triggered), i.e.
excluding `insufficient_data`/`not_applicable` subjects the indicator couldn't evaluate at all.

### 3.1 Subject `procurement` (13 of 28 canonical accepted; all 13 deployed)

| Code      | Indicator                                            | Category         | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Trigger rate |
|-----------|------------------------------------------------------|------------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|-------------:|
| LT-COM-03 | Only one supplier invited or consulted               | Competition      |           1,613 |                  1,613 |         3,658 |            46,382 |        213,435 |       30.60% |
| LT-OTH-03 | Evaluation/decision period anomalously short or long | Other            |             532 |                    532 |         4,351 |            46,770 |        213,435 |       10.89% |
| LT-OTH-04 | Award-to-signature period unusually long             | Other            |             283 |                    283 |         4,201 |            47,169 |        213,435 |        6.31% |
| LT-OTH-05 | Procedure unsuccessful or award not contracted       | Other            |             894 |                    894 |         4,960 |            45,799 |        213,435 |       15.27% |
| LT-PRI-05 | High estimated value                                 | Pricing          |             876 |                    876 |        16,582 |            34,195 |        213,435 |        5.02% |
| LT-PRI-06 | High estimated framework value                       | Pricing          |               3 |                      3 |         5,647 |            46,003 |        213,435 |        0.05% |
| LT-PRO-01 | Unjustified non-competitive procedure                | Procedure design |           2,423 |                  2,423 |        49,230 |                 0 |        213,435 |        4.69% |
| LT-PRO-05 | Accelerated procedure without adequate grounds       | Procedure design |             202 |                    202 |        51,451 |                 0 |        213,435 |        0.39% |
| LT-PRO-08 | Short submission/advertisement period                | Procedure design |           1,817 |                  1,817 |        36,875 |               871 |        225,525 |        4.70% |
| LT-TRA-06 | Procurement decision or reason not documented        | Transparency     |             452 |                    452 |         5,402 |            45,799 |        213,435 |        7.72% |
| LT-TRA-07 | Complaint received                                   | Transparency     |             960 |                    960 |         4,858 |            45,835 |        213,435 |       16.50% |
| LT-TRA-08 | Procurement challenged in court                      | Transparency     |              37 |                     37 |         5,741 |            45,875 |        213,435 |        0.64% |
| LT-TRA-09 | Procurement not conducted electronically             | Transparency     |              34 |                     34 |         5,810 |            45,809 |        213,435 |        0.58% |

At `procurement` subject grain, one triggered row always equals one procurement, so those two columns are identical by
construction.

### 3.2 Subject `lot` (10 of 17 canonical accepted; all 10 deployed)

| Code      | Indicator                            | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Trigger rate |
|-----------|--------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|-------------:|
| LT-AWD-01 | All bids except winner disqualified  | Award       |           1,693 |                    916 |        11,268 |            36,423 |             44 |       13.06% |
| LT-AWD-02 | Lowest bid disqualified              | Award       |             680 |                    434 |        10,199 |            38,505 |             44 |        6.25% |
| LT-AWD-03 | Poorly supported disqualification    | Award       |             369 |                    250 |        12,592 |            36,423 |             44 |        2.85% |
| LT-AWD-04 | Excessive share of disqualified bids | Award       |           1,084 |                    595 |        11,877 |            36,423 |             44 |        8.36% |
| LT-COM-01 | Single valid bid                     | Competition |           7,770 |                  3,248 |         5,191 |            36,423 |             44 |       59.95% |
| LT-COM-02 | Low number of bidders                | Competition |           8,697 |                  3,610 |         4,264 |            36,423 |             44 |       67.10% |
| LT-COM-10 | Identical bid prices                 | Competition |             198 |                    143 |        10,681 |            38,505 |             44 |        1.82% |
| LT-COM-11 | Fixed-multiple bid prices            | Competition |             135 |                    106 |        10,744 |            38,505 |             44 |        1.24% |
| LT-COM-12 | Suspiciously close bid prices        | Competition |             720 |                    550 |        10,159 |            38,505 |             44 |        6.62% |
| LT-COM-13 | Wide disparity in bid prices         | Competition |             625 |                    402 |        10,254 |            38,505 |             44 |        5.75% |

At `lot` grain, "times triggered" counts lots, "procurements triggered" counts the (fewer) distinct procurements those
lots belong to — a multi-lot procurement can trigger the same indicator more than once.

### 3.3 Subject `bid` (1 of 11 canonical accepted deployed; see §1 for the other 3)

| Code      | Indicator                             | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Trigger rate |
|-----------|---------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|-------------:|
| LT-COM-20 | Unexpected or frequent bid withdrawal | Competition |              72 |                     39 |        29,180 |             1,480 |             78 |        0.25% |

## 4. QA starting points worth checking first

- **`cvpp` procurements are 100% silent.** Every one of the 213,435 `cvpp`-sourced procurements reads
  `not_applicable` on every procurement-level indicator and `insufficient_data` at lot/bid grain (the
  `insufficient_data` counts above — 36,423 / 38,505 / 46,003–47,169 / etc. — line up closely with the `cvpp` total plus
  the `cvpis` rows that themselves lack ATN-1 report data). Confirm this is the intended "no ATN-1 report ⇒ nothing to
  evaluate" behavior and not a source-detection bug before treating a `cvpp` procurement's empty result set as
  meaningful.
- **`LT-PRO-01` and `LT-PRO-05` never produce `insufficient_data`** (0 rows each) while every sibling procurement-level
  indicator does (34,195–47,169 rows). Worth confirming their eligibility/data-requirement logic is deliberately
  narrower rather than silently swallowing a missing-data case into `not_triggered`.
- **`LT-PRO-08`'s `not_applicable` count (225,525) exceeds the `cvpp` total (213,435)** — the only procurement-level
  indicator where that happens, meaning ~12,000 `cvpis` procurements are also `not_applicable` for it. Worth
  understanding why this indicator excludes more `cvpis` procurements than its peers.
- **`LT-PRI-06` triggered only 3 times out of 265,088 procurements (0.05%).** Confirm the threshold is correctly
  calibrated and not effectively unreachable — compare against the "High estimated framework value" definition and a
  couple of the 3 triggered examples by hand.
- **`LT-COM-01`/`LT-COM-02` trigger on 60–67% of evaluable lots** — the two highest rates by a wide margin over every
  other indicator (next highest is `LT-COM-03` at 30.6%). Sanity-check a sample of triggered lots to confirm this
  reflects genuinely low competition in the data rather than an overly permissive threshold.
- **The 12-indicator procurement** (§2.1) and a sample from the 10-and-11-indicator buckets (11 + 4 procurements) are
  good manual deep-dive candidates: either strong true-positive examples or a sign that co-triggering indicators share a
  common data defect.
- **Cross-check `LT-AWD-01`/`LT-AWD-02`/`LT-AWD-03`/`LT-AWD-04`** (all disqualification-based, all reading
  `v_dalyviai`) against each other on the same lots — `LT-AWD-01` (all-but-winner disqualified) should imply
  `LT-AWD-04` (excessive disqualified share) on the same lot in most cases; a sample where one triggers without the
  other is worth a look.
- **§1's doc mismatch is fixed; the implementation decision is still open.** LT-COM-21 / LT-PRI-09 / LT-PRI-11 are now
  correctly labeled `Accepted, not yet implemented` — worth scheduling their build (they reuse `LT-COM-20`'s `bid`
  `SubjectType` infrastructure directly, per its README) rather than leaving them queued indefinitely.

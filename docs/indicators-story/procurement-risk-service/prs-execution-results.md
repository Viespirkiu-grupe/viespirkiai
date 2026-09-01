# Procurement Risk Decision Service — Full-Batch Execution Results

Status: draft — QA starting point

Snapshot of the current full-data run of the **4.1 Procurement Risk Decision Service** indicators ([
`indicators-canonical.md`](../indicators-canonical.md)), read directly from `risk.risk_signals` and
`risk.risk_procurement_decisions` (local risk Postgres, `docker/risk/compose.yml`), cross-checked against the source
warehouse views (`v_pirkimas_v2`, `v_pirkimo_dalis_v2`, `ppa.*`) on the main database.

## 0. Run identification

| Field                                             | Value                                                                                              |
|---------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `run_id`                                          | 676                                                                                                |
| `code_commit`                                     | `dc8df14516c0dbdafc05ae8f4abcd0333fe22613` ("updated after migration")                             |
| `data_as_of`                                      | 2026-09-01 11:08:33 UTC                                                                            |
| `started_at` / `finished_at`                      | 2026-09-01 11:08:33 UTC → 2026-09-01 11:11:14 UTC (161.3 s)                                        |
| `status`                                          | `succeeded`                                                                                        |
| Pages processed / failed                          | 531 / **0**                                                                                        |
| Distinct `run_id` values across all decision rows | 1 — the full 265,276-procurement set was produced by this single run, not a mix of stale and fresh |
| Decisions with zero signal rows                   | 0 — every procurement decision has at least one evaluated signal                                   |
| Orphan lots dropped by the Reader                 | 97 (lots whose `pirkimoNumeris` matches no `v_pirkimas_v2` row)                                    |

The risk database was reset before this run: run 676 is the only run present, so nothing in this document mixes results
from the earlier run 603 that the previous revision of this file described.

## 1. Coverage: canonical "Accepted" vs. actually deployed — now aligned

The coverage gap reported in the previous revision (canonical catalogue marking 27 indicators `Accepted` while only 24
were registered) is **closed**. A mechanical diff of the `Accepted` rows in `indicators-canonical.md` against the
`DISTINCT indicator_id` values actually written by run 676 is empty in both directions:

| Source                                          | Count  |
|-------------------------------------------------|--------|
| `indicators-canonical.md` rows noted `Accepted` | **26** |
| Classes in `modules/risk/deployedIndicators.ts` | **26** |
| Distinct `indicator_id` in run 676's signals    | **26** |

The three previously-missing `bid` indicators were resolved as follows:

| Code      | Canonical indicator                                     | Resolution                                                          |
|-----------|---------------------------------------------------------|---------------------------------------------------------------------|
| LT-COM-21 | Non-genuine, incomplete, or incapable bid               | Implemented (`0720a5c`-era work), registered, ran in this batch     |
| LT-PRI-09 | Heavily discounted bid                                  | Implemented, registered, ran in this batch                          |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract | Re-triaged to **`Cannot implement`** — see §4, observation **O-24** |

Every indicator now carries `indicator_version = 1`; no version skew exists in the signal set.

## 2. Overall summary

| Metric                                                                | Value                                         |
|-----------------------------------------------------------------------|-----------------------------------------------|
| Total procurements investigated (`risk_procurement_decisions` rows)   | **265,276**                                   |
| — sourced from `cvpp`                                                 | 213,435 (80.5%)                               |
| — sourced from `cvpis`                                                | 51,841 (19.5%)                                |
| Total signal rows produced (`risk_signals`)                           | 4,036,908 (evaluated = written; 0 lost)       |
| Total `triggered` signal rows                                         | 35,173                                        |
| Procurements with **at least one** `triggered` signal (any indicator) | **9,443** (3.6% of all procurements)          |
| — of which sourced from `cvpp`                                        | **0**                                         |
| — of which sourced from `cvpis`                                       | **9,443** (18.2% of all `cvpis` procurements) |
| Distinct lot subjects evaluated                                       | 49,589 (`cvpis` 49,545 / `cvpp` 44)           |
| Distinct bid subjects evaluated                                       | 30,810 (`cvpis` 30,732 / `cvpp` 78)           |
| `risk_signals` on-disk size                                           | 949 MB                                        |

The signal count reconciles exactly against the subject universe, which is the strongest available evidence that no
indicator silently dropped a subject:

```
265,276 procurements × 13 procurement-subject indicators = 3,448,588
 49,589 lots         × 10 lot-subject indicators         =   495,890
 30,810 bids         ×  3 bid-subject indicators         =    92,430
                                                    total = 4,036,908  ✓ matches risk_signals exactly
```

**Every triggered signal, at every subject grain (procurement, lot, bid), belongs to a `cvpis`-sourced procurement.**
`cvpp`-sourced procurements never trigger anything — the `not_applicable` count sits at exactly 213,435 on every
procurement-level indicator except LT-PRO-08 (225,583; see **O-12**). This is by design (see **O-02**), but it means the
service is silent on 4 out of 5 procurements in the warehouse.

### 2.1 How many indicators fire together (of the 9,443 triggering procurements)

| Distinct indicators triggered | Procurements |
|------------------------------:|-------------:|
|                             1 |        4,275 |
|                             2 |        1,705 |
|                             3 |        1,624 |
|                             4 |          946 |
|                             5 |          474 |
|                             6 |          205 |
|                             7 |          101 |
|                             8 |           51 |
|                             9 |           27 |
|                            10 |           11 |
|                            11 |           17 |
|                            12 |            5 |
|                            13 |            2 |

45% of triggering procurements trip exactly one indicator. The two 13-indicator procurements are
`cvpis:2089505` and `cvpis:3501149`; the five 12-indicator ones are `cvpis:2634927`, `cvpis:5396869`,
`cvpis:5765575`, `cvpis:3411579`, `cvpis:2409066`. All seven are good manual deep-dive candidates.

Of the 9,443 triggering procurements, **3,416 (36%) trigger only** `LT-PRO-01` / `LT-PRO-05` / `LT-PRO-08` — the three
indicators that need no ATN-1 report data. See **O-01**.

## 3. Deployed indicators — coverage matrix by subject

Counts are row counts in `risk.risk_signals` for `run_id = 676`. **Times triggered** = `state = 'triggered'` rows (one
row per lot/bid for lot/bid-subject indicators, so it can exceed procurement count). **Procurements triggered**
= distinct `decision_id` among triggered rows. **Trigger rate** = triggered ÷ (triggered + not_triggered), i.e.
excluding `insufficient_data`/`not_applicable` subjects the indicator couldn't evaluate at all.

### 3.1 Subject `procurement` (13 indicators)

| Code      | Indicator                                            | Category         | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|------------------------------------------------------|------------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-COM-03 | Only one supplier invited or consulted               | Competition      |           1,613 |                  1,613 |         3,658 |            46,570 |        213,435 |     5,271 |       30.60% |
| LT-OTH-03 | Evaluation/decision period anomalously short or long | Other            |             532 |                    532 |         4,351 |            46,958 |        213,435 |     4,883 |       10.89% |
| LT-OTH-04 | Award-to-signature period unusually long             | Other            |             283 |                    283 |         4,201 |            47,357 |        213,435 |     4,484 |        6.31% |
| LT-OTH-05 | Procedure unsuccessful or award not contracted       | Other            |             894 |                    894 |         4,960 |            45,987 |        213,435 |     5,854 |       15.27% |
| LT-PRI-05 | High estimated value                                 | Pricing          |             877 |                    877 |        16,639 |            34,325 |        213,435 |    17,516 |        5.01% |
| LT-PRI-06 | High estimated framework value                       | Pricing          |               3 |                      3 |         5,647 |            46,191 |        213,435 |     5,650 |        0.05% |
| LT-PRO-01 | Unjustified non-competitive procedure                | Procedure design |           2,428 |                  2,428 |        49,413 |                 0 |        213,435 |    51,841 |        4.68% |
| LT-PRO-05 | Accelerated procedure without adequate grounds       | Procedure design |             202 |                    202 |        51,639 |                 0 |        213,435 |    51,841 |        0.39% |
| LT-PRO-08 | Short submission/advertisement period                | Procedure design |           1,828 |                  1,828 |        36,992 |               873 |        225,583 |    38,820 |        4.71% |
| LT-TRA-06 | Procurement decision or reason not documented        | Transparency     |             452 |                    452 |         5,402 |            45,987 |        213,435 |     5,854 |        7.72% |
| LT-TRA-07 | Complaint received                                   | Transparency     |             960 |                    960 |         4,858 |            46,023 |        213,435 |     5,818 |       16.50% |
| LT-TRA-08 | Procurement challenged in court                      | Transparency     |              37 |                     37 |         5,741 |            46,063 |        213,435 |     5,778 |        0.64% |
| LT-TRA-09 | Procurement not conducted electronically             | Transparency     |              34 |                     34 |         5,810 |            45,997 |        213,435 |     5,844 |        0.58% |

At `procurement` subject grain, one triggered row always equals one procurement, so those two columns are identical by
construction. Note the three-tier evaluable base: 51,841 (needs only `pirkimoBudas`), 38,820 / 17,516 (needs
`v_pirkimas_v2` fields), ~4,500–5,900 (needs the ATN-1 report).

### 3.2 Subject `lot` (10 indicators)

| Code      | Indicator                            | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|--------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-AWD-01 | All bids except winner disqualified  | Award       |           1,693 |                    916 |        11,268 |            36,584 |             44 |    12,961 |       13.06% |
| LT-AWD-02 | Lowest bid disqualified              | Award       |             680 |                    434 |        10,199 |            38,666 |             44 |    10,879 |        6.25% |
| LT-AWD-03 | Poorly supported disqualification    | Award       |             369 |                    250 |        12,592 |            36,584 |             44 |    12,961 |        2.85% |
| LT-AWD-04 | Excessive share of disqualified bids | Award       |           1,084 |                    595 |        11,877 |            36,584 |             44 |    12,961 |        8.36% |
| LT-COM-01 | Single valid bid                     | Competition |           7,770 |                  3,248 |         5,191 |            36,584 |             44 |    12,961 |       59.95% |
| LT-COM-02 | Low number of bidders                | Competition |           8,697 |                  3,610 |         4,264 |            36,584 |             44 |    12,961 |       67.10% |
| LT-COM-10 | Identical bid prices                 | Competition |             198 |                    143 |        10,681 |            38,666 |             44 |    10,879 |        1.82% |
| LT-COM-11 | Fixed-multiple bid prices            | Competition |             135 |                    106 |        10,744 |            38,666 |             44 |    10,879 |        1.24% |
| LT-COM-12 | Suspiciously close bid prices        | Competition |             720 |                    550 |        10,159 |            38,666 |             44 |    10,879 |        6.62% |
| LT-COM-13 | Wide disparity in bid prices         | Competition |             625 |                    402 |        10,254 |            38,666 |             44 |    10,879 |        5.75% |

At `lot` grain, "times triggered" counts lots, "procurements triggered" counts the (fewer) distinct procurements those
lots belong to — a multi-lot procurement can trigger the same indicator more than once. The two evaluable bases (12,961
vs 10,879) split cleanly on whether the indicator also needs a usable `pasiulymoKaina`.

### 3.3 Subject `bid` (3 indicators)

| Code      | Indicator                                 | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|-------------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-COM-20 | Unexpected or frequent bid withdrawal     | Competition |              72 |                     39 |        29,180 |             1,480 |             78 |    29,252 |        0.25% |
| LT-COM-21 | Non-genuine, incomplete, or incapable bid | Competition |           2,740 |                  1,067 |        26,512 |             1,480 |             78 |    29,252 |        9.37% |
| LT-PRI-09 | Heavily discounted bid                    | Pricing     |             247 |                    179 |         9,793 |               853 |         19,917 |    10,040 |        2.46% |

`LT-PRI-09`'s much larger `not_applicable` count is by design: it evaluates only each lot's inferred winning bid, so
every non-winning bid is `not_applicable` (see **O-05**).

## 4. Observations

Tags: **[BUG]** obvious defect, fix first · **[POTENTIAL BUG]** likely defect, needs confirmation · **[QUESTION]**
raises doubts that need an answer · **[TO KNOW]** not a defect, but misleading unless known.

### Coverage and data availability

**O-01 — [QUESTION] The service is effectively evaluating 2.2% of the warehouse at the ATN-1-backed grain.**
Only **5,857 of 265,276 procurements (2.2%)** produce a single `triggered`/`not_triggered` signal from any indicator
that reads the ATN-1 (PPA) report. Everything else is `not_applicable` (`cvpp`, 213,435) or `insufficient_data`
(~46,000 `cvpis` procurements with no ATN-1 report). Cross-grain availability:

| Lot participation data | Procurement-level ATN-1 data | Procurements |
|------------------------|------------------------------|-------------:|
| no                     | no                           |      259,433 |
| no                     | yes                          |          572 |
| yes                    | no                           |           25 |
| yes                    | yes                          |        5,246 |

Only 5,271 procurements carry usable lot participation, yet 10,687 `cvpis` procurements have lot *rows* — so about half
the procurements that have lots have no participant data for them. Question for the product owner: is 2.2% acceptable
coverage for a service whose output will be read as "this procurement was assessed"? At minimum the UI must distinguish
"assessed, clean" from "not assessable".

**O-02 — [TO KNOW] `cvpp` procurements are 100% silent, by design.**
`procurementEligibility()` (`modules/risk/procurementEligibility.ts`) gates on `saltinis === 'cvpis' && pirkimoBudas
!== null`, and no `cvpp` row carries `pirkimoBudas` (confirmed: 213,522 of 213,522 `cvpp` rows have
`cvpisPirkimoId IS NULL`). So all 213,435 `cvpp` procurements are `not_applicable` everywhere. This is documented
behaviour, not a source-detection bug — but a clean `cvpp` signal set means "not evaluable", never "reviewed and found
low-risk".

**O-03 — [TO KNOW] 44 `cvpp` lots and 78 `cvpp` bids exist and are evaluated as `not_applicable`.**
11 `cvpp` procurements do carry lot rows, contradicting the intuition that "`cvpp` has no lots at all". They flow
through the reader normally and are gated at the eligibility step. Harmless, but it explains the otherwise-mysterious
constant `not_applicable = 44` / `78` on every lot/bid indicator.

**O-04 — [TO KNOW] 36% of all triggering procurements trigger only on non-ATN-1 indicators.**
3,416 of the 9,443 triggering procurements trigger nothing except `LT-PRO-01`, `LT-PRO-05`, or `LT-PRO-08`. Any
"risk score" built by counting triggered indicators will systematically rate ATN-1-covered procurements higher than
non-covered ones purely because more indicators could run against them.

### Correctness of individual indicators

**O-05 — [POTENTIAL BUG] `LT-PRI-09`'s winner inference is contradicted by the data in 11.6% of cases.**
`LtPri09Decision.isWinner()` infers the winner as `eileNumeris === 1 && atmetimoPriezastis === null`, on the
domain-model assumption that `eileNumeris` is a price ranking. Of the 4,267 lots where the relative discount was
actually computed, **495 (11.6%) yielded a negative `relativeDiscount`** — i.e. the inferred "winner" is *more
expensive* than another valid bid in the same lot — and 87 more are exact ties. *Initial analysis*: either `eileNumeris`
is not a price ranking (most likely a MEAT / economically-most-advantageous ranking, where price rank ≠ award rank), or
the price column is not comparable within those lots (see **O-19**). Either way the assumption is unsafe as stated.
Because these cases produce a negative discount they can only ever be
`not_triggered`, so this does not create false positives *for this indicator* — but it silently suppresses the LT-PRI-09
concept for ~12% of eligible lots, and the same inference is a candidate for reuse by future award-stage indicators,
where it would be an outright defect. Worth resolving before more indicators depend on it.

**O-06 — [POTENTIAL BUG] `LT-COM-21` only matches VPĮ legal bases; the KSPĮ (utilities-sector) equivalents are never
matched.** The parameter `nonGenuineIncompleteIncapableLegalBases` is an exact-string list of three values:
`VPĮ 45 str. 1 d. 1 p.` / `3 p.` / `4 p.`. The full-batch distribution of `atmetimoTeisinisPagrindas` on disqualified
bids shows the parallel utilities-sector citations are present and never match:

| `atmetimoTeisinisPagrindas`                     |    Rows | State                                     |
|-------------------------------------------------|--------:|-------------------------------------------|
| `VPĮ 45 str. 1 d. 5 p.` (price-based rejection) |   3,376 | not_triggered (correctly excluded)        |
| `VPĮ 45 str. 1 d. 1 p.`                         |   2,057 | triggered                                 |
| `VPĮ 45 str. 1 d. 4 p.`                         |     512 | triggered                                 |
| `Kita`                                          |     315 | not_triggered                             |
| *(empty string)*                                |     209 | not_triggered                             |
| `KSPĮ 58 str. 1 d. 5 p.`                        |     184 | not_triggered (correctly excluded)        |
| `VPĮ 45 str. 1 d. 3 p.`                         |     171 | triggered                                 |
| **`KSPĮ 58 str. 1 d. 1 p.`**                    | **158** | **not_triggered — likely false negative** |
| `VPĮ 45 str. 1 d. 2 p.`                         |      50 | not_triggered (correctly excluded)        |
| **`KSPĮ 58 str. 1 d. 4 p.`**                    |  **31** | **not_triggered — likely false negative** |
| **`KSPĮ 58 str. 1 d. 3 p.`**                    |  **22** | **not_triggered — likely false negative** |

*Initial analysis*: KSPĮ (Komunalinio sektoriaus pirkimų įstatymas) 58 str. 1 d. mirrors VPĮ 45 str. 1 d.
point-for-point, so `KSPĮ 58 str. 1 d. 1/3/4 p.` (**211 rows**) are the same catalogue concept and should trigger, while
`KSPĮ 58 str. 1 d. 5 p.` correctly stays excluded exactly as its VPĮ twin does. Effect: utilities-sector buyers are
systematically under-flagged by LT-COM-21. Fix is a parameter change (add the three KSPĮ strings), not a code change —
but it needs a legal-equivalence confirmation before shipping. Separately, 5 free-text near-misses exist
(`Viešųjų pirkimų įstatymo 45 str. 1 d. 1 p`, `VPĮ 45 str. 1 d. 5 p` without the trailing dot, one long prose citation,
`PĮ 58 str. 1 d. 4 p.`) — low volume, but they confirm the field is not strictly a controlled vocabulary, so
exact-string matching is brittle.

**O-07 — [POTENTIAL BUG] `LT-COM-01` "Single valid bid" fires on lots with *zero* valid bids.**
Its threshold is `validBids <= maximumValidBids` with `maximumValidBids = 1`. Actual triggered population:

| `validBids` | Lots triggered |
|------------:|---------------:|
|           0 |      **1,320** |
|           1 |          6,450 |

*Initial analysis*: 1,320 lots (17.0% of the indicator's triggers) had **every** bid disqualified. The public Lithuanian
description shipped with the indicator — *"Pirkimo dalyje po pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas)
pasiūlymas"* ("exactly one valid bid remained") — is factually false for those 1,320 signals, and "zero valid bids" is a
materially different situation (a failed procedure, closer to `LT-OTH-05`) from "one valid bid" (a non-competitive
award). The `≤` is deliberate in the formula text, so this is a definition/description mismatch rather than a coding
slip, but it is user-facing. Either narrow the trigger to `validBids === 1`, or amend `descriptionLt`
to say "no more than one".

**O-08 — [POTENTIAL BUG] `LT-OTH-03`'s `rawValue.periods` contains duplicate per-lot entries.**
363 of the 4,883 evaluable `LT-OTH-03` rows (7.4%) carry more entries in `periods` than the procurement has distinct
`daliesNumeris` values. Worst case observed: `cvpis:7213562` — **34 period entries for 2 distinct lots**; max array
length across the batch is 74 entries. Example fragment:
`{"periods":[{"periodDays":253,"daliesNumeris":"1"},{"periodDays":253,"daliesNumeris":"1"}]}`. *Initial analysis*:
`evaluationPeriods()` iterates `procurement.procedureOutcome.lots`, which comes from the ATN-1 procedure-outcome query
and is one row per lot **per decision/supplier**, not one row per lot. The boolean verdict is unaffected
(`periods.some(...)`), so no signal is mis-stated — but the persisted `raw_value` is wrong as a record of
"this procurement's lot evaluation periods", it inflates storage, and any downstream consumer that averages or counts
these entries will double-count. Dedupe on `daliesNumeris` in `evaluationPeriods()`.

**O-09 — [QUESTION] `LT-PRI-09`'s own `limitationLt` claims most triggers are the "exactly double" data-entry artefact;
the full batch does not support that.** The shipped Lithuanian limitation text states that a manual review (2026-08
measurement) found *"dauguma jų yra santykinis skirtumas lygiai (arba beveik lygiai) dvigubas"* — most triggers have a
relative difference of (almost) exactly 2×. Across all 247 triggers in this run, only **11 (4.5%)**
fall in the 0.98–1.02 relative-discount band; the distribution is broad, with the single largest bucket being exactly
1.00 at 8 rows. Either the earlier measurement was taken on a much smaller sample and does not generalise, or the
limitation text was carried over from a different indicator. Public-facing text should be corrected either way.

**O-10 — [QUESTION] Three indicators independently flag the same "price is a multiple of another price" pattern.**
`LT-COM-11` (`matchedMultiple = 2`), `LT-COM-13` (`minRelativeGap = 1.0`) and `LT-PRI-09` (`minRelativeDiscount =
1.0`) all fire when one price is at least/about twice another — and the LT-COM-13 and LT-PRI-09 limitation texts both
name the same suspected root cause (unit price entered where a total was expected). Overlap is real but partial (35 lots
trigger both LT-COM-11 and LT-COM-13; 237 of the 247 LT-PRI-09 lots also trigger LT-COM-13). Any risk score that sums
triggered indicators will count one suspected *data-entry error* up to three times. Decide whether these should be
de-duplicated at scoring time or one of them re-scoped.

**O-11 — [QUESTION] Only 47 framework agreements exist in `LT-PRI-06`'s entire evaluable population.**
Of the 5,650 procurements `LT-PRI-06` could evaluate, only **47** have `preliminariSutartis = true`; 3 of those 47
(6.4%) exceed the 5 M EUR threshold and trigger (values 6.6 M, 7.6 M, 24.3 M EUR). So the headline 0.05% trigger rate is
**not** a mis-calibrated threshold — the threshold behaves sensibly on the framework agreements it sees. The open
question is upstream: 47 framework agreements across 265,276 Lithuanian procurements is implausibly low, which suggests
`preliminariSutartis` is under-populated at the source. This resolves the previous revision's LT-PRI-06 concern and
replaces it with a data-ingestion question.

**O-12 — [TO KNOW] `LT-PRO-08`'s `not_applicable` (225,583) legitimately exceeds the `cvpp` total (213,435).**
The extra 12,148 are `cvpis` *rinkos konsultacija* (pre-procurement market consultation) procurements, excluded by
`excludedProcedures` in `isEligible()` because a market consultation has no submission-of-tenders deadline. The
indicator's README records that naively including them made up ~47% of the naive triggered population. Expected
behaviour; it is also why LT-PRO-08's evaluable base (38,820) is far larger than its ATN-1-dependent peers.

**O-13 — [TO KNOW] `LT-PRO-01` and `LT-PRO-05` produce zero `insufficient_data` by design.**
Both read only `pirkimoBudas`, which the shared eligibility gate has already proved non-null, so there is no remaining
data requirement that can fail. They therefore evaluate all 51,841 `cvpis` procurements — 10× the ATN-1-dependent
indicators' base. Nothing is being swallowed into `not_triggered`.

**O-14 — [TO KNOW] `LT-COM-01` triggering does not imply `LT-COM-02` triggering (779 lots).**
`LT-COM-01` counts **valid** bids (`validBids <= 1`); `LT-COM-02` counts **all** bidders (`totalBids < 3`). A lot with
five bidders of whom four were disqualified trips LT-COM-01 but not LT-COM-02. Both readings are defensible; a reviewer
expecting nesting will misread the pair.

**O-15 — [TO KNOW] `LT-COM-10` triggering does not imply `LT-COM-12` triggering (176 of 198 lots).**
`findClosestMatch()` in `LT-COM-12` explicitly skips `relativeDifference <= 0`, i.e. exactly identical prices, because
that is LT-COM-10's stronger concept. So 176 lots with identical bid prices read `not_triggered` on "suspiciously close
bid prices". Deliberate and documented in code — but any consumer asking "which lots had suspiciously close prices?"
must union LT-COM-10 with LT-COM-12.

**O-16 — [TO KNOW] `LT-AWD-01` is fully subsumed by `LT-COM-01`.**
All **1,693** LT-AWD-01 triggers also trigger LT-COM-01 on the same lot — logically necessary ("all bids except the
winner disqualified" ⟹ exactly one valid bid). The converse does not hold. The reverse-direction check the previous
revision suggested (LT-AWD-01 ⟹ LT-AWD-04) does **not** hold: 1,128 of 1,693 LT-AWD-01 lots do not trigger LT-AWD-04,
which is expected — a 2-bid lot with 1 disqualification is a 50% disqualified share, below LT-AWD-04's threshold. 519
lots trigger LT-AWD-04 without LT-AWD-01.

**O-17 — [TO KNOW] `LT-COM-13` measures the gap between the *two lowest* prices, not overall price disparity.**
The English catalogue name "Wide disparity in bid prices" is looser than the implementation, which computes
`(secondLowest − lowest) / lowest` over all priced bids. The shipped Lithuanian title is accurate ("Didelis atotrūkis
tarp mažiausios ir kitos pasiūlymo kainos"). A lot with prices 100 / 101 / 10,000 will *not* trigger. Use the LT text,
not the canonical English name, when reviewing.

**O-18 — [TO KNOW] `LT-PRI-09` can trigger where `LT-COM-13` does not (10 lots).**
LT-PRI-09 compares the winner against the next-lowest **valid** price; LT-COM-13 compares the two lowest prices
**regardless of disqualification**. When a disqualified bid sits between the winner and the next valid bid, LT-COM-13
sees a small gap and LT-PRI-09 sees a large one. Correct in both cases, surprising if not known.

**O-19 — [QUESTION] Every price-comparing indicator ignores `kainosIsraiskaId`, which the catalogue elsewhere calls a
blocker.** `indicators-canonical.md`'s own "cannot implement" rationale for `LT-PRI-10`/`LT-PRI-11` states that
`pasiulymoKaina` is *not comparable*, because 95.9% of priced rows carry a `kainosIsraiskaId` reference into a 359-label
lookup mixing lump-sum totals, per-unit rates (`Eur/km`), evaluation-score points, and bare re-stated numbers.
`LT-COM-10`/`11`/`12`/`13` and `LT-PRI-09` all compare `pasiulymoKaina` values directly and none reads
`kainosIsraiskaId`. Verification against the source: of 12,241 lots with priced rows in `ppa."pasiulymuEile"`, only **23
mix more than one `kainosIsraiskaId` within a single lot** (and 12 have a partly-null expression), so the *within-lot*
comparison these five indicators make is sound for 99.8% of lots. Question: should those 23 lots be gated to
`insufficient_data`, and should the rationale be recorded explicitly so the apparent contradiction with the LT-PRI-10/11
text does not resurface at review?

**O-20 — [QUESTION] `LT-COM-01` / `LT-COM-02` trigger on 60% / 67% of evaluable lots.**
Far above every other indicator (next highest is `LT-COM-03` at 30.6%). The underlying distribution shows this is
data-driven, not a threshold artefact: of 12,961 evaluable lots, 5,572 (43%) had exactly **one** bidder and 3,125 (24%)
had two. A "red flag" that fires on two thirds of the assessable population carries little discriminating power,
whatever its correctness. Confirm with the product owner whether these are intended as risk *flags* or as descriptive
context.

**O-21 — [QUESTION] `LT-TRA-08` (37) and `LT-TRA-09` (34) trigger on well under 1% of an already tiny base.**
Both read a single boolean ATN-1 field (`ieskinysTeismui`, `elektroninisPirkimas`) over ~5,800 evaluable procurements.
Rates of 0.64% / 0.58% are plausible for court challenges but surprising for non-electronic procurement. Worth sampling
a handful to confirm the fields are populated meaningfully rather than defaulted.

### Pipeline and data-integrity checks (all passed)

**O-22 — [TO KNOW] Signal accounting reconciles exactly; nothing was silently dropped.**
`RiskDecisionEngine.evaluateAll` isolates a failing indicator per subject by *omitting* that subject's signal, which
would be invisible in the run status. The arithmetic in §2 confirms it did not happen: evaluated = written = 4,036,908 =
the exact product of subjects × indicators per grain. Additional integrity sweeps, all clean:
0 `triggered` rows with a null `raw_value`, 0 `triggered` rows carrying `missing_data`, 0 `insufficient_data` rows with
an empty `missing_data`, 1 distinct `data_as_of` across all decisions, 0 `procurement_id` values appearing under both
sources.

**O-23 — [TO KNOW] The 265,276 decisions vs. 265,363 source rows gap is deduplication, not data loss.**
`v_pirkimas_v2` currently returns 265,363 rows for 265,277 distinct `(saltinis, pirkimoNumeris)` keys — **45 `cvpp`
procurement numbers appear more than once** (86 surplus rows). `PROCUREMENT_PAGE_SQL`'s
`DISTINCT ON (saltinis, "pirkimoNumeris") ... ORDER BY ... "paskelbimoData" DESC NULLS LAST` deliberately keeps only the
most recently published row per key. The remaining 1-row difference (265,277 now vs 265,276 at run time) is warehouse
drift since 11:08 UTC. Likewise `orphanLotsDropped = 97` at run time vs 114 orphan lots in the source now, with the
non-orphan lot count unchanged at 49,589 — 17 new orphan lots arrived after the run. No procurement was lost.

**O-24 — [TO KNOW] `LT-PRI-11` moved from `Accepted` to `Cannot implement`, and the reason is structural.**
Not a scheduling decision: `indicators-canonical.md` now records that "supplier bid much higher than for a comparable
contract" needs cross-procurement price commensurability, which `v_dalyviai."pasiulymoKaina"` cannot provide (same
`kainosIsraiskaId` root cause as **O-19**), and that no ingested source carries the quantity or line-item breakdown a
"comparable contract" would require. So the §1 gap is closed by implementing two of the three and reclassifying the
third — there is no queued build work left from that finding.

### Manual deep-dive candidates

- The two 13-indicator procurements `cvpis:2089505`, `cvpis:3501149` and the five 12-indicator ones listed in §2.1 —
  either strong true positives or evidence that co-triggering indicators share one data defect (**O-10** makes the
  latter plausible: both 13-indicator cases include the LT-COM-12/LT-COM-13 pair).
- A sample of the 1,320 zero-valid-bid `LT-COM-01` lots (**O-07**).
- A sample of the 495 negative-discount `LT-PRI-09` lots (**O-05**).
- The 211 `KSPĮ`-cited disqualified bids currently missed by `LT-COM-21` (**O-06**).
- `cvpis:7213562` for the `LT-OTH-03` duplicate-periods shape (**O-08**).

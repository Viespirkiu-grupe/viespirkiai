# Procurement Risk Decision Service — Full-Batch Execution Results

Status: draft — QA starting point

Snapshot of the current full-data run of the **4.1 Procurement Risk Decision Service** indicators ([
`indicators-canonical.md`](../indicators-canonical.md)), read directly from `risk.risk_signals` and
`risk.risk_procurement_decisions` (local risk Postgres, `docker/risk/compose.yml`), cross-checked against the source
warehouse views (`v_pirkimas_v2`, `v_pirkimo_dalis_v2`, `ppa.*`) on the main database.

## 0. Run identification

The risk database currently holds exactly one run. `test/risk/runEvaluation.it.ts` and `test/risk/write.it.ts` wipe
`risk.risk_signals` / `risk_procurement_decisions` / `risk_evaluation_runs` unscoped on every `npm run test:integration`
(see **O-26**), so no prior batch survives. Every fix described in earlier revisions of this document is already baked
into the code that produced this run — there is no before/after left to report.

| Field                                       | Value                   |
|----------------------------------------------|-------------------------|
| `data_as_of` / `started_at`                 | 2026-09-01 13:46:31 UTC |
| `finished_at` (wall time)                   | 13:48:46 UTC (134.8 s)  |
| `status`                                    | `succeeded`             |
| Pages processed / failed                    | 531 / **0**             |
| Procurements evaluated                      | 265,294                 |
| Signal rows (evaluated = written)           | 4,037,222               |
| `triggered` signal rows                     | 34,049                  |
| Orphan lots dropped by the Reader           | 97                      |
| Decisions with zero signal rows             | 0                       |
| Distinct `run_id` across all decision rows  | 1                       |

`risk.risk_evaluation_runs` (`migrations/risk/001_risk.sql`) carries only `id, data_as_of, started_at, finished_at,
status, statistics, error` — there is no `code_commit` or other provenance column, and no code anywhere in the repo
still computes one (a repo-wide grep for `resolveCodeCommit`/`code_commit`/`codeCommit` returns nothing). So there is
currently no way to tell which code version produced a given run; see **O-25**.

## 1. Coverage: canonical "Accepted" vs. actually deployed — now aligned

The coverage gap reported in the previous revision (canonical catalogue marking 27 indicators `Accepted` while only 24
were registered) is **closed**. A mechanical diff of the `Accepted` rows in `indicators-canonical.md` against the
`DISTINCT indicator_id` values actually written by the run is empty in both directions (confirmed against the current
run's signals):

| Source                                          | Count  |
|-------------------------------------------------|--------|
| `indicators-canonical.md` rows noted `Accepted` | **26** |
| Classes in `modules/risk/deployedIndicators.ts` | **26** |
| Distinct `indicator_id` in the run's signals    | **26** |

The three previously-missing `bid` indicators were resolved as follows:

| Code      | Canonical indicator                                     | Resolution                                                          |
|-----------|-----------------------------------------------------------|-----------------------------------------------------------------|
| LT-COM-21 | Non-genuine, incomplete, or incapable bid                | Implemented (`0720a5c`-era work), registered, ran in this batch |
| LT-PRI-09 | Heavily discounted bid                                    | Implemented, registered, ran in this batch                      |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract   | Re-triaged to **`Cannot implement`** — see §4, observation **O-24** |

Every indicator now carries `indicator_version = 1`; no version skew exists in the signal set.

## 2. Overall summary

Figures below are for the current (and only) run in the database — see §0.

| Metric                                                                | Value                                         |
|-----------------------------------------------------------------------|-----------------------------------------------|
| Total procurements investigated (`risk_procurement_decisions` rows)   | **265,294**                                   |
| — sourced from `cvpp`                                                 | 213,435 (80.5%)                               |
| — sourced from `cvpis`                                                | 51,859 (19.5%)                                |
| Total signal rows produced (`risk_signals`)                           | 4,037,222 (evaluated = written; 0 lost)       |
| Total `triggered` signal rows                                         | 34,049                                        |
| Procurements with **at least one** `triggered` signal (any indicator) | **9,455** (3.6% of all procurements)          |
| — of which sourced from `cvpp`                                        | **0**                                         |
| — of which sourced from `cvpis`                                       | **9,455** (18.2% of all `cvpis` procurements) |
| Distinct lot subjects evaluated                                       | 49,597                                        |
| Distinct bid subjects evaluated                                       | 30,810                                        |

The signal count reconciles exactly against the subject universe, which is the strongest available evidence that no
indicator silently dropped a subject:

```
265,294 procurements × 13 procurement-subject indicators = 3,448,822
 49,597 lots         × 10 lot-subject indicators         =   495,970
 30,810 bids         ×  3 bid-subject indicators         =    92,430
                                                    total = 4,037,222  ✓ matches risk_signals exactly
```

**Every triggered signal, at every subject grain (procurement, lot, bid), belongs to a `cvpis`-sourced procurement.**
`cvpp`-sourced procurements never trigger anything — the `not_applicable` count sits at exactly 213,435 on every
procurement-level indicator except LT-PRO-08 (225,588; see **O-12**). This is by design (see **O-02**), but it means the
service is silent on 4 out of 5 procurements in the warehouse.

### 2.1 How many indicators fire together (of the 9,455 triggering procurements)

| Distinct indicators triggered | Procurements |
|------------------------------:|-------------:|
|                             1 |        4,286 |
|                             2 |        1,759 |
|                             3 |        1,691 |
|                             4 |          907 |
|                             5 |          415 |
|                             6 |          184 |
|                             7 |          103 |
|                             8 |           51 |
|                             9 |           24 |
|                            10 |           11 |
|                            11 |           17 |
|                            12 |            5 |
|                            13 |            2 |

45% of triggering procurements trip exactly one indicator. The two 13-indicator procurements are
`cvpis:2089505` and `cvpis:3501149`; the five 12-indicator ones are `cvpis:2634927`, `cvpis:5396869`,
`cvpis:5765575`, `cvpis:3411579`, `cvpis:2409066`. All seven are good manual deep-dive candidates.

Of the 9,455 triggering procurements, **3,417 (36%) trigger only** `LT-PRO-01` / `LT-PRO-05` / `LT-PRO-08` — the three
indicators that need no ATN-1 report data. See **O-01**.

## 3. Deployed indicators — coverage matrix by subject

Counts are row counts in `risk.risk_signals` for the current run (the only run in the database — see §0). **Times
triggered** = `state = 'triggered'` rows (one row per lot/bid for lot/bid-subject indicators, so it can exceed
procurement count). **Procurements triggered** = distinct `decision_id` among triggered rows. **Evaluable** = triggered
+ not_triggered. **Trigger rate** = triggered ÷ evaluable, i.e. excluding `insufficient_data`/`not_applicable` subjects
the indicator couldn't evaluate at all.

### 3.1 Subject `procurement` (13 indicators)

| Code      | Indicator                                            | Category         | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|-------------------------------------------------------|------------------|----------------:|------------------------:|---------------:|--------------------:|-----------------:|-----------:|--------------:|
| LT-COM-03 | Only one supplier invited or consulted               | Competition      |           1,613 |                   1,613 |          3,658 |               46,588 |           213,435 |     5,271 |        30.60% |
| LT-OTH-03 | Evaluation/decision period anomalously short or long | Other            |             521 |                     521 |          4,352 |               46,986 |           213,435 |     4,873 |        10.69% |
| LT-OTH-04 | Award-to-signature period unusually long             | Other            |             278 |                     278 |          4,174 |               47,407 |           213,435 |     4,452 |         6.24% |
| LT-OTH-05 | Procedure unsuccessful or award not contracted       | Other            |             894 |                     894 |          4,960 |               46,005 |           213,435 |     5,854 |        15.27% |
| LT-PRI-05 | High estimated value                                 | Pricing          |             878 |                     878 |         16,644 |               34,337 |           213,435 |    17,522 |         5.01% |
| LT-PRI-06 | High estimated framework value                       | Pricing          |               3 |                       3 |          5,647 |               46,209 |           213,435 |     5,650 |         0.05% |
| LT-PRO-01 | Unjustified non-competitive procedure                | Procedure design |           2,429 |                   2,429 |         49,430 |                     0 |           213,435 |    51,859 |         4.68% |
| LT-PRO-05 | Accelerated procedure without adequate grounds       | Procedure design |             202 |                     202 |         51,657 |                     0 |           213,435 |    51,859 |         0.39% |
| LT-PRO-08 | Short submission/advertisement period                | Procedure design |           1,828 |                   1,828 |         37,005 |                   873 |           225,588 |    38,833 |         4.71% |
| LT-TRA-06 | Procurement decision or reason not documented        | Transparency     |             447 |                     447 |          5,407 |               46,005 |           213,435 |     5,854 |         7.64% |
| LT-TRA-07 | Complaint received                                   | Transparency     |             960 |                     960 |          4,858 |               46,041 |           213,435 |     5,818 |        16.50% |
| LT-TRA-08 | Procurement challenged in court                      | Transparency     |              37 |                      37 |          5,741 |               46,081 |           213,435 |     5,778 |         0.64% |
| LT-TRA-09 | Procurement not conducted electronically             | Transparency     |              34 |                      34 |          5,810 |               46,015 |           213,435 |     5,844 |         0.58% |

At `procurement` subject grain, one triggered row always equals one procurement, so those two columns are identical by
construction. Note the three-tier evaluable base: 51,859 (needs only `pirkimoBudas`), 38,833 / 17,522 (needs
`v_pirkimas_v2` fields), ~4,400–5,900 (needs the ATN-1 report).

### 3.2 Subject `lot` (10 indicators)

| Code      | Indicator                            | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|----------------------------------------|-------------|----------------:|------------------------:|---------------:|--------------------:|-----------------:|-----------:|--------------:|
| LT-AWD-01 | All bids except winner disqualified  | Award       |           1,693 |                      916 |         11,268 |               36,592 |                44 |    12,961 |        13.06% |
| LT-AWD-02 | Lowest bid disqualified              | Award       |             680 |                      434 |         10,199 |               38,674 |                44 |    10,879 |         6.25% |
| LT-AWD-03 | Poorly supported disqualification    | Award       |             369 |                      250 |         12,592 |               36,592 |                44 |    12,961 |         2.85% |
| LT-AWD-04 | Excessive share of disqualified bids | Award       |           1,084 |                      595 |         11,877 |               36,592 |                44 |    12,961 |         8.36% |
| LT-COM-01 | Single valid bid                     | Competition |           6,450 |                    2,884 |          5,191 |               36,592 |             1,364 |    11,641 |        55.41% |
| LT-COM-02 | Low number of bidders                | Competition |           8,697 |                    3,610 |          4,264 |               36,592 |                44 |    12,961 |        67.10% |
| LT-COM-10 | Identical bid prices                 | Competition |             198 |                      143 |         10,681 |               38,674 |                44 |    10,879 |         1.82% |
| LT-COM-11 | Fixed-multiple bid prices            | Competition |             135 |                      106 |         10,744 |               38,674 |                44 |    10,879 |         1.24% |
| LT-COM-12 | Suspiciously close bid prices        | Competition |             720 |                      550 |         10,159 |               38,674 |                44 |    10,879 |         6.62% |
| LT-COM-13 | Wide disparity in bid prices         | Competition |             625 |                      402 |         10,254 |               38,674 |                44 |    10,879 |         5.75% |

At `lot` grain, "times triggered" counts lots, "procurements triggered" counts the (fewer) distinct procurements those
lots belong to — a multi-lot procurement can trigger the same indicator more than once. The two evaluable bases (12,961
vs 10,879) split cleanly on whether the indicator also needs a usable `pasiulymoKaina`; LT-COM-01's 11,641 is lower
again because zero-valid-bid lots (1,320 of them) are excluded from the evaluable population as `not_applicable` — see
the LT-COM-01 README's "Zero valid bids is a different concept" section.

### 3.3 Subject `bid` (3 indicators)

| Code      | Indicator                                 | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|----------------------------------------------|-------------|----------------:|------------------------:|---------------:|--------------------:|-----------------:|-----------:|--------------:|
| LT-COM-20 | Unexpected or frequent bid withdrawal     | Competition |              72 |                       39 |         29,180 |                1,480 |                78 |    29,252 |         0.25% |
| LT-COM-21 | Non-genuine, incomplete, or incapable bid | Competition |           2,955 |                    1,180 |         26,297 |                1,480 |                78 |    29,252 |        10.10% |
| LT-PRI-09 | Heavily discounted bid                    | Pricing     |             247 |                      179 |          9,298 |                  853 |            20,412 |     9,545 |         2.59% |

`LT-PRI-09`'s much larger `not_applicable` count is by design: it evaluates only each lot's inferred winning bid, and
only where that winner is also the lot's lowest valid price (**O-05** in earlier revisions of this document, now folded
into the indicator's own README), so every other bid is `not_applicable`.

## 4. Observations

Tags: **[BUG]** obvious defect, fix first · **[POTENTIAL BUG]** likely defect, needs confirmation · **[QUESTION]**
raises doubts that need an answer · **[TO KNOW]** not a defect, but misleading unless known.

### Coverage and data availability

**O-01 — [QUESTION] The service is effectively evaluating 2.2% of the warehouse at the ATN-1-backed grain.**
Only **5,857 of 265,286 procurements (2.2%)** produce a single `triggered`/`not_triggered` signal from any indicator
that reads the ATN-1 (PPA) report. Everything else is `not_applicable` (`cvpp`, 213,435) or `insufficient_data`
(~46,000 `cvpis` procurements with no ATN-1 report). Cross-grain availability:

| Lot participation data | Procurement-level ATN-1 data | Procurements |
|------------------------|-------------------------------|-------------:|
| no                     | no                             |      259,433 |
| no                     | yes                            |          572 |
| yes                    | no                             |           25 |
| yes                    | yes                            |        5,246 |

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
3,417 of the 9,455 triggering procurements trigger nothing except `LT-PRO-01`, `LT-PRO-05`, or `LT-PRO-08`. Any
"risk score" built by counting triggered indicators will systematically rate ATN-1-covered procurements higher than
non-covered ones purely because more indicators could run against them.

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

**O-12 — [TO KNOW] `LT-PRO-08`'s `not_applicable` (225,588) legitimately exceeds the `cvpp` total (213,435).**
The extra 12,153 are `cvpis` *rinkos konsultacija* (pre-procurement market consultation) procurements, excluded by
`excludedProcedures` in `isEligible()` because a market consultation has no submission-of-tenders deadline. The
indicator's README records that naively including them made up ~47% of the naive triggered population. Expected
behaviour; it is also why LT-PRO-08's evaluable base (38,833) is far larger than its ATN-1-dependent peers.

**O-13 — [TO KNOW] `LT-PRO-01` and `LT-PRO-05` produce zero `insufficient_data` by design.**
Both read only `pirkimoBudas`, which the shared eligibility gate has already proved non-null, so there is no remaining
data requirement that can fail. They therefore evaluate all 51,859 `cvpis` procurements — 10× the ATN-1-dependent
indicators' base. Nothing is being swallowed into `not_triggered`.

**O-14 — [TO KNOW] `LT-COM-01` triggering does not imply `LT-COM-02` triggering (565 lots).**
`LT-COM-01` counts **valid** bids (`1 ≤ validBids ≤ 1`); `LT-COM-02` counts **all** bidders (`totalBids < 3`). A lot
with five bidders of whom four were disqualified trips LT-COM-01 but not LT-COM-02. Both readings are defensible; a
reviewer expecting nesting will misread the pair. The 214 zero-valid-bid lots that would otherwise widen this gap read
`not_applicable` on LT-COM-01 (see its README's "Zero valid bids is a different concept" section) — they were never
LT-COM-01's concept to begin with.

**O-15 — [TO KNOW] `LT-COM-10` triggering does not imply `LT-COM-12` triggering (176 of 198 lots).**
`findClosestMatch()` in `LT-COM-12` explicitly skips `relativeDifference <= 0`, i.e. exactly identical prices, because
that is LT-COM-10's stronger concept. So 176 lots with identical bid prices read `not_triggered` on "suspiciously close
bid prices". Deliberate and documented in code — but any consumer asking "which lots had suspiciously close prices?"
must union LT-COM-10 with LT-COM-12.

**O-16 — [TO KNOW] `LT-AWD-01` is fully subsumed by `LT-COM-01`.**
All **1,693** LT-AWD-01 triggers also trigger LT-COM-01 on the same lot — logically necessary ("all bids except the
winner disqualified" ⟹ exactly one valid bid). An all-but-winner-disqualified lot always has exactly one valid bid,
never zero, so LT-COM-01's zero-valid-bid `not_applicable` gate (see its README) never breaks this relationship. The
converse does not hold. The reverse-direction check (LT-AWD-01 ⟹ LT-AWD-04) does **not** hold either: 1,128 of 1,693
LT-AWD-01 lots do not trigger LT-AWD-04, which is expected — a 2-bid lot with 1 disqualification is a 50% disqualified
share, below LT-AWD-04's threshold. 519 lots trigger LT-AWD-04 without LT-AWD-01.

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

**O-20 — [QUESTION] `LT-COM-01` / `LT-COM-02` still trigger on 55% / 67% of evaluable lots.**
Far above every other indicator (next highest is `LT-COM-03` at 30.6%). Of 12,961 evaluable lots, 5,572 (43%) had
exactly **one** bidder and 3,125 (24%) had two — the distribution is data-driven, not a threshold artefact, and
excluding zero-valid-bid lots (LT-COM-01's `not_applicable` gate, see its README) does not change that picture. A "red
flag" that fires on more than half the assessable population carries little discriminating power, whatever its
correctness. Confirm with the product owner whether these are intended as risk *flags* or as descriptive context.

**O-21 — [QUESTION] `LT-TRA-08` (37) and `LT-TRA-09` (34) trigger on well under 1% of an already tiny base.**
Both read a single boolean ATN-1 field (`ieskinysTeismui`, `elektroninisPirkimas`) over ~5,800 evaluable procurements.
Rates of 0.64% / 0.58% are plausible for court challenges but surprising for non-electronic procurement. Worth sampling
a handful to confirm the fields are populated meaningfully rather than defaulted.

### Pipeline and data-integrity checks (all passed)

**O-22 — [TO KNOW] Signal accounting reconciles exactly; nothing was silently dropped.**
`RiskDecisionEngine.evaluateAll` isolates a failing indicator per subject by *omitting* that subject's signal, which
would be invisible in the run status. The arithmetic in §2 confirms it did not happen: evaluated = written =
4,037,222 = the exact product of subjects × indicators per grain. Additional integrity sweeps, all clean:
0 `triggered` rows with a null `raw_value`, 0 `triggered` rows carrying `missing_data`, 0 `insufficient_data` rows with
an empty `missing_data`, 1 distinct `data_as_of` across all decisions, 0 `procurement_id` values appearing under both
sources.

**O-23 — [TO KNOW] The decisions-vs-source-rows gap is deduplication, not data loss.**
`v_pirkimas_v2` returns more rows than distinct `(saltinis, pirkimoNumeris)` keys — some `cvpp` procurement numbers
appear more than once (republished notices). `PROCUREMENT_PAGE_SQL`'s
`DISTINCT ON (saltinis, "pirkimoNumeris") ... ORDER BY ... "paskelbimoData" DESC NULLS LAST` deliberately keeps only the
most recently published row per key, so a duplicate source row never produces a duplicate decision. Likewise
`orphanLotsDropped = 97` reflects lots that had no parent procurement row at the moment the Reader ran — this count
naturally drifts as new orphan lots arrive between warehouse ingest and the risk run; it is not evidence of a defect.
Both are read-model design choices, not silent drops — no procurement is lost.

**O-24 — [TO KNOW] `LT-PRI-11` moved from `Accepted` to `Cannot implement`, and the reason is structural.**
Not a scheduling decision: `indicators-canonical.md` now records that "supplier bid much higher than for a comparable
contract" needs cross-procurement price commensurability, which `v_dalyviai."pasiulymoKaina"` cannot provide (same
`kainosIsraiskaId` root cause as **O-19**), and that no ingested source carries the quantity or line-item breakdown a
"comparable contract" would require. So the §1 gap is closed by implementing two of the three and reclassifying the
third — there is no queued build work left from that finding.

**O-25 — [POTENTIAL BUG] `risk_evaluation_runs` records no code/commit provenance at all.**
Earlier revisions of this document described `resolveCodeCommit()` recording `git rev-parse HEAD` into a `code_commit`
column, with the caveat that an uncommitted working tree makes that field misleading. That whole mechanism is gone: the
2026-09 schema flattening (`migrations/risk/001_risk.sql`) rewrote `risk.risk_evaluation_runs` from scratch with
`id, data_as_of, started_at, finished_at, status, statistics, error` only — no `code_commit`, and nothing in the repo
still writes one. So the gap is now total rather than partial: there is currently no way to tell which code version
produced a given run. Cheap remedy: write `git rev-parse HEAD` (plus a dirty marker from `git status --porcelain`) into
`statistics` or a new column, so a reader can at least see what likely produced a run.

**O-26 — [POTENTIAL BUG] The risk integration tests wipe the same database real runs write to.**
`test/risk/runEvaluation.it.ts` opens with `DELETE FROM risk.risk_signals` / `risk_procurement_decisions` /
`risk_evaluation_runs`, and `test/risk/write.it.ts` deletes the latter two — unscoped, against the `riskDb` pool, which
in dev points at the same local Postgres (`docker/risk/compose.yml`, port 15432) that `npm run risk:run`
writes to. Running `npm run test:integration` therefore destroys whatever full-batch output is sitting in the local risk
database — this is why the database currently holds exactly one run (see §0) instead of a history of past batches. The
public-schema fixtures are careful here — `testPublicDb.ts` truncates only its own named test tables — but the `risk.*`
cleanup is not scoped at all. Worth pointing the integration tests at a separate database or schema, or at minimum
scoping the deletes to runs the test itself opened, before anyone treats a local batch result as durable.

### Manual deep-dive candidates

- The two 13-indicator procurements `cvpis:2089505`, `cvpis:3501149` and the five 12-indicator ones listed in §2.1 —
  either strong true positives or evidence that co-triggering indicators share one data defect (**O-10** makes the
  latter plausible: both 13-indicator cases include the LT-COM-12/LT-COM-13 pair).
- A sample of the 213 `KSPĮ`-cited bids LT-COM-21 flags via `legalBasis.ts`'s law-equivalence mapping (see its README),
  to confirm the legal mapping holds in practice as well as on paper.
- A sample of the 1,320 zero-valid-bid lots LT-COM-01 reads as `not_applicable`, to confirm they read as failed
  procedures rather than a data gap.
- A sample of the LT-TRA-06 / LT-OTH-03 / LT-OTH-04 signals that depend on `procedureOutcome.lots`, to confirm the
  latest ATN-1 report revision is the right one to judge in each case.
- `cvpis:7213562`, whose procurement carries 14 ATN-1 report revisions, as a stress case for the "keep the latest
  revision per lot" logic in `procurementReader.ts`.

## 5. Test verification

335 unit tests under `modules/risk`/`test/risk` pass (verified directly; `test:integration`'s 54 risk integration tests
were not re-run here, since they would wipe the run this document reports — see **O-26**). `npm run check` reports
**zero** type errors anywhere under `modules/risk` or `test/risk` — the `readonly string[].sort()` error previously
noted at `test/risk/procurementReader.it.ts:456` is gone. The repo's 58 remaining type errors are all
`modules/etar`/`eTar` filename-casing collisions, unrelated to this service. The unrelated failures in
`test/jarReadSql.test.ts` and the Quickwit/Typesense-dependent `test/mcp/*.it.ts` predate this document and need those
services running.

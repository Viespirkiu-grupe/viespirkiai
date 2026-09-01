# Procurement Risk Decision Service — Full-Batch Execution Results

Status: draft — QA starting point

Snapshot of the current full-data run of the **4.1 Procurement Risk Decision Service** indicators ([
`indicators-canonical.md`](../indicators-canonical.md)), read directly from `risk.risk_signals` and
`risk.risk_procurement_decisions` (local risk Postgres, `docker/risk/compose.yml`), cross-checked against the source
warehouse views (`v_pirkimas_v2`, `v_pirkimo_dalis_v2`, `ppa.*`) on the main database.

## 0. Run identification

Two full-data runs are referenced here. **Run 676** is the batch this document originally reported. **Run 719** is a
re-run on the same warehouse after the four defects marked **[FIXED]** in §4 were repaired; every §3 table below is
run 719, and each fixed observation states its own before/after.

| Field                                             | Run 676                                      | Run 719 (current)                            |
|---------------------------------------------------|----------------------------------------------|----------------------------------------------|
| `code_commit`                                     | `dc8df145` ("updated after migration")       | `5fba5ad3` + uncommitted fixes¹              |
| `data_as_of` / `started_at`                       | 2026-09-01 11:08:33 UTC                      | 2026-09-01 12:34:52 UTC                      |
| `finished_at` (wall time)                         | 11:11:14 UTC (161.3 s)                       | 12:36:39 UTC (106.7 s)                       |
| `status`                                          | `succeeded`                                  | `succeeded`                                  |
| Pages processed / failed                          | 531 / **0**                                  | 531 / **0**                                  |
| Procurements evaluated                            | 265,276                                      | 265,286                                      |
| Signal rows (evaluated = written)                 | 4,036,908                                    | 4,037,088                                    |
| `triggered` signal rows                           | 35,173                                       | 34,049                                       |
| Orphan lots dropped by the Reader                 | 97                                           | 97                                           |
| Decisions with zero signal rows                   | 0                                            | 0                                            |
| Distinct `run_id` across all decision rows        | 1                                            | 1                                            |

¹ `resolveCodeCommit()` records `git rev-parse HEAD`, which does not reflect an uncommitted working tree — run 719's
recorded commit is the parent of the fixes it actually ran. Worth knowing before trusting `code_commit` to identify
what produced a run; see **O-25**.

The 10-procurement / 180-signal difference between the two runs is warehouse drift over the 86 minutes between them,
not an effect of the fixes: the fixes move signals between states, they never add or remove a subject.

## 1. Coverage: canonical "Accepted" vs. actually deployed — now aligned

The coverage gap reported in the previous revision (canonical catalogue marking 27 indicators `Accepted` while only 24
were registered) is **closed**. A mechanical diff of the `Accepted` rows in `indicators-canonical.md` against the
`DISTINCT indicator_id` values actually written by the run is empty in both directions (checked against both
runs):

| Source                                          | Count  |
|-------------------------------------------------|--------|
| `indicators-canonical.md` rows noted `Accepted` | **26** |
| Classes in `modules/risk/deployedIndicators.ts` | **26** |
| Distinct `indicator_id` in the run's signals     | **26** |

The three previously-missing `bid` indicators were resolved as follows:

| Code      | Canonical indicator                                     | Resolution                                                          |
|-----------|---------------------------------------------------------|---------------------------------------------------------------------|
| LT-COM-21 | Non-genuine, incomplete, or incapable bid               | Implemented (`0720a5c`-era work), registered, ran in this batch     |
| LT-PRI-09 | Heavily discounted bid                                  | Implemented, registered, ran in this batch                          |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract | Re-triaged to **`Cannot implement`** — see §4, observation **O-24** |

Every indicator now carries `indicator_version = 1`; no version skew exists in the signal set.

## 2. Overall summary

Run 719.

| Metric                                                                | Value                                         |
|-----------------------------------------------------------------------|-----------------------------------------------|
| Total procurements investigated (`risk_procurement_decisions` rows)   | **265,286**                                   |
| — sourced from `cvpp`                                                 | 213,435 (80.5%)                               |
| — sourced from `cvpis`                                                | 51,851 (19.5%)                                |
| Total signal rows produced (`risk_signals`)                           | 4,037,088 (evaluated = written; 0 lost)       |
| Total `triggered` signal rows                                         | 34,049                                        |
| Procurements with **at least one** `triggered` signal (any indicator) | **9,455** (3.6% of all procurements)          |
| — of which sourced from `cvpp`                                        | **0**                                         |
| — of which sourced from `cvpis`                                       | **9,455** (18.2% of all `cvpis` procurements) |
| Distinct lot subjects evaluated                                       | 49,594                                        |
| Distinct bid subjects evaluated                                       | 30,810                                        |

The signal count reconciles exactly against the subject universe, which is the strongest available evidence that no
indicator silently dropped a subject:

```
265,286 procurements × 13 procurement-subject indicators = 3,448,718
 49,594 lots         × 10 lot-subject indicators         =   495,940
 30,810 bids         ×  3 bid-subject indicators         =    92,430
                                                    total = 4,037,088  ✓ matches risk_signals exactly
```

**Every triggered signal, at every subject grain (procurement, lot, bid), belongs to a `cvpis`-sourced procurement.**
`cvpp`-sourced procurements never trigger anything — the `not_applicable` count sits at exactly 213,435 on every
procurement-level indicator except LT-PRO-08 (225,586; see **O-12**). This is by design (see **O-02**), but it means
the service is silent on 4 out of 5 procurements in the warehouse.

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

Of the 9,455 triggering procurements, **3,416 (36%) trigger only** `LT-PRO-01` / `LT-PRO-05` / `LT-PRO-08` — the three
indicators that need no ATN-1 report data. See **O-01**.

## 3. Deployed indicators — coverage matrix by subject

Counts are row counts in `risk.risk_signals` for **`run_id = 719`**. **Times triggered** = `state = 'triggered'` rows
(one row per lot/bid for lot/bid-subject indicators, so it can exceed procurement count). **Procurements triggered**
= distinct `decision_id` among triggered rows. **Evaluable** = triggered + not_triggered. **Trigger rate** =
triggered ÷ evaluable, i.e. excluding `insufficient_data`/`not_applicable` subjects the indicator couldn't evaluate
at all. Rows whose numbers moved because of a §4 fix are marked **[FIXED]**, with the run-676 value in brackets.

### 3.1 Subject `procurement` (13 indicators)

| Code      | Indicator                                            | Category         | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|------------------------------------------------------|------------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-COM-03 | Only one supplier invited or consulted               | Competition      |           1,613 |                  1,613 |         3,658 |            46,580 |        213,435 |     5,271 |       30.60% |
| LT-OTH-03 **[FIXED]** | Evaluation/decision period anomalously short or long | Other |     521 *(532)* |          521 *(532)* |         4,352 |            46,978 |        213,435 |     4,873 |       10.69% |
| LT-OTH-04 **[FIXED]** | Award-to-signature period unusually long | Other             |     278 *(283)* |          278 *(283)* |         4,174 |            47,399 |        213,435 |     4,452 |        6.24% |
| LT-OTH-05 | Procedure unsuccessful or award not contracted       | Other            |             894 |                    894 |         4,960 |            45,997 |        213,435 |     5,854 |       15.27% |
| LT-PRI-05 | High estimated value                                 | Pricing          |             878 |                    878 |        16,641 |            34,332 |        213,435 |    17,519 |        5.01% |
| LT-PRI-06 | High estimated framework value                       | Pricing          |               3 |                      3 |         5,647 |            46,201 |        213,435 |     5,650 |        0.05% |
| LT-PRO-01 | Unjustified non-competitive procedure                | Procedure design |           2,429 |                  2,429 |        49,422 |                 0 |        213,435 |    51,851 |        4.68% |
| LT-PRO-05 | Accelerated procedure without adequate grounds       | Procedure design |             202 |                    202 |        51,649 |                 0 |        213,435 |    51,851 |        0.39% |
| LT-PRO-08 | Short submission/advertisement period                | Procedure design |           1,828 |                  1,828 |        36,999 |               873 |        225,586 |    38,827 |        4.71% |
| LT-TRA-06 **[FIXED]** | Procurement decision or reason not documented | Transparency |      447 *(452)* |          447 *(452)* |         5,407 |            45,997 |        213,435 |     5,854 |        7.64% |
| LT-TRA-07 | Complaint received                                   | Transparency     |             960 |                    960 |         4,858 |            46,033 |        213,435 |     5,818 |       16.50% |
| LT-TRA-08 | Procurement challenged in court                      | Transparency     |              37 |                     37 |         5,741 |            46,073 |        213,435 |     5,778 |        0.64% |
| LT-TRA-09 | Procurement not conducted electronically             | Transparency     |              34 |                     34 |         5,810 |            46,007 |        213,435 |     5,844 |        0.58% |

At `procurement` subject grain, one triggered row always equals one procurement, so those two columns are identical by
construction. Note the three-tier evaluable base: 51,851 (needs only `pirkimoBudas`), 38,827 / 17,519 (needs
`v_pirkimas_v2` fields), ~4,400–5,900 (needs the ATN-1 report).

### 3.2 Subject `lot` (10 indicators)

| Code      | Indicator                            | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|--------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-AWD-01 | All bids except winner disqualified  | Award       |           1,693 |                    916 |        11,268 |            36,589 |             44 |    12,961 |       13.06% |
| LT-AWD-02 | Lowest bid disqualified              | Award       |             680 |                    434 |        10,199 |            38,671 |             44 |    10,879 |        6.25% |
| LT-AWD-03 | Poorly supported disqualification    | Award       |             369 |                    250 |        12,592 |            36,589 |             44 |    12,961 |        2.85% |
| LT-AWD-04 | Excessive share of disqualified bids | Award       |           1,084 |                    595 |        11,877 |            36,589 |             44 |    12,961 |        8.36% |
| LT-COM-01 **[FIXED]** | Single valid bid         | Competition |   6,450 *(7,770)* |      2,884 *(3,248)* |         5,191 |            36,589 |  1,364 *(44)* |    11,641 |       55.41% |
| LT-COM-02 | Low number of bidders                | Competition |           8,697 |                  3,610 |         4,264 |            36,589 |             44 |    12,961 |       67.10% |
| LT-COM-10 | Identical bid prices                 | Competition |             198 |                    143 |        10,681 |            38,671 |             44 |    10,879 |        1.82% |
| LT-COM-11 | Fixed-multiple bid prices            | Competition |             135 |                    106 |        10,744 |            38,671 |             44 |    10,879 |        1.24% |
| LT-COM-12 | Suspiciously close bid prices        | Competition |             720 |                    550 |        10,159 |            38,671 |             44 |    10,879 |        6.62% |
| LT-COM-13 | Wide disparity in bid prices         | Competition |             625 |                    402 |        10,254 |            38,671 |             44 |    10,879 |        5.75% |

At `lot` grain, "times triggered" counts lots, "procurements triggered" counts the (fewer) distinct procurements those
lots belong to — a multi-lot procurement can trigger the same indicator more than once. The two evaluable bases
(12,961 vs 10,879) split cleanly on whether the indicator also needs a usable `pasiulymoKaina`; LT-COM-01's 11,641 is
lower again because its fix moved 1,320 all-bids-rejected lots out of the evaluable population.

### 3.3 Subject `bid` (3 indicators)

| Code      | Indicator                                 | Category    | Times triggered | Procurements triggered | Not triggered | Insufficient data | Not applicable | Evaluable | Trigger rate |
|-----------|-------------------------------------------|-------------|----------------:|-----------------------:|--------------:|------------------:|---------------:|----------:|-------------:|
| LT-COM-20 | Unexpected or frequent bid withdrawal     | Competition |              72 |                     39 |        29,180 |             1,480 |             78 |    29,252 |        0.25% |
| LT-COM-21 **[FIXED]** | Non-genuine, incomplete, or incapable bid | Competition | 2,955 *(2,740)* |    1,180 *(1,067)* |        26,297 |             1,480 |             78 |    29,252 |       10.10% |
| LT-PRI-09 **[FIXED]** | Heavily discounted bid        | Pricing     |             247 |                    179 | 9,298 *(9,793)* |               853 | 20,412 *(19,917)* | 9,545 |        2.59% |

`LT-PRI-09`'s much larger `not_applicable` count is by design: it evaluates only each lot's inferred winning bid, and
only where that winner is also the lot's lowest valid price (**O-05**), so every other bid is `not_applicable`.

## 4. Observations

Tags: **[BUG]** obvious defect, fix first · **[POTENTIAL BUG]** likely defect, needs confirmation · **[QUESTION]**
raises doubts that need an answer · **[TO KNOW]** not a defect, but misleading unless known.

### Coverage and data availability

**O-01 — [QUESTION] The service is effectively evaluating 2.2% of the warehouse at the ATN-1-backed grain.**
Only **5,857 of 265,286 procurements (2.2%)** produce a single `triggered`/`not_triggered` signal from any indicator
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
3,416 of the 9,455 triggering procurements trigger nothing except `LT-PRO-01`, `LT-PRO-05`, or `LT-PRO-08`. Any
"risk score" built by counting triggered indicators will systematically rate ATN-1-covered procurements higher than
non-covered ones purely because more indicators could run against them.

### Correctness of individual indicators

**O-05 — [FIXED] `LT-PRI-09` measured a "discount" against a winner that was not the price leader.**
*Original finding.* Of the 4,267 lots where the relative discount was computed, **495 (11.6%) yielded a negative
value** — the inferred winner (`eileNumeris = 1`, not rejected) was more expensive than another valid bid — plus 87
exact ties.

*What the investigation established.* The winner inference is **correct**; the comparator was wrong. `eileNumeris`
comes from `ppa."pasiulymuEile"` — the *pasiūlymų eilė*, the buyer's own **award** ranking under whatever criterion
the procurement used, which `domain-model.md` §3 already documents as the winner proxy. Under an
economically-most-advantageous-tender (MEAT) award the buyer scores quality alongside price, so the #1-ranked bid
legitimately need not be the cheapest. The data bears this out: among lots where the ranked-first bid is not the
cheapest, **73% carry a scoring value** in `ppa."pasiulymuEile"."kainosSantykis"` (`100`, `95`, `100 balų`, `Kaina`),
against **24%** of lots where the winner *is* cheapest. What was wrong is OCP-R058's own statistic —
`(second-lowest valid bid − winning bid) / winning bid` — which presupposes the winner *is* the price leader. Where
it is not, there is no discount to measure and the subtraction only ever produced a negative number that could never
trigger, while the signal still claimed `not_triggered`: "evaluated, no red flag" about a lot whose premise the
indicator never satisfied.

*Fix.* `LtPri09Decision.isEligible` now gates a winner that any valid, usably-priced competitor undercuts to
`not_applicable` (`isLowestValidPricedBid` in `decision.ts`), after the existing winner and price checks. A cheaper
*disqualified* bid does not take the concept away — it was never a real alternative — so that case still evaluates.
The gate also makes `assessRisk`'s `secondLowestValidPrice` genuinely the second-lowest, since the winner is now
provably the lowest. `formulaLt` and `limitationLt` restated accordingly; the README gains a "Winner is not always
the price leader" section.

*Measured (run 719).* **Zero** negative relative discounts remain anywhere in the output (was 495). Triggers are
unchanged at 247 — the fix removes no true positive — while `not_triggered` falls 9,793 → 9,298 and
`not_applicable` rises 19,917 → 20,412. The trigger rate becomes honest: **2.59%** of 9,545 comparable winning bids,
rather than 2.46% of 10,040. Tests: a `winnerNotCheapest` end-to-end case, a `cheaperCompetitorDisqualified` case
proving the gate is valid-bids-only, a `winnerTiedForLowest` case (still comparable, discount exactly 0), and an
invariant test that no scenario can produce a negative discount.

*Still open.* The gate stops the meaningless comparison; it does not make the winner inference exact. A MEAT-awarded
lot whose winner happens also to be cheapest is still judged on the assumption that the ranking means what this
indicator needs. Recorded in the README's follow-ups.

**O-06 — [FIXED] `LT-COM-21` matched raw display strings and covered only one of the two procurement laws.**
*Original finding.* The parameter list held three exact strings (`VPĮ 45 str. 1 d. 1/3/4 p.`), so 211 disqualified
bids citing `KSPĮ 58 str. 1 d. 1/3/4 p.` never triggered, alongside five free-text near-misses.

*What the investigation established — the legal equivalence, from the statutes themselves.* Both articles were read
in full. VPĮ 45 str. 1 d. and KSPĮ (also abbreviated `PĮ`) 58 str. 1 d. share a title ("Tiekėjo ir jo pateiktos
paraiškos ir pasiūlymo vertinimo bendrieji principai"), open with the same sentence ("laimėjusį nustato ekonomiškai
naudingiausią pasiūlymą, jeigu tenkinamos visos šios sąlygos"), and list the **same six conditions in the same
order**:

| Point | VPĮ 45 str. 1 d.                                           | KSPĮ 58 str. 1 d.                                          |
|-------|------------------------------------------------------------|------------------------------------------------------------|
| 1 p.  | conforms to the notice and procurement documents (43 str.) | conforms to the notice and procurement documents (56 str.) |
| 2 p.  | bidder not excluded (46 str.)                              | bidder not excluded (59 str. 1 d.)                         |
| 3 p.  | meets the qualification requirements (47/48/54 str.)       | meets the qualification requirements (59/60 str.)          |
| 4 p.  | clarified/supplemented in time (šio str. **3** d.)         | clarified/supplemented in time (šio str. **5** d.)         |
| 5 p.  | price not too high and unacceptable                        | price not too high and unacceptable                        |
| 6 p.  | none of the 57 str. 3 d. circumstances                     | none of the 66 str. 3 d. circumstances                     |

So a point number means the same ground under either law. This needed checking rather than assuming: the enclosing
*dalis* numbering does **not** correspond (4 p. refers back to 3 d. under VPĮ and to 5 d. under KSPĮ — the offset the
Viešųjų pirkimų tarnyba's own guidance writes as "VPĮ 45 straipsnio 3 dalies (PĮ 58 straipsnio 5 dalies)"), and the
warehouse dictionary holds a `KSPĮ … 6 p.` with no VPĮ counterpart present, both of which suggested a possible
mismatch until the point text settled it.

*What the investigation also established — the field is free text.* `ppa."atmetimoTeisiniaiPagrindai"` has 23 rows
and is nominally a dropdown, but it holds `"ę"`, `"Lietuva"`, the spreadsheet's own column header, a whole prose
paragraph citing the article mid-sentence, the law's name spelled out in full, and citations missing their trailing
full stop. Exact-string comparison was the root defect; the KSPĮ gap was the larger symptom.

*Fix.* Two parts. (1) The three KSPĮ citations join the parameter list — still written as legal citations a reviewer
recognises, not tuples. (2) New `legalBasis.ts` parses `(law, straipsnis, dalis, punktas)` out of the free-text
value, and both sides of the comparison go through it; `PĮ` normalises to KSPĮ (guarded by a lookbehind so it cannot
match inside `VPĮ`/`KSPĮ`), and `matchedLegalBasis` is recorded in `rawValue` for QA. Verified against **all 23**
dictionary rows: `"Viešųjų pirkimų įstatymo 45 str. 1 d. 1 p"` and the prose row now match; `"PĮ 58 str. 1 d. 4 p."`
resolves to KSPĮ and matches; `"VPĮ 45 str. 1 d. 5 p"` — one character from a match under raw comparison — still
correctly does not; the prose row's `"Bendrųjų Pirkimo sąlygų 18.1.7. p."` is ignored (no `str.`/`d.`, so not a
statutory citation); `"Kita"`, the empty string and bare prose grounds still yield nothing, which is LT-AWD-03's
concept.

*Measured (run 719).* Triggers **2,740 → 2,955** (+215: 213 from KSPĮ — 158 on 1 p., 22 on 3 p., 33 on 4 p. — and 2
from the free-text VPĮ variants). Rate 9.37% → **10.10%** of 29,252 evaluable bids. `insufficient_data` (1,480) and
`not_applicable` (78) unchanged: nothing moved except `not_triggered` → `triggered`. Six new unit tests cover the
KSPĮ twin, the KSPĮ price ground staying excluded, the spelled-out law, the prose citation, the no-trailing-stop
price ground, and the citation-free prose ground.

**O-07 — [FIXED] `LT-COM-01` "Single valid bid" fired on lots with *zero* valid bids.**
*Original finding.* The threshold `validBids <= 1` triggered on 1,320 lots where **every** bid was rejected — 17.0%
of the indicator's whole triggered population — contradicting its own published description ("Pirkimo dalyje po
pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas) pasiūlymas").

*What the investigation established.* `validBids` is
`count(DISTINCT tiekejoKodas) FILTER (WHERE atmetimoPriezastis IS NULL)` in `LOT_PARTICIPATION_SQL`, so zero means
every listed supplier carries a rejection reason — a genuine "all bids rejected" state, not a data gap (815 of the
1,320 were single-bidder lots, the rest up to 11 bidders). That is a **failed procedure**, not a non-competitive
award: OCP-R018 is about a single supplier facing no competition *for a contract it went on to win*, and there is no
award here at all. The neighbouring concepts already cover it — of those 1,320 lots, 302 procurements also trigger
LT-OTH-05 ("procedure unsuccessful or award not contracted") and 214 lots trigger LT-AWD-04.

*Fix.* `assessRisk` returns `not_applicable` for `validBids === 0`, placed next to the existing `totalBids === 0`
branch (both read `participation`, which only `assessRisk` has proved non-null). The parameter keeps its meaning — a
future `maximumValidBids: 2` still works — so the effective trigger is `1 ≤ validBids ≤ maximumValidBids`.
`formulaLt` and `limitationLt` updated; the README gains a "Zero valid bids is a different concept" section
distinguishing this from the `totalBids === 0` insufficient-data case.

*Measured (run 719).* Triggers **7,770 → 6,450**, and **every remaining trigger is a lot with exactly one valid
bid** — the published description is now exactly what the indicator does. All 1,320 zero-valid-bid lots read
`not_applicable` (44 → 1,364). Procurements triggered 3,248 → 2,884; evaluable base 12,961 → 11,641; rate 59.95% →
**55.41%**. Two new unit tests cover the multi-bidder and sole-bidder all-rejected cases.

*Note.* This does not resolve **O-20** — at 55.41% LT-COM-01 still fires on more than half its evaluable
population, and whether that is a useful red flag remains a product question.

**O-08 — [FIXED] `procedureOutcome.lots` carried one entry per report revision, not one per lot.**
*Original finding.* 363 of 4,883 evaluable `LT-OTH-03` rows carried more `periods` entries than the procurement has
lots; worst case 34 entries for 2 lots (`cvpis:7213562`).

*What the investigation established.* `v_pirkimo_pabaiga_v2`'s own header declares its grain as
"(pirkimoNumeris, daliesNumeris)" — and that is **false**. It reads `ppa."ataskaitos" JOIN ppa."proceduruPabaiga"`,
and a procurement can carry more than one ATN-1 report: **445 do, one carries 14**. The view's real grain is
(report, lot) — **12,275 rows for 10,841 distinct lots** warehouse-wide, of which 11,037 remain after collapsing
identical payloads, i.e. 196 lots carry genuinely *differing* outcomes across revisions. `PROCEDURE_OUTCOME_SQL`
aggregated those raw with `json_agg`, having already used `array_agg(DISTINCT …)` for the sibling
`proceduruPabaigos` — the duplication was seen for one field and missed for the other.

Three indicators read `lots`, and the original assessment that "the verdict is unaffected" was **wrong for all
three**: repeating an *identical* entry cannot flip a `.some(...)`, but a superseded revision carries its own
`proceduruPabaiga`, `sprendimoPriemimoData` and `sprendimoPriezastys`, so it can contribute a period computed from a
stale decision date, qualify a lot through an outcome the current revision replaced, or — for LT-TRA-06, which
triggers when *any* entry has a blank reason — flag a procurement whose current revision documents it.

*Fix.* Applied at the reader, where the grain is set, not in the three indicators. `PROCEDURE_OUTCOME_SQL` now ranks
rows with `row_number() OVER (PARTITION BY pirkimoNumeris, daliesNumeris ORDER BY ataskaitosData DESC, …)` and keeps
rank 1 in the `lots` aggregate, with deterministic tie-breaks so a re-run reproduces the same row — the same
"keep the latest" idiom `PROCUREMENT_PAGE_SQL` already uses for republished procurements. Deliberately **not**
applied to `proceduruPabaigos` or the `bool_or`'d report-level flags (`preliminariSutartis`, `pretenzijaPateikta`,
`ieskinysTeismui`, `elektroninisPirkimas`): those aggregate across every revision on purpose, and narrowing them
would change what they mean. `v_pirkimo_pabaiga_v2`'s misleading header comment is corrected, since it is what led
the query astray.

*Measured (run 719).* **Zero** signals now carry a duplicated `daliesNumeris` (was 363). LT-TRA-06 **452 → 447**
triggers — five procurements flagged only by a revision the buyer had already replaced. LT-OTH-03 **532 → 521**
(evaluable 4,883 → 4,873) and LT-OTH-04 **283 → 278** (evaluable 4,484 → 4,452), from stale decision dates and
superseded outcome labels. A new integration test in `test/risk/procurementReader.it.ts` inserts two reports for one
procurement and asserts `lots` carries the later revision only, while `proceduruPabaigos` and the `bool_or`'d flags
still span both.

**O-09 — [FIXED] `LT-PRI-09`'s `limitationLt` claimed most triggers were the "exactly double" data-entry artefact.**
The shipped text stated that a manual review found *"dauguma jų yra santykinis skirtumas lygiai (arba beveik lygiai)
dvigubas"*. Across run 676's 247 triggers only **11 (4.5%)** fall in the 0.98–1.02 band. The README explains the
discrepancy: that hand-check was measured against `public.v_dalyviai` while the `_v2` views were unpopulated, and it
does not carry over to the `v_dalyviai_v2` population the indicator actually reads. `limitationLt` has been
rewritten — it now describes the MEAT/price-leader limitation from **O-05** and keeps the unit-vs-total data-entry
confusion as a real but non-dominant caveat, cross-referencing `LT-COM-13`. The README's own measurement section is
annotated rather than deleted, so the earlier finding stays auditable.

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

**O-12 — [TO KNOW] `LT-PRO-08`'s `not_applicable` (225,586) legitimately exceeds the `cvpp` total (213,435).**
The extra 12,151 are `cvpis` *rinkos konsultacija* (pre-procurement market consultation) procurements, excluded by
`excludedProcedures` in `isEligible()` because a market consultation has no submission-of-tenders deadline. The
indicator's README records that naively including them made up ~47% of the naive triggered population. Expected
behaviour; it is also why LT-PRO-08's evaluable base (38,827) is far larger than its ATN-1-dependent peers.

**O-13 — [TO KNOW] `LT-PRO-01` and `LT-PRO-05` produce zero `insufficient_data` by design.**
Both read only `pirkimoBudas`, which the shared eligibility gate has already proved non-null, so there is no remaining
data requirement that can fail. They therefore evaluate all 51,851 `cvpis` procurements — 10× the ATN-1-dependent
indicators' base. Nothing is being swallowed into `not_triggered`.

**O-14 — [TO KNOW] `LT-COM-01` triggering does not imply `LT-COM-02` triggering (565 lots).**
`LT-COM-01` counts **valid** bids (`1 ≤ validBids ≤ 1`); `LT-COM-02` counts **all** bidders (`totalBids < 3`). A lot
with five bidders of whom four were disqualified trips LT-COM-01 but not LT-COM-02. Both readings are defensible; a
reviewer expecting nesting will misread the pair. **O-07**'s fix reduced the gap from 779 lots to 565 — the 214
zero-valid-bid lots in the difference were never LT-COM-01's concept to begin with.

**O-15 — [TO KNOW] `LT-COM-10` triggering does not imply `LT-COM-12` triggering (176 of 198 lots).**
`findClosestMatch()` in `LT-COM-12` explicitly skips `relativeDifference <= 0`, i.e. exactly identical prices, because
that is LT-COM-10's stronger concept. So 176 lots with identical bid prices read `not_triggered` on "suspiciously close
bid prices". Deliberate and documented in code — but any consumer asking "which lots had suspiciously close prices?"
must union LT-COM-10 with LT-COM-12.

**O-16 — [TO KNOW] `LT-AWD-01` is fully subsumed by `LT-COM-01`.**
All **1,693** LT-AWD-01 triggers also trigger LT-COM-01 on the same lot — logically necessary ("all bids except the
winner disqualified" ⟹ exactly one valid bid), and unaffected by **O-07**'s fix, since an all-but-winner-disqualified
lot has exactly one valid bid, never zero. The converse does not hold. The reverse-direction check the previous
revision suggested (LT-AWD-01 ⟹ LT-AWD-04) does **not** hold: 1,128 of 1,693 LT-AWD-01 lots do not trigger
LT-AWD-04, which is expected — a 2-bid lot with 1 disqualification is a 50% disqualified share, below LT-AWD-04's
threshold. 519 lots trigger LT-AWD-04 without LT-AWD-01.

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
Far above every other indicator (next highest is `LT-COM-03` at 30.6%). **O-07**'s fix lowered LT-COM-01 from 59.95%
to 55.41% by removing the zero-valid-bid lots, but it did not change the picture — the underlying distribution is
data-driven, not a threshold artefact: of 12,961 evaluable lots, 5,572 (43%) had exactly **one** bidder and 3,125
(24%) had two. A "red flag" that fires on more than half the assessable population carries little discriminating
power, whatever its correctness. Confirm with the product owner whether these are intended as risk *flags* or as
descriptive context.

**O-21 — [QUESTION] `LT-TRA-08` (37) and `LT-TRA-09` (34) trigger on well under 1% of an already tiny base.**
Both read a single boolean ATN-1 field (`ieskinysTeismui`, `elektroninisPirkimas`) over ~5,800 evaluable procurements.
Rates of 0.64% / 0.58% are plausible for court challenges but surprising for non-electronic procurement. Worth sampling
a handful to confirm the fields are populated meaningfully rather than defaulted.

### Pipeline and data-integrity checks (all passed)

**O-22 — [TO KNOW] Signal accounting reconciles exactly; nothing was silently dropped.**
`RiskDecisionEngine.evaluateAll` isolates a failing indicator per subject by *omitting* that subject's signal, which
would be invisible in the run status. The arithmetic in §2 confirms it did not happen in either run: for run 719,
evaluated = written = 4,037,088 = the exact product of subjects × indicators per grain (4,036,908 for run 676). Additional integrity sweeps, all clean:
0 `triggered` rows with a null `raw_value`, 0 `triggered` rows carrying `missing_data`, 0 `insufficient_data` rows with
an empty `missing_data`, 1 distinct `data_as_of` across all decisions, 0 `procurement_id` values appearing under both
sources.

**O-23 — [TO KNOW] The decisions-vs-source-rows gap is deduplication, not data loss.**
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

**O-25 — [POTENTIAL BUG] `code_commit` records `git rev-parse HEAD`, which cannot describe an uncommitted run.**
`resolveCodeCommit()` (`services/procurement-risk/index.ts`) shells out to `git rev-parse HEAD`, so run 719 is
recorded against `5fba5ad3` — the parent of the fixes it actually executed. Any run from a dirty working tree is
attributed to code that did not produce it, which defeats the field's whole purpose (reproducing a run's output from
its recorded commit). Cheap remedy: append a dirty marker when `git status --porcelain` is non-empty, so a reader can
at least see the recorded hash is not the whole story.

**O-26 — [POTENTIAL BUG] The risk integration tests wipe the same database real runs write to.**
`test/risk/runEvaluation.it.ts` opens with `DELETE FROM risk.risk_signals` / `risk_procurement_decisions` /
`risk_evaluation_runs`, and `test/risk/write.it.ts` deletes the latter two — unscoped, against the `riskDb` pool,
which in dev points at the same local Postgres (`docker/risk/compose.yml`, port 15432) that `npm run risk:run`
writes to. Running `npm run test:integration` therefore destroys whatever full-batch output is sitting in the local
risk database: it deleted run 676 and its 265,276 decisions during this investigation, which is why §0 shows only run
719 in the database. The public-schema fixtures are careful here — `testPublicDb.ts` truncates only its own named
test tables — but the `risk.*` cleanup is not scoped at all. Worth pointing the integration tests at a separate
database or schema, or at minimum scoping the deletes to runs the test itself opened, before anyone treats a local
batch result as durable.

### Manual deep-dive candidates

- The two 13-indicator procurements `cvpis:2089505`, `cvpis:3501149` and the five 12-indicator ones listed in §2.1 —
  either strong true positives or evidence that co-triggering indicators share one data defect (**O-10** makes the
  latter plausible: both 13-indicator cases include the LT-COM-12/LT-COM-13 pair).
- A sample of the 213 `KSPĮ`-cited bids that **O-06** newly flags, to confirm the legal mapping holds in practice as
  well as on paper.
- A sample of the 1,320 lots **O-07** moved to `not_applicable`, to confirm they read as failed procedures.
- A sample of the 5 + 11 + 5 signals **O-08** changed on LT-TRA-06 / LT-OTH-03 / LT-OTH-04, to confirm the latest
  revision is the right one to judge in each case.
- `cvpis:7213562` (34 outcome entries for 2 lots before the fix, 2 after) as the worked example of **O-08**.

## 5. Fix status summary

| Observation | Verdict | Code changed | Measured effect (run 676 → 719) |
|-------------|---------|--------------|----------------------------------|
| **O-05** LT-PRI-09 winner not price leader | **[FIXED]** | `LT-PRI-09/decision.ts`, `definition.ts` | 495 negative discounts → **0**; triggers unchanged at 247; rate 2.46% → 2.59% |
| **O-06** LT-COM-21 KSPĮ + free-text citations | **[FIXED]** | `LT-COM-21/legalBasis.ts` (new), `decision.ts`, `definition.ts` | triggers 2,740 → **2,955** (+213 KSPĮ, +2 free-text); rate 9.37% → 10.10% |
| **O-07** LT-COM-01 zero valid bids | **[FIXED]** | `LT-COM-01/decision.ts`, `definition.ts` | triggers 7,770 → **6,450**; all 1,320 zero-valid lots now `not_applicable` |
| **O-08** duplicate `procedureOutcome.lots` | **[FIXED]** | `procurementReader.ts`, `v_pirkimo_pabaiga_v2.sql` | 363 duplicated-lot signals → **0**; LT-TRA-06 452 → 447, LT-OTH-03 532 → 521, LT-OTH-04 283 → 278 |
| **O-09** LT-PRI-09 stale limitation text | **[FIXED]** | `LT-PRI-09/definition.ts`, `README.md` | public text now matches the measured population |

All four fixes keep `indicator_version = 1`. Every deployed indicator is still on its first version with
`validFrom: 2026-01-01`, no signal history predates these runs (the risk database was reset before run 676), and the
codebase documents no rule for bumping the version — so splitting the signal history across two versions would cost
the composite primary key a join for no reader benefit. If any of these indicators has already been published
externally, that call should be revisited before the next run.

Verification: 335 unit tests and 54 risk integration tests pass; `npm run check` reports no new type errors in
`modules/risk` or `test/risk` (one pre-existing `readonly string[].sort()` error at
`test/risk/procurementReader.it.ts:456` is untouched). The unrelated failures in `test/jarReadSql.test.ts` and the
Quickwit/Typesense-dependent `test/mcp/*.it.ts` predate these changes and need those services running.

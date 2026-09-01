# LT-OTH-03 — Vertinimo (sprendimo priėmimo) laikotarpis nepagrįstai trumpas arba ilgas (evaluation/decision period anomalously short or long)

Source: this merges OCP-R061 ("decision period extremely short") and OCP-R062 ("decision period extremely long")
into one bidirectional indicator, cross-referenced against OLAF-CA08, OT-I05, and VPT-I10 in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[ocp.md](../../../../docs/indicators-story/indicators/ocp.md).

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`, following LT-OTH-05's grain
(the catalogue places LT-OTH-03 under the `procurement` subject, not `lot`). The formula triggers if **any** lot's
evaluation period breaches a bound — the opposite aggregation from LT-OTH-05's "every lot must fail", since a single
anomalous lot is itself the finding here, not something a well-behaved sibling lot can cancel out.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|-----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `concludedOutcomes`, `minimumDays`, `maximumDays` |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject                |
| `test/`         | How we know it works                                                                                |

`Subject.procurement.procedureOutcome.lots` (per-lot `daliesNumeris`/`proceduruPabaiga`/`sprendimoPriemimoData`)
comes from `modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL`, reading `public.v_pirkimo_pabaiga_v2` — the
same view LT-OTH-05 reads, at its natural per-lot grain rather than LT-OTH-05's collapsed cross-lot
`proceduruPabaigos`/`reportedAt`. `Subject.procurement.pasiulymuPateikimoTerminas` (the procurement's own submission
deadline) comes from `public.v_pirkimas_v2`, already merged onto every `Procurement` — no new view or reader change
was needed for that half.

## Why `lots`, not just `proceduruPabaigos`

LT-OTH-05 only ever needs to know *whether any* lot's outcome label is "concluded" — the collapsed, deduplicated set
of labels is enough. LT-OTH-03 needs a specific lot's *own* decision date paired with its *own* outcome label: a
multi-lot procurement can have one lot concluded on day 10 and another terminated on day 200, and only the first
pairing is meaningful for this indicator. `ProcurementProcedureOutcome.lots` (added to `types.ts` for this
indicator) carries the per-lot rows `PROCEDURE_OUTCOME_SQL` already reads, uncollapsed, so the two facts stay
correlated.

## One entry per lot, not per report revision

`v_pirkimo_pabaiga_v2`'s header calls its grain "(pirkimoNumeris, daliesNumeris)", but a procurement can carry more
than one ATN-1 report and the view emits a row per revision — its real grain is (report, lot): 12,275 rows for
10,841 lots warehouse-wide, with 445 procurements carrying more than one report and one carrying 14. Until run 676
`PROCEDURE_OUTCOME_SQL` aggregated those raw, so `procedureOutcome.lots` could arrive with a lot's entry repeated
once per revision — 34 entries for a two-lot procurement (`cvpis:7213562`), and up to 74 in one `rawValue`.
`PROCEDURE_OUTCOME_SQL` now keeps each lot's most recent revision only (`row_number()` over
`(pirkimoNumeris, daliesNumeris)` ordered by `ataskaitosData DESC`, with deterministic tie-breaks so a re-run
reproduces the same row). `proceduruPabaigos` and the `bool_or`'d report-level flags still deliberately span every
revision — only `lots` is narrowed.

Duplicates hurt this indicator two ways. The visible one: `rawValue.periods` was a wrong record of the
procurement's lot evaluation periods — 363 of 4,883 evaluable rows carried a repeated `daliesNumeris` — which any
consumer that counts or averages those entries reads as real lots. The subtler one: a superseded revision carries
its *own* `proceduruPabaiga` and `sprendimoPriemimoData`, so a lot could contribute a period computed from a stale
decision date, or qualify through an older revision's "concluded" outcome after the current one terminated it.
Repeating an identical period cannot flip `periods.some(...)`, but a differing one can — and did: run 719 dropped
**11 triggers** (532 → 521) and 10 procurements left the evaluable population (4,883 → 4,873) once each lot was
read at its latest revision.

## Why the formula only measures `concludedOutcomes` lots

A procedure's `sprendimoPriemimoData` is only reliably "the day the buyer finished evaluating submitted tenders"
when the procedure actually concluded in a contract. For every other outcome — terminated, all tenders rejected, no
bids received — the decision can legitimately predate the submission deadline entirely (e.g. the buyer cancels the
procedure before anyone was due to bid), which is not a "rushed evaluation" at all, just a different event with no
evaluation phase to time. Measured 2026-08 against the real warehouse: restricting to non-concluded lots produced
483/11,912 (4.1%) negative periods, of which 386 were exactly this "terminated before the deadline" pattern;
restricting to `concludedOutcomes` (the same five-phrasing list LT-OTH-05 uses) drops that to 64/9,321 (0.7%) — small
enough to treat as measurement noise (see the next section) rather than a distinct phenomenon requiring its own
scoping.

A negative period *within* the `concludedOutcomes` population is still included and still `triggered` — deciding to
award a contract before the tender deadline is arguably the most extreme "anomalously short" case the catalogue
concept describes, not a data artifact to exclude by construction. `test/fixtures.ts`'s
`oneLotDecidedBeforeDeadline` is exactly this case.

## Thresholds

Neither the OCP booklet nor OLAF/OpenTender/VPT state an operational day count for "extremely short"/"extremely
long" — both `minimumDays`/`maximumDays` are empirical, not sourced from a legal deadline. Measured 2026-08 against
the real warehouse (period = `sprendimoPriemimoData - pasiulymuPateikimoTerminas`, restricted to `concludedOutcomes`
lots, n=9,321):

| Percentile | 1  | 5 | 10 | 25 | 50 | 75 | 90 | 95  | 99  |
|-----------:|---:|--:|---:|---:|---:|---:|---:|----:|----:|
| Days       | 0  | 3 | 7  | 15 | 30 | 53 | 91 | 124 | 197 |

`minimumDays: 3` (below the 5th percentile) flags 408/9,321 (4.4%) as anomalously short; `maximumDays: 120` (just
below the 95th percentile) flags 536/9,321 (5.8%) as anomalously long — a combined ~10% trigger rate, in line with a
red flag that should be uncommon but not vanishingly rare. A random sample of both tails was read by hand: short
examples were same-day or next-day decisions on ordinary open-procedure lots with no other anomaly visible; long
examples were 120–250-day gaps, mostly on negotiated or larger open procedures — plausible genuine delays, not a
query artifact (no duplicate rows, no join fan-out). Re-run the throwaway Phase 6 script (see the plan template) if
this measurement needs refreshing.

## Scope

The parameter timeline applies to every `pirkimoBudas` the ATN-1/PPA report covers — same as LT-OTH-05, "how long
did the decision take" is meaningful for every procedure type the report records, so no method-based narrowing is
applied.

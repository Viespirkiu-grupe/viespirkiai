# LT-OTH-04 — Laikotarpis nuo sprendimo dėl pirkimo laimėtojo iki sutarties sudarymo nepagrįstai ilgas (award-to-signature period unusually long)

Source: OCP-R060 ("Long time between award date and contract signature") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[ocp.md](../../../../docs/indicators-story/indicators/ocp.md).

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`, following LT-OTH-03/LT-OTH-05's
grain (the catalogue places LT-OTH-04 under the `procurement` subject, not `lot`). The formula triggers if **any**
lot's award-to-signature period exceeds the bound — the same "any lot is itself the finding" aggregation LT-OTH-03
uses, not LT-OTH-05's "every lot must fail".

## Where to look

| File            | Question it answers                                                                                       |
|-----------------|--------------------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `concludedOutcomes`, `maximumDays`                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject, and the pairing rule    |
| `test/`         | How we know it works                                                                                          |

`Subject.procurement.procedureOutcome.lots` (per-lot `daliesNumeris`/`proceduruPabaiga`/`sprendimoPriemimoData`)
comes from `modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL`, the same query LT-OTH-03 reads.
`Subject.procurement.contractSignatureDates` is new for this indicator: `procurementReader.ts`'s
`CONTRACT_SIGNATURES_SQL` reads `public.v_pirkimo_sutartys_v2` — a new, narrow view
(`modules/mcp/analyst/views/v_pirkimo_sutartys_v2.sql`) added for this indicator, reading `vpmSutartys` directly
rather than forking the whole, much wider `public.v_sutartys` shape (which no risk-service indicator needs yet).

## Why "nearest contract signed on or after the decision", not a simple min/max pairing

`v_sutartys` carries no `daliesNumeris` — a contract cannot be matched to a *specific* lot the way LT-OTH-03 matches
a lot's own decision date to its own outcome label. The only link a contract carries back to a procurement is its own
free-text `pirkimoNumeris`.

An early design measured, per procurement, `max(sprendimoPriemimoData)` across concluded lots against
`min(sudarymoData)` across the procurement's own contracts (mirroring LT-OTH-03's aggregate style). Against the real
warehouse this produced a 9.4% negative-period rate (a contract "signed" before the decision that supposedly
resulted in it) — logically impossible for the real concept, since a contract cannot be signed before the buyer
decided to award it. Tracing one example (`pirkimoNumeris` `495480`) showed why: the matched contract was signed in
2020, four years before a 2025 decision recorded under the *same* `pirkimoNumeris` on an entirely different, later
procurement — domain-model.md §6.2's "dirty/reused `pirkimoNumeris`" problem, not a genuine same-day-or-earlier
signature. Restricting to contracts signed on/after the procurement's own `paskelbimoData` removed only a small
fraction of these (42 of 428); the rest of the mismatch survived even that filter.

`decision.ts`'s `awardToSignaturePeriods()` instead pairs **each lot's own decision date** against the **earliest**
of the procurement's contract signature dates that is **on or after** that date. This is a plausibility filter, not
just a tie-break: since "signed before awarded" cannot be a genuine instance of the catalogue concept, requiring the
pairing to respect chronological order is what keeps a mismatched/reused `pirkimoNumeris` from ever producing a
period at all, rather than producing a spurious negative one. Measured 2026-08 against the real warehouse, this
pairing rule finds 7,688 usable (lot, contract) pairs — more than the flawed aggregate approach's 4,565 matched
procurements — with **zero** negative periods, and a random sample of pairs in the 300–410 day range read like
genuine long delays (open procedures, no other visible anomaly), not query artifacts.

A lot with no contract signed on/after its own decision date is excluded from the period calculation entirely (not
counted as `triggered` on a fabricated negative period, and not itself a reason for `insufficient_data` if another
lot in the same procurement does pair successfully) — the same "exclude, don't force a bogus interpretation"
convention LT-OTH-03 uses for lots whose dates fail to parse.

## Why the formula only measures `concludedOutcomes` lots

Same reasoning as LT-OTH-03/LT-OTH-05: a procedure's `sprendimoPriemimoData` reliably means "the day the buyer
decided to award" only when the procedure actually concluded in a contract/framework/DPS/design-contest winner.

## Threshold

The OCP booklet states no operational day count for "long" — `maximumDays` is empirical, not sourced from a legal
deadline. Measured 2026-08 against the real warehouse (period = nearest contract `sudarymoData` on/after
`sprendimoPriemimoData`, minus `sprendimoPriemimoData`, restricted to `concludedOutcomes` lots with a valid pairing,
n=7,688):

| Percentile | 50 | 75 | 90 | 95 | 98 | 99  |
|-----------:|---:|---:|---:|---:|---:|----:|
| Days       | 11 | 18 | 28 | 36 | 55 | 85  |

`maximumDays: 36` (the measured 95th percentile) flags 382/7,688 (5.0%) as anomalously long — in line with LT-OTH-03's
~5–6% single-tail trigger rate. A random sample of the flagged tail (60–410 days) was read by hand: no duplicate
rows, no join fan-out, and the longest cases (370–410 days) were plausible genuine delays (open procedures awarded
mid-2025, contracts signed a year later), not an artifact of the query. Re-run the throwaway Phase 6 script (see the
implementation plan template) if this measurement needs refreshing.

## Coverage (the honest limitation)

`pirkimoNumeris` resolves only a documented minority of contracts back to a real procurement — domain-model.md §5.2
measures 28,367 of 466,358 (6.1%) of the contract types (`TSP`/`PPS`) that are legally obliged to carry one. This
indicator will therefore report `insufficient_data` for most procurements, not because nothing anomalous happened,
but because no resolvable contract exists in the data to measure against — `limitationLt` states this plainly rather
than implying a clean population.

## Scope

The parameter timeline applies to every `pirkimoBudas` the ATN-1/PPA report covers — same as LT-OTH-03/LT-OTH-05, no
method-based narrowing is applied.

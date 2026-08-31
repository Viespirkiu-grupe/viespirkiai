# LT-PRI-09 — Smarkiai nuvertinta laimėjusio pasiūlymo kaina (heavily discounted bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R058, "Heavily discounted bid": *"the percentage difference
between the winning bid and the second-lowest valid bid is a high outlier"*) in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **bid** — one row per `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, the same `bid`
`SubjectType` `LT-COM-20` introduced. Unlike `LT-COM-20`/`LT-COM-21` (which judge one bid in isolation), this
indicator judges the lot's **winning** bid against every other bid in the same lot — it reads `Subject.lot.bids` the
same way `LT-COM-10`…`LT-COM-13` already do at lot grain.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the `minimumValidBids`/`minRelativeDiscount` parameters |
| `decision.ts`   | The `isEligible` override that isolates the winning bid, and `assessRisk()`'s comparison |
| `test/`         | How we know it works                                                        |

`Bid` (`tiekejoKodas`/`eileNumeris`/`pasiulymoKaina`/`atmetimoPriezastis`) comes from
`modules/risk/procurementReader.ts`'s bid-grain query, merged onto `Lot.bids`. No reader/view change was needed — all
four fields are already on `Bid` (`types.ts`), first exposed for `LT-COM-10`…`LT-COM-13`/`LT-COM-20`.

## Formula

OCP-R058's own methodology: `(secondLowestValidBidAmount − winningBidAmount) / winningBidAmount`, flagged against a
population-derived statistical outlier fence (Q3 + 1.5·IQR) and "the winner is also flagged." This deployment:

1. Identifies the lot's winner the way `domain-model.md` §3 documents it is inferred everywhere else in this
   codebase: the bid ranked `eileNumeris = 1` that was not rejected (`atmetimoPriezastis IS NULL`).
2. Takes the lowest price among the lot's other **valid** (not rejected) priced bids — the "second-lowest valid bid."
   A rejected bid's price never counts as the comparator, even if it is cheaper than the runner-up that actually
   survived — the point of comparison is what the buyer could genuinely have paid instead, not the cheapest number
   anyone typed in.
3. Triggers when `(secondLowestValidPrice − winningPrice) / winningPrice ≥ minRelativeDiscount`, with at least
   `minimumValidBids` valid priced bids in the lot (winner included) for the comparison to mean anything.

This is deliberately the same underlying statistic `LT-COM-13` ("wide disparity in bid prices") computes, narrowed
two ways: only the *winning* bid is a candidate (a losing bid being cheap carries no execution risk — nobody will
ever perform the contract at that price), and the comparator is the second-lowest **valid** bid, not merely the
second-lowest *priced* one (`LT-COM-13` counts a disqualified bid's price; this indicator does not, since OCP-R058
compares the winner against a bid that was actually a genuine competing option).

## Eligibility and required data

Overrides `ABidIndicatorDecision.isEligible` (`decision.ts`), following `LT-PRO-08`'s precedent for a business-rule
gate beyond the shared eligibility decision: after the standard Lot Eligibility Decision, a bid that is not the
lot's inferred winner is `not_applicable` — the catalogue concept has nothing to say about a bid that was never
awarded anything. `hasRequiredData()` then only asks whether the winner's own price is usable
(`pasiulymoKaina IS NOT NULL AND pasiulymoKaina > 0`); too few *other* valid bids to compute a second-lowest price is
`not_triggered`, not `insufficient_data` — the same convention `LT-COM-13`'s `minimumPricedBids` gate uses, since the
report is complete, there just isn't enough competition to judge a discount by.

## Parameters

- `minimumValidBids: 2` — the winner plus at least one valid competitor.
- `minRelativeDiscount: 1.0` — same value as `LT-COM-13`'s `minRelativeGap`, since it is the identical statistic
  (runner-up costs at least double the cheaper price). OCP's own guide computes a population-derived outlier fence
  (Q3 + 1.5·IQR) instead of a fixed ratio; that is not yet something the parameter model supports, so a fixed
  threshold is used, matching the sibling indicator's own choice for the same reason.

## Data coverage and hand-check (measured 2026-08-31 against the real warehouse)

The `_v2` views this indicator's own reader query depends on (`public.v_dalyviai_v2`) are not populated in any
environment reachable while implementing this — same gap `LT-COM-21`'s README records. Measured directly against
`public.v_dalyviai` instead (deduplicated by `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, `pasiulymoKaina > 0`
and excluding the source's own `NaN` numeric literal — Postgres, unlike JavaScript, sorts `NaN` as *greater than*
every other value, so a naive `pasiulymoKaina > 0` filter in SQL silently admits it; `decision.ts`'s own
`isUsablePrice` never has this problem, since `NaN > 0` is `false` in JavaScript):

- 10,220 lots nationwide have a determinable winner (`eileNumeris = 1`, not rejected, usable price).
- Of those, 4,284 (41.9%) have at least one other valid priced bid to compare against — the rest correctly resolve
  to `not_triggered` (too few valid bids), not a false negative.
- At `minRelativeDiscount = 1.0`, 213 lots trigger (5.0% of the comparable population) — a non-trivial but
  far-from-universal rate, consistent with a specific failure mode rather than the default outcome.
- **Hand-checking the 213 triggered examples surfaced a real limitation.** 133 of them (62%) land at a relative
  discount of *exactly* (or within rounding of) 1.00 — the runner-up's price is precisely double the winner's
  (e.g. 1890 vs 3780, 24684 vs 49368, 14 vs 28). An exact doubling this often is far likelier to be the same
  unit-vs-total or per-item-vs-lot-total data-entry confusion `LT-COM-11`/`LT-COM-13` already caveat than 133
  independent instances of genuine 2x-plus underpricing. The most extreme outliers are unambiguous data artifacts
  (e.g. a lot where the winner's recorded price is `2` against a runner-up of `2,371,358.24`). The remaining ~80
  examples show varied, non-round relative discounts more consistent with a genuine pricing gap.

This is the same class of risk `LT-COM-13`'s own limitation text already names ("kai pigiausio pasiūlymo kaina labai
maža, didelis santykinis skirtumas gali atspindėti ne realų konkurencijos iškraipymą, o duomenų įvedimo klaidą") —
`limitationLt` below states it for this indicator too, and it is the reason a reviewer should treat a triggered
signal as a prompt to check the underlying prices, not as a discount confirmed correct.

## Follow-up

- **The winning-bid inference is approximate**, same caveat `domain-model.md` §3 states generally: `eileNumeris = 1`
  and not rejected is not a recorded "this bid was awarded" fact, just the best available proxy. A procedure that
  scores on criteria beyond price (economically most advantageous tender) could rank #1 on price without winning
  the award, or vice versa — not distinguishable from the currently ingested data.
- **No statistical outlier fence.** OCP-R058's own methodology recomputes a population-wide Q3 + 1.5·IQR fence per
  run rather than using one fixed ratio; the parameter model here only supports an effective-dated literal, so
  `minRelativeDiscount` is fixed at the same value `LT-COM-13` already uses for the identical statistic. A future
  parameter-model extension for a recomputed statistical threshold would let this track the population more
  precisely than a hand-picked constant.

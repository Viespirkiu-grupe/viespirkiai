# LT-COM-13 — Didelis atotrūkis tarp mažiausios ir kitos pasiūlymo kainos (wide disparity in bid prices)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R022, "Wide disparity in bid prices"), cross-referenced
against OECD-BR-26 ("Large winner-to-other-bid gap or clustering of losing bids") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Like `LT-COM-10`/`LT-COM-11`/
`LT-COM-12`, this reads the per-bid array (`Lot.bids`, one `Bid` per bidder — `pasiulymoKaina`) rather than the
aggregate `LotParticipation` counts `LT-AWD-01`/`LT-COM-01`/`LT-COM-02` use.

## Where to look

| File            | Question it answers                                                                              |
|------------------|----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — what it compares against, and since when   |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject                       |
| `test/`         | How we know it works                                                                                |

`Lot.bids` comes from `modules/risk/procurementReader.ts`'s `LOT_BIDS_SQL`, itself reading `public.v_dalyviai_v2`.
`test/fixtures.ts` states the expected `Bid` shapes; `decision.test.ts` decides those fixtures with no database.

## Formula

Among the lot's bids carrying a usable price (`pasiulymoKaina > 0`; there must be at least `minimumPricedBids` (2) of
them): take the two cheapest distinct suppliers' prices and compute the relative gap
`(secondLowest − lowest) / lowest`. The lot triggers if that gap is at least `minRelativeGap` (1.0, i.e. the
second-cheapest offer costs at least twice the cheapest one).

This deliberately compares only the **two cheapest** priced bids, not the full min/max range across every bid in the
lot (OECD-BR-26's "winner-to-other-bid gap" framing, using the cheapest priced bid as the notional winner — the same
proxy `LT-AWD-02` already uses for "lowest bid"). A first design pass measured the raw `(max − min) / min` range
across all priced bids instead, and found it dominated by a heavy tail of extreme outlier prices (median relative
range 36%, 95th percentile over 9000%) — almost certainly individual data-entry or unit-mismatch artefacts in a
single high bid rather than a genuine "disparity" pattern, and unusable as a threshold basis without either a rate
so high it stops meaning anything or a cutoff so extreme it only catches the outliers themselves. Anchoring on the
two cheapest bids avoids that: it asks whether the *cheapest* offer already stands out sharply from the next
realistic alternative, which is both the more literal reading of "winner-to-other-bid gap" and far less sensitive to
one runaway high bid elsewhere in the lot (see `outlierAboveSecondLowestIgnored` in `test/fixtures.ts`).

`LOT_BIDS_SQL` is already `DISTINCT ON` `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, so `Lot.bids` never carries
two rows for the same supplier — the two lowest prices compared here are necessarily two different suppliers'
offers. A disqualified bid's price still counts — the concept is about what suppliers *submitted*, not what
survived evaluation (unlike `LT-AWD-02`).

A handful of price values in the source are `NaN` or negative parsing artefacts (see `LT-COM-10`'s README for the
same finding); `isUsablePrice()` filters these the same way.

## Threshold

`minimumPricedBids: 2` matches `LT-COM-10`/`LT-COM-11`/`LT-COM-12`'s own minimum for "comparative" to mean anything
at all. `minRelativeGap: 1.0` (the next-cheapest offer costs at least double the cheapest) is a parameter (not a
literal in `decision.ts`) so a revised cutoff can be added as a new effective-dated entry — no catalogue reference or
source document hands this indicator a specific number, so "at least double" was picked as a widely-used audit
heuristic for a bid standing out as anomalously cheap relative to the rest, matching this indicator's own
`limitationLt` caveat that a wide gap by itself does not distinguish a genuinely uncompetitive quote from arranged
cover bidding.

## Coverage (2026-08-27 measurement against the live warehouse)

Across every lot in the warehouse with at least 2 distinct suppliers carrying a usable priced bid (5,920 lots), the
relative gap between the two cheapest bids was ≥100% (this indicator's threshold) for 625 lots (10.6%) — higher than
`LT-COM-10`/`LT-COM-11`/`LT-COM-12`'s 2.6%–4.9%, which is expected: "wide disparity" is a broader, more common
pattern than an exact or near-exact price match. Running the actual `ProcurementReader` + `RiskDecisionEngine`
pipeline (not just the raw SQL above) against a random sample of 200 procurements known to have a comparable lot
found the same order of magnitude: 34 triggered out of 627 signals (627 = 503 not_triggered + 90 insufficient_data +
34 triggered), 5.4% of all signals / 6.3% of the 537 comparable ones.

Manually reviewing a sample of triggered lots found two groups: plausible genuine two/three-bidder gaps at moderate
multiples (e.g. €332.75 vs €1,391.50, €914.76 vs €6,993.80, €22,143 vs €207,454.50), and a minority (roughly 29% of
triggered lots carry a gap ≥20x; 15% have a cheapest price under €100) where the cheapest price is implausibly small
relative to everything else (e.g. €72 vs €90,511.63, €25.92 vs €4,559.28) — very likely a source data-entry or
unit-price/total-price mismatch rather than a genuine bid, though the two cannot be told apart from `pasiulymoKaina`
alone. `limitationLt` calls this out explicitly rather than adding an undocumented minimum-price floor to the
formula, since a legitimately tiny procurement total is not distinguishable from a data error at this indicator's
grain, and either case is worth a reviewer's attention for a different reason. Re-check these numbers if this README
is revisited and they look stale.

# LT-COM-11 — Kartotinės pasiūlymų kainos (fixed-multiple bid prices)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R023, "Fixed-multiple bid prices"), cross-referenced against
OECD-BR-25 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Like `LT-COM-10`, this reads the
per-bid array (`Lot.bids`, one `Bid` per bidder — `pasiulymoKaina`) rather than the aggregate `LotParticipation`
counts `LT-AWD-01`/`LT-COM-01`/`LT-COM-02` use.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — what it compares against, and since when   |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject                       |
| `test/`         | How we know it works                                                                                |

`Lot.bids` comes from `modules/risk/procurementReader.ts`'s `LOT_BIDS_SQL`, itself reading `public.v_dalyviai_v2`.
`test/fixtures.ts` states the expected `Bid` shapes; `decision.test.ts` decides those fixtures with no database.

## Formula

Among the lot's bids carrying a usable price (`pasiulymoKaina > 0`; there must be at least `minimumPricedBids` (2) of
them): for every pair of two different suppliers' prices, compute the ratio of the larger to the smaller. If that
ratio is within `relativeTolerance` (0.5%) of a whole number between 2 and `maxMultiple` (5) inclusive, the pair is a
"fixed multiple" — one price is (almost exactly) double, triple, quadruple, or quintuple the other. The lot triggers
if any pair matches; when several pairs match, `rawValue` reports the tightest one (smallest relative error).

A ratio near 1 never matches — the minimum multiple is 2, so identical or near-identical prices are left to
`LT-COM-10`, which already covers that concept. Multiples above 5 are deliberately out of scope: a plausible
"quick shortcut" cover-bid multiplier (double, triple, ...) is a small, round factor; chasing higher multiples adds
noise without adding a materially different concept (see Coverage below).

`LOT_BIDS_SQL` is already `DISTINCT ON` `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, so `Lot.bids` never carries
two rows for the same supplier — every pair compared here is necessarily two different suppliers' prices, never one
bidder's price checked against itself. A disqualified bid's price still counts — the concept is about what suppliers
*submitted*, not what survived evaluation (unlike `LT-AWD-02`).

A handful of price values in the source are `NaN` or negative parsing artefacts (see `LT-COM-10`'s README for the
same finding); `isUsablePrice()` filters these the same way.

## Coverage (2026-08-27 measurement against the live warehouse)

Of 5,411 lots with at least `minimumPricedBids` (2) usable-priced bids, 139 (2.6%) have a pair whose ratio lands
within 0.5% of an integer multiple between 2 and 5 — a non-trivial but not overwhelming rate, similar in order of
magnitude to `LT-COM-10`'s 4.2% for identical prices. Manually sampling triggering lots found genuine exact and
near-exact multiples at both small values (e.g. €1 vs €2, €14 vs €28) and larger, more specific ones (e.g. €63,525 vs
€126,808, a 1.996x ratio — within tolerance of exactly double). Re-check these numbers if this README is revisited
and they look stale.

## Threshold

`minimumPricedBids: 2` matches `LT-COM-10`'s own minimum for "comparative" to mean anything at all. `maxMultiple: 5`
and `relativeTolerance: 0.005` are parameters (not literals in `decision.ts`) so a revised range or tolerance can be
added as a new effective-dated entry.

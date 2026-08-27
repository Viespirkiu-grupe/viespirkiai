# LT-COM-12 — Įtartinai artimos pasiūlymų kainos (suspiciously close bid prices)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R024, "Bid price close to winning bid"), cross-referenced
against OECD-BR-26 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Like `LT-COM-10`/`LT-COM-11`, this
reads the per-bid array (`Lot.bids`, one `Bid` per bidder — `pasiulymoKaina`) rather than the aggregate
`LotParticipation` counts `LT-AWD-01`/`LT-COM-01`/`LT-COM-02` use.

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
them): for every pair of two different suppliers' prices, compute the relative difference `(higher − lower) / lower`.
If that difference is greater than 0 and at most `maxRelativeDifference` (1%), the pair is "suspiciously close" — near
enough that reaching that small a gap through independent costing is implausible, without being an exact match. The
lot triggers if any pair matches; when several pairs match, `rawValue` reports the tightest one (smallest relative
difference).

A relative difference of exactly 0 (identical prices) never matches here — that is `LT-COM-10`'s own, stronger
concept, and this indicator deliberately leaves it there rather than double-counting the same pair under two
indicators. This mirrors how `LT-COM-11` excludes a ratio near 1 from its own, different concept (fixed multiples).
Together, `LT-COM-10` (identical), `LT-COM-12` (close but not identical), and `LT-COM-11` (fixed multiple) partition
non-overlapping bands of the same underlying pairwise-price-relationship idea.

`LOT_BIDS_SQL` is already `DISTINCT ON` `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, so `Lot.bids` never carries
two rows for the same supplier — every pair compared here is necessarily two different suppliers' prices, never one
bidder's price checked against itself. A disqualified bid's price still counts — the concept is about what suppliers
*submitted*, not what survived evaluation (unlike `LT-AWD-02`).

A handful of price values in the source are `NaN` or negative parsing artefacts (see `LT-COM-10`'s README for the
same finding); `isUsablePrice()` filters these the same way.

## Threshold

`minimumPricedBids: 2` matches `LT-COM-10`/`LT-COM-11`'s own minimum for "comparative" to mean anything at all.
`maxRelativeDifference: 0.01` (1%) is a parameter (not a literal in `decision.ts`) so a revised tolerance can be added
as a new effective-dated entry — no catalogue reference or source document hands this indicator a specific cutoff, so
1% was picked as a small-but-not-vanishing band, tight enough that two independently costed bids landing inside it by
chance is implausible for anything but a small, round price (the same caveat `LT-COM-10`'s `limitationLt` already
states for exact matches, and this indicator's own `limitationLt` repeats for near-matches).

## Coverage (2026-08-27 measurement against the live warehouse)

Sampling 200 lot-bearing procurements (1,012 lots evaluated), 713 lots had at least `minimumPricedBids` (2) usable
priced bids to compare — the rest report `insufficient_data`. Of those 713 comparable lots, 35 (4.9%) had a pair of
different suppliers' prices within 1% of each other but not identical — a non-trivial but not overwhelming rate,
similar in order of magnitude to `LT-COM-10`'s 4.2% for identical prices and `LT-COM-11`'s 2.6% for fixed multiples.

Manually reviewing the triggered examples found genuine close matches on large, oddly-specific values implausible to
reach by chance through independent costing — e.g. €80,669.55 vs €80,737.06 (0.08% apart), €426,266.07 vs €426,509.87
(0.06% apart), €435,800 vs €437,600 (0.41% apart) — the kind of near-match `limitationLt` calls out as carrying real
evidentiary weight, unlike a coincidence at a small round price. Re-check these numbers if this README is revisited
and they look stale.

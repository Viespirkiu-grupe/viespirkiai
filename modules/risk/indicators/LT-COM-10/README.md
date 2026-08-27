# LT-COM-10 — Vienodos pasiūlymų kainos (identical bid prices)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R028, "Identical bid prices"), cross-referenced against
OECD-BR-24 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Like `LT-AWD-02`, this reads the
per-bid array (`Lot.bids`, one `Bid` per bidder — `pasiulymoKaina`) rather than the aggregate `LotParticipation`
counts `LT-AWD-01`/`LT-COM-01`/`LT-COM-02` use.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — what it compares against, and since when |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject |
| `test/`         | How we know it works                                                        |

`Lot.bids` comes from `modules/risk/procurementReader.ts`'s `LOT_BIDS_SQL`, itself reading `public.v_dalyviai_v2`.
`test/fixtures.ts` states the expected `Bid` shapes; `decision.test.ts` decides those fixtures with no database.

## Formula

Among the lot's bids carrying a usable price (`pasiulymoKaina > 0`; there must be at least `minimumPricedBids` (2)
of them): group by price and find the largest group of bids sharing the exact same value. If that group has 2 or
more members, the lot triggers.

`LOT_BIDS_SQL` is already `DISTINCT ON` `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, so `Lot.bids` never carries
two rows for the same supplier — a price shared by two or more entries in the array is necessarily shared by two or
more *different* suppliers, never an artefact of one supplier's bid being counted twice. This matters here more than
for most lot-grain indicators: a Phase 1 check against the raw `v_dalyviai_v2` view (before the Reader's
`DISTINCT ON`) found that the view's own `FULL OUTER JOIN` between the price-ranking and rejected-bids source tables
fans out for a supplier appearing in both (or rejected more than once at the same lot), which would otherwise read
as "two identical prices" for what is actually one bidder's one price recorded twice.

A disqualified bid's price still counts — the concept is about what suppliers *submitted*, not what survived
evaluation (unlike `LT-AWD-02`, which specifically needs the disqualification outcome).

A handful of price values in the source are `NaN` or negative parsing artefacts (see `LT-AWD-02`'s README for the
same finding). `isUsablePrice()` in `decision.ts` requires `pasiulymoKaina > 0`, filtering these out the same way —
important here specifically because Postgres orders `NaN` as greater than any other numeric value, so two different
`NaN` artefacts would otherwise look like a match if filtered in SQL instead of after the values reach JavaScript
(where `NaN > 0` is correctly `false`).

## Coverage (2026-08-27 measurement against the live warehouse)

Of 49,406 `v_pirkimo_dalis_v2` lots, 11,039 have at least one bid with a usable price and 5,920 have at least
`minimumPricedBids` (2) — the population this indicator can actually judge; the rest report `insufficient_data`.
Of those 5,920 comparable lots, 246 (4.2%) have two or more different suppliers sharing an identical price — a
non-trivial but not overwhelming rate, consistent with a real, occasionally-firing signal rather than an
always-true or never-true formula. Re-check these numbers if this README is revisited and they look stale.

Manually sampling the triggering lots found genuine matches at both large, specific values (e.g. two suppliers both
at €85,460 or €78,650 — implausible to reach independently) and small round values (e.g. two suppliers both at €10
or €18) — the latter is the scenario `limitationLt` calls out: a round, low price is far more likely to coincide by
chance across independent bidders than an arbitrary large one, so a triggered signal at a small round price carries
materially weaker evidentiary weight than one at a large or oddly-specific price. The indicator does not distinguish
the two cases itself (see `identicalPrice` in `rawValue` for a reviewer to judge by eye).

## Threshold

`minimumPricedBids: 2` is the same minimum `LT-AWD-02` uses for "comparative" to mean anything at all — a parameter
rather than a literal so a revised threshold can be added as a new effective-dated entry.

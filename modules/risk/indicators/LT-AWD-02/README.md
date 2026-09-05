# LT-AWD-02 — Žemiausios kainos pasiūlymas atmestas (lowest bid disqualified)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R036, "Lowest bid disqualified") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Unlike `LT-AWD-01`/`LT-COM-01`/
`LT-COM-02`, which judge a lot from the aggregate `LotParticipation` counts, this is the first lot-grain indicator
that reads the per-bid array (`Lot.bids`, one `Bid` per bidder — `pasiulymoKaina`, `atmetimoPriezastis`) to compare
prices across bidders within the lot.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline                                              |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject                      |
| `test/`         | How we know it works                                                                               |

`Lot.bids` comes from `modules/risk/procurementReader.ts`'s `LOT_BIDS_SQL`, itself reading `public.v_dalyviai_v2`.
`test/fixtures.ts` states the expected `Bid` shapes; `decision.test.ts` decides those fixtures with no database.

## Formula

Among the lot's bids carrying a usable price (`pasiulymoKaina > 0`; there must be at least `minimumPricedBids` (2)
of them): find the minimum price. If every bid at that minimum price was disqualified (`atmetimoPriezastis IS NOT
NULL`), and at least one higher-priced bid remains valid (not disqualified), the lot triggers — the cheapest offer
was rejected and a more expensive one stands in its place.

Ties at the minimum price require *all* of them to be disqualified — if any bid at the lowest price survived, the
lowest price itself was not shut out of the award, so the concept does not apply.

## Data-gap finding: rejected-bid prices live on a different source table

Phase 1's coverage check found that `v_dalyviai`/`v_dalyviai_v2`'s `pasiulymoKaina` column, as originally defined,
took its price **only** from `xlsxPPApasiulymuEile` — the price-ranking table populated for bids that made it into
evaluation. A bid that was disqualified before ranking never appears there, so in the live warehouse only **96 of
8,490** disqualified bids (1.1%) carried a price through that join — nowhere near enough to compute "was the
cheapest bid the one that got disqualified" for most disqualifications.

`\d "xlsxPPAatmestiPasiulymai"` (the rejected-bids source table itself) turned up its own `pasiulymoKaina` text
column — the price the bidder offered, recorded at rejection time, independent of whether they were ever ranked.
The source XLSX's own sheet-map comment (top of `v_dalyviai.sql`/`v_dalyviai_v2.sql`) already names this: "p.6 =
atmesti pasiūlymai **su kainomis**" (rejected bids *with prices*). That column was populated for **5,061 of 12,564**
rejected-bid rows (40.3%) — a materially better source.

Both `modules/mcp/analyst/views/v_dalyviai.sql` and `v_dalyviai_v2.sql` were changed (same LATERAL join, same
change in both, per convention) so `"pasiulymoKaina"` is `COALESCE(e.kaina::numeric, NULLIF(ap."pasiulymoKaina",
'')::numeric)` — the ranking-table price first, the rejected-bids table's own price as fallback. This is a strict
widening (more non-null prices, same value wherever both are already populated) and changes no other consumer's
row identity or count, only how often `pasiulymoKaina` is non-null. Measured against the live warehouse (2026-08-27
snapshot) this raised disqualified-bid price coverage from 96 to 4,432 rows, and the number of lots matching this
indicator's full trigger pattern from 17 to 730 (out of 48,564 lots) — re-check these numbers if this README is
revisited and they look stale.

A handful of rejected-bid price values in the source (25 nationwide) are `NaN` or negative — parsing artefacts, not
genuine offers. `isUsablePrice()` in `decision.ts` requires `pasiulymoKaina > 0`, filtering both out without needing
to touch the view.

Because `migrations/risk/test/001_public_test_tables.sql`'s replica of `xlsxPPAatmestiPasiulymai` didn't carry this
column, it was added there too, and `insertAtmestasPasiulymas()` in
`modules/risk/indicators/test/xlsxPPAFixtures.ts` gained an optional `kaina` parameter so integration tests can set
it.

## Threshold

`minimumPricedBids: 2` is the catalogue definition's minimum for "lowest" to be a comparative concept at all — a
parameter rather than a literal so a revised threshold can be added as a new effective-dated entry.

# LT-AWD-04 — Neproporcingai didelė atmestų pasiūlymų dalis (excessive share of disqualified bids)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R038, "Excessive disqualified bids") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Reuses the exact same
`LotParticipation` aggregate shape as `LT-COM-01`/`LT-COM-02`/`LT-AWD-01` — no new data or reader change was needed.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the `minimumTotalBids`/`disqualifiedShareThreshold` parameters       |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject                      |
| `test/`         | How we know it works                                                                               |

Participation counts (`totalBids`/`validBids`/`reportedAt`) come from `modules/risk/procurementReader.ts`'s
consolidated lot-grain participation query, shared by every lot-grain indicator, and arrive already merged onto
`Subject.lot.participation` before `decision.ts` runs.

## Formula

Among lots with at least `minimumTotalBids` distinct recorded bidders (`totalBids`), the lot triggers when the
disqualified share `(totalBids − validBids) / totalBids` is at or above `disqualifiedShareThreshold` — a majority of
the lot's bidders were disqualified.

## Threshold — no catalogue-given number, chosen from measured data

Unlike `LT-AWD-01`/`LT-AWD-02` (whose thresholds are the catalogue's own "all but one"/"the lowest one" concepts),
`OCP-R038`'s source booklet names "Excessive disqualified bids" only as a title, with no worked formula or numeric
threshold. Two parameters were chosen instead of one literal threshold, each independently justified:

- `minimumTotalBids: 3` — below three bidders, a single disqualification already swings the share by a large step
  (one of two is 50%), so "share" stops being a meaningful ratio. This mirrors `LT-COM-02`'s reasoning for its own
  bidder-count floor.
- `disqualifiedShareThreshold: 0.5` — the plain reading of "excessive": more bidders disqualified than survived.

Measured against the live warehouse (2026-08-27 snapshot, via `v_dalyviai_v2`'s participation aggregate): of 13,116
lots with at least one recorded bidder, 4,319 have `totalBids >= 3`. Of those, 1,098 (25.4%) meet the
`disqualifiedShareThreshold: 0.5` gate — a non-trivial but far-from-universal rate, consistent with a genuine signal
rather than a vacuous or trivially-always-true one. A tighter `0.75` gate on the same population catches 421 lots
(9.7%); `0.5` was kept as the more defensible "majority" reading of "excessive" without an external anchor for a
stricter number. Re-run the throwaway Phase 6 script (see the plan template) if this measurement needs refreshing.

## Eligibility and required data

Reuses the shared Lot Eligibility Decision (parent lot → parent procurement: `cvpis` + `pirkimoBudas` present) — no
lot-specific eligibility rule exists yet. `hasRequiredData()` requires `Lot.participation !== null` (an ATN-1 report
was observed for this lot at all), the same test `LT-COM-01`/`LT-COM-02`/`LT-AWD-01` use. A lot with participation
but zero per-bid rows (every participant's `tiekejoKodas` was null) is `insufficient_data` with
`missingData: ["tiekejoKodas"]`, the same split those three indicators make.

## Known limitation and overlap

A high disqualification share can be explained by legitimate causes — strict but justified qualification
requirements, or bidders making preparation errors — not necessarily a manipulated procedure; the indicator does not
judge whether any individual disqualification was itself well-founded (`LT-AWD-03` covers that half). It can also
co-trigger with `LT-AWD-01` when, after disqualifying a majority, exactly one bidder survives — the two indicators
are not mutually exclusive, and both are expected to fire together in that case.

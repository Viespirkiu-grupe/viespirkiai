# LT-AWD-01 — Visi pasiūlymai, išskyrus laimėtojo, atmesti (all bids except winner disqualified)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R035, "All bids except the winning bid disqualified"),
cross-referenced against OT-I11 ("Exclusion of all but one bid") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in `public.v_dalyviai`. A bid is
valid when its `atmetimoPriezastis` is null. Reuses the exact same `LotParticipation` shape as `LT-COM-01`; the two
indicators differ only in threshold logic, not in data source.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — what it compares against, and since when |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject |
| `test/`         | How we know it works                                                        |

Participation counts (`totalBids`/`validBids`/`reportedAt`) come from `modules/risk/procurementReader.ts`'s
consolidated lot-grain participation query, shared by every lot-grain indicator, and arrive already merged onto
`Subject.lot.participation` before `decision.ts` runs.

`test/fixtures.ts` states the expected `Subject.lot.participation` shape for each scenario; `decision.test.ts`
decides those fixtures with no database. The participation query itself is tested in
`test/risk/procurementReader.it.ts`. Identity fields, parameter resolution, and the `not_applicable` case belong to
`ARiskIndicatorDecision`/`ALotIndicatorDecision` and are tested in `test/risk/procurementLotDecision.test.ts`.

## Difference from LT-COM-01

`LT-COM-01` ("Single valid bid") triggers whenever `validBids <= 1`, regardless of how many bids were originally
submitted — including the case where exactly one bid was ever received (no disqualification involved at all).
`LT-AWD-01` narrows that to the disqualification-specific reading of OCP-R035: it additionally requires
`totalBids >= minimumTotalBids` (at least two bids competed) and `validBids === survivingValidBids` (exactly one
survivor, not zero — if every bid including any potential winner was rejected, that is total failure, not "all but
the winner"). A lot can trigger both indicators, or only LT-COM-01, but never only LT-AWD-01.

## Threshold

`minimumTotalBids: 2` and `survivingValidBids: 1` are the catalogue definition. Both are parameters rather than
literals so a revised threshold can be added as a new effective-dated entry rather than a new implementation
version.

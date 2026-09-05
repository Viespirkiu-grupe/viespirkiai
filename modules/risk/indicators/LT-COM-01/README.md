# LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R018), cross-referenced against OLAF-CA02, OT-I01, STT-I03,
VPT-I01 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in `public.v_dalyviai`. A bid is
valid when its `atmetimoPriezastis` is null.

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

## Scope

The parameter timeline applies to every `pirkimoBudas`. Narrowing to competitive procedures only — see
[`modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`](../../../viesiejiPirkimai/viesiejiPirkimaiEnums.js)'s
`PIRKIMO_BUDAS` map — is a possible future refinement, not yet applied.

## Threshold

`maximumValidBids: 1` is the catalogue definition. It is a parameter rather than a literal so a revised threshold
can be added as a new effective-dated entry rather than a new implementation version.

## Zero valid bids is a different concept

The trigger is `1 ≤ validBids ≤ maximumValidBids`, not just `validBids ≤ maximumValidBids`. A lot where *every* bid
was rejected has no winner at all — that is a failed procedure, which `LT-OTH-05` ("procedure unsuccessful or award
not contracted") and `LT-AWD-04` ("excessive share of disqualified bids") are the concepts for. OCP-R018 is about a
single supplier facing no competition *for a contract it went on to win*, so a zero-valid-bid lot is
`not_applicable` here.

Measured against run 676, the naive `≤` reading made these **1,320 of the indicator's 7,770 triggered lots (17.0%)**
— 815 of them lots with a single bidder who was rejected — and contradicted the indicator's own published
description ("Pirkimo dalyje po pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas) pasiūlymas"). With the
gate in place that description is exactly what the indicator does: re-running the full batch (run 719) leaves
**6,450 triggers, every one of them a lot with exactly one valid bid**, and moves all 1,320 zero-valid-bid lots to
`not_applicable`. The trigger rate falls from 59.95% to 55.41% of evaluable lots.

Note this is *not* the same case as `emptyReport` (`totalBids === 0`): there the report lists participants whose
`tiekejoKodas` is all null, so nothing is known about the lot's competition at all — `insufficient_data`. Here the
lot's bids are known, and known to have all been rejected.

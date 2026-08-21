# LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R018), cross-referenced against OLAF-CA02, OT-I01, STT-I03,
VPT-I01 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in `public.v_dalyviai`. A bid is
valid when its `atmetimoPriezastis` is null.

## Where to look

| File            | Question it answers                                                        |
|-----------------|------------------------------------------------------------------------------|
| `parameters.ts` | What it compares against, and since when                                    |
| `definition.ts` | Identity, lifecycle, public wording                                         |
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

`parameters.ts` ships with `scope: {}`, applying to every `pirkimoBudas`. Narrowing to competitive procedures only
— see [`modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`](../../../viesiejiPirkimai/viesiejiPirkimaiEnums.js)'s
`PIRKIMO_BUDAS` map — is a possible future refinement; `lifecycle: 'shadow'` until that is resolved.

## Threshold

`maximumValidBids: 1` is the catalogue definition. It is a parameter rather than a literal so a revised threshold
can be added as a new effective-dated entry rather than a new implementation version.

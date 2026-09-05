# LT-COM-02 — Mažas dalyvių skaičius (low number of bidders)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R019), cross-referenced against OLAF-CN01, OLAF-CN02, OLAF-CA02,
VPT-I12 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — the same grain as [`LT-COM-01`](../LT-COM-01/README.md). `totalBids` counts every
distinct participant recorded for the lot, **whether or not their bid was later rejected**.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — what it compares against, and since when |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject |
| `test/`         | How we know it works                                                        |

Participation counts (`totalBids`/`reportedAt`) come from `modules/risk/procurementReader.ts`'s consolidated
lot-grain participation query, shared by every lot-grain indicator (LT-COM-01's `validBids` comes from the same
query), and arrive already merged onto `Subject.lot.participation` before `decision.ts` runs.

`test/fixtures.ts` states the expected `Subject.lot.participation` shape for each scenario; `decision.test.ts`
decides those fixtures with no database. The participation query itself is tested in
`test/risk/procurementReader.it.ts`. Identity fields, parameter resolution, and the `not_applicable` case belong to
`ARiskIndicatorDecision`/`ALotIndicatorDecision` and are tested in `test/risk/procurementLotDecision.test.ts`.

## How this differs from LT-COM-01

Both indicators read `public.v_dalyviai` at lot grain and share the `insufficient_data` reasoning, but they measure
different things:

- **LT-COM-01** ("single valid bid") counts bids still **valid after evaluation** — a report can list five
  participants and still trigger LT-COM-01 if four were rejected.
- **LT-COM-02** ("low number of bidders") counts every **recorded participant**, rejected or not — a
  competition-level signal, independent of how the evaluation turned out.

A lot can trigger one, both, or neither; that overlap is expected, since the two catalogue rows measure related but
distinct risks (OCP-R018 vs. OCP-R019).

## Scope

As with LT-COM-01, the parameter timeline applies to every `pirkimoBudas`; narrowing is the same open question noted
in [`LT-COM-01/README.md`](../LT-COM-01/README.md), not yet applied.

## Threshold

`minimumBidders: 3` follows OLAF-CN02's "fewer than three tenderers" framing, the common low-competition threshold
across the cross-referenced sources (OCP-R019, OLAF-CA02, VPT-I12). It is a parameter rather than a literal so a
revised threshold can be added as a new effective-dated entry rather than a new implementation version.

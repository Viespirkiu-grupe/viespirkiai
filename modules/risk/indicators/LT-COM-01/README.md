# LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R018), cross-referenced against OLAF-CA02, OT-I01, STT-I03,
VPT-I01 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in the ATN-1 procedure-completion
report, which is the natural grain of `public.v_dalyviai`. A bid is "valid" when the participant is absent from
`atn1atmestiPasiulymai` (rejected, withdrawn, or not invited) for that lot.

## Where to look

| File                    | Question it answers                                                              |
|-------------------------|----------------------------------------------------------------------------------|
| `parameters.ts`         | What it compares against, and since when                                         |
| `definition.ts`         | Identity, lifecycle, public wording — pure metadata, no behaviour                 |
| `decision.ts`           | What the facts mean — the state, the threshold that decided it, the evidence — plus the `ALotIndicatorDecision` wiring, with `static decide()` as its judgement method (replaces `rules.ts`) |
| `test/`                 | How we know it works                                                             |

There is no `collect.sql` here (v2 architecture — see below): participation counts (`totalBids`/`validBids`/
`reportedAt`) come from `modules/risk/procurementReader.ts`'s consolidated lot-grain participation query, shared by
every lot-grain indicator, and arrive already merged onto `Subject.lot.participation` before `decision.ts` ever runs.

Inside `test/`, `fixtures.ts` states the expected `Subject.lot.participation` shape for each scenario;
`decision.test.ts` decides those fixtures with no database. The participation query's own correctness (dedup,
cutoff filtering, `daliesNumeris` handling) is tested once, for every lot-grain indicator, in
`test/risk/procurementReader.it.ts`. Everything else — identity fields, parameter resolution, `not_applicable` when
no entry applies — belongs to `ARiskIndicatorDecision`/`ALotIndicatorDecision` and is tested once in
`test/risk/procurementLotDecision.test.ts`.

## Open question: method scope

`parameters.ts` ships with `scope: {}` (applies to every `pirkimoBudas`) as a v1 placeholder. The indicator is
conceptually about *competitive* procedures that ended up with only one surviving bid — a procedure that is by
design a single-supplier negotiation (e.g. certain `Derybos` variants aimed at one pre-chosen supplier) arguably
shouldn't trigger this at all. Narrowing the scope means appending an entry whose `scope.methods` lists the competitive
methods; lots run under any other method then match no entry and become `not_applicable`, which is the honest answer
rather than a suppressed trigger. That change waits on confirming the `pirkimoBudas` split against real data — see
[`modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`](../../../viesiejiPirkimai/viesiejiPirkimaiEnums.js)'s
`PIRKIMO_BUDAS` map as the starting point. Until then this version stays `lifecycle: 'shadow'`.

## Threshold

`maximumValidBids: 1` is the catalogue definition. It is a parameter rather than a literal because a reviewer may
later argue that two surviving bids in a market with three known suppliers is the same signal — that argument should
be a new effective-dated entry, not a new implementation version.

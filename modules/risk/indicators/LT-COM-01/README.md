# LT-COM-01 — Vienintelis tinkamas pasiūlymas (single valid bid)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R018), cross-referenced against OLAF-CA02, OT-I01, STT-I03,
VPT-I01 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in the ATN-1 procedure-completion
report, which is the natural grain of `public.v_dalyviai`. A bid is "valid" when the participant is absent from
`atn1atmestiPasiulymai` (rejected, withdrawn, or not invited) for that lot.

## Where to look

| File                    | Question it answers                                                              |
|-------------------------|----------------------------------------------------------------------------------|
| `collect.sql`           | What is true about each lot — bid counts, method, when the report was recorded   |
| `rules.ts`              | What that means — the state, the threshold that decided it, and the evidence     |
| `parameters.ts`         | What it compares against, and since when                                         |
| `definition.ts`         | Identity, lifecycle, public wording, and the wiring between the three above      |
| `test/`                 | How we know it works                                                             |

Inside `test/`, `fixtures.ts` states both the source rows and the fact row `collect.sql` must produce from them;
`rules.test.ts` decides those fact rows with no database, and `collect.it.ts` proves the statement really produces
them against a real PostgreSQL. Everything else — identity fields, parameter resolution, `not_applicable` when no entry
applies — belongs to `SubjectFactsIndicator` and is tested once in `test/risk/subjectFactsIndicator.test.ts`.

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

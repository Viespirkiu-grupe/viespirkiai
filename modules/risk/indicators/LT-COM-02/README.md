# LT-COM-02 — Mažas dalyvių skaičius (low number of bidders)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R019), cross-referenced against OLAF-CN01, OLAF-CN02, OLAF-CA02,
VPT-I12 in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)` in the ATN-1 procedure-completion
report, the same grain as [`LT-COM-01`](../LT-COM-01/README.md) and the natural grain of `public.v_dalyviai`.
`totalBids` counts every distinct participant recorded for the lot, **whether or not their bid was later rejected**.

## Where to look

| File                    | Question it answers                                                              |
|-------------------------|------------------------------------------------------------------------------------|
| `parameters.ts`         | What it compares against, and since when                                          |
| `definition.ts`         | Identity, lifecycle, public wording — pure metadata, no behaviour                 |
| `decision.ts`           | What the facts mean — the state, the threshold that decided it, the evidence — the `ALotIndicatorDecision` subclass whose own `assessRisk()` is the judgement method (replaces `rules.ts`) |
| `test/`                 | How we know it works                                                              |

There is no `collect.sql` here (v2 architecture — see below): participation counts (`totalBids`/`reportedAt`) come
from `modules/risk/procurementReader.ts`'s consolidated lot-grain participation query, shared by every lot-grain
indicator (LT-COM-01's `validBids` comes from the same query), and arrive already merged onto
`Subject.lot.participation` before `decision.ts` ever runs.

Inside `test/`, `fixtures.ts` states the expected `Subject.lot.participation` shape for each scenario;
`decision.test.ts` decides those fixtures with no database. The participation query's own correctness (dedup,
cutoff filtering, `daliesNumeris` handling) is tested once, for every lot-grain indicator, in
`test/risk/procurementReader.it.ts`. Everything else — identity fields, parameter resolution, `not_applicable` when
no entry applies — belongs to `ARiskIndicatorDecision`/`ALotIndicatorDecision` and is tested once in
`test/risk/procurementLotDecision.test.ts`.

## How this differs from LT-COM-01

Both indicators read `public.v_dalyviai` at lot grain and share the `insufficient_data` reasoning (unmatched
procurement, an empty report), but they measure different things:

- **LT-COM-01** ("single valid bid") counts bids still **valid after evaluation** — a report can list five
  participants and still trigger LT-COM-01 if four were rejected.
- **LT-COM-02** ("low number of bidders") counts every **recorded participant**, rejected or not — it is a
  competition-level signal, knowable as soon as the report lists who took part, independent of how the evaluation
  turned out.

A lot can trigger one, both, or neither; that overlap is expected, not a bug — the two catalogue rows deliberately
measure related but distinct risks (OCP-R018 vs. OCP-R019).

## Open question: method scope

As with LT-COM-01, `parameters.ts` ships with `scope: {}` (applies to every `pirkimoBudas`) as a v1 placeholder. A
procedure that is by design a single- or few-supplier negotiation (e.g. certain `Derybos` variants aimed at a
pre-chosen supplier) arguably shouldn't be judged against a competitive-procedure bidder count at all. Narrowing the
scope means appending an entry whose `scope.methods` lists the competitive methods; lots run under any other method
then match no entry and become `not_applicable`. That change waits on the same `pirkimoBudas` split review noted in
[`LT-COM-01/README.md`](../LT-COM-01/README.md). Until then this version stays `lifecycle: 'shadow'`.

## Threshold

`minimumBidders: 3` follows OLAF-CN02's "fewer than three tenderers" framing, which is the common low-competition
threshold across the cross-referenced sources (OCP-R019, OLAF-CA02, VPT-I12). It is a parameter rather than a literal
because a reviewer may later argue the line belongs at two or four — that argument should be a new effective-dated
entry, not a new implementation version.

## Real-data sanity run

Read-only run of `collect.sql` against the real database, cutoff **2026-08-14T08:53:12Z** (`data_as_of` = query time):

| Metric                         | Value                                                    |
|---------------------------------|-----------------------------------------------------------|
| Subjects evaluated (lots)       | 1,272 — matches the ATN-1 lot-detail count documented in [`indicators-canonical.md`](../../../../docs/indicators-story/indicators-canonical.md) |
| `triggered`                     | 851 (66.9%)                                                |
| `not_triggered`                 | 410 (32.2%)                                                |
| `insufficient_data` (empty report) | 9 (0.7%) — ATN-1 reports listing no participants          |
| `insufficient_data` (no matching procurement) | 2 (0.2%) — ATN-1 `pirkimoNumeris` with no `v_pirkimas` row |
| Query time                      | ~77s for the full subject universe (1,272 rows). Slow relative to its row count — `v_pirkimas`'s CVPP-fallback join is the likely cost, not this indicator's own logic; worth profiling before this runs on a larger ATN-1 corpus. |

The 66.9% trigger rate is high but not a 0%/100% design smell: a `minimumBidders: 3` bar is a low one, and thin
competition (2 bidders per lot) is common enough in the ATN-1 sample that this is plausible, not a sign the rule is
miscalibrated. Spot-checked lot `cvpis:1039344:1` by hand: `v_dalyviai` lists exactly 2 distinct `tiekejoKodas` for
`(pirkimoNumeris=1039344, daliesNumeris=1)`, matching the fact row's `totalBids: 2` exactly.

Kept `lifecycle: 'shadow'` — the open method-scope question above is unresolved, and a 66.9% trigger rate across every
`pirkimoBudas` unscoped is exactly the kind of number that question would change.

# LT-PRO-05 — Pagreitinta procedūra be pakankamo pagrindo (accelerated procedure without adequate grounds)

Source: OLAF-supported Red Flags indicators (OLAF-CN22, "The use of accelerated procedure") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[olaf.md](../../../../docs/indicators-story/indicators/olaf.md). The booklet lists this as summary-list item I.23
(p. 9) — see [OLAF_Red_Flags_Booklet.pdf](https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf).

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is a single set-membership check: `pirkimoBudas ∈ {accelerated-procedure labels}`.

## Where to look

| File            | Question it answers                                                                     |
|-----------------|-------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `acceleratedProcedures`            |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject       |
| `test/`         | How we know it works                                                                      |

`Subject.procurement.pirkimoBudas` was already loaded by `modules/risk/procurementReader.ts` (from
`public.v_pirkimas_v2`) — `procurementEligibility()` itself already requires it to be non-null for a subject to be
eligible at all, so no reader, view, or migration change was needed for this indicator (same situation as LT-PRO-01).

## What counts as "accelerated"

Unlike LT-PRO-01's negotiated-procedure concept, the accelerated variant does not need its own judgment call about
which procedure families count: the CVP IS notice's own `pirkimoBudas` dictionary names it directly, in parentheses,
on the label itself. Of the 15 distinct `pirkimoBudas` labels observed 2026-08 against the real warehouse population
`procurementEligibility()` admits (`saltinis='cvpis'`, `pirkimoBudas` not null; n=51,531), three carry
"(pagreitinta procedūra)":

| Label                                                       | Count |
|---------------------------------------------------------------|------:|
| `Atviras konkursas (pagreitinta procedūra)`                    |   200 |
| `Ribotas konkursas (pagreitinta procedūra) pagal VPĮ/GSPĮ`     |     1 |
| `Skelbiamos derybos (pagreitinta procedūra) pagal GSPĮ`        |     1 |

`decision.ts` matches `pirkimoBudas` against the parameter list with plain `.includes()`, the same convention
`LT-PRO-01`'s `nonCompetitiveProcedures` and `LT-COM-20`'s `withdrawalStatuses` already use — never a free-text
pattern. The accelerated axis is independent of the negotiated axis: an accelerated procedure can be open, restricted
or negotiated, so LT-PRO-05 and LT-PRO-01 are not mutually exclusive and a single procurement can trigger both.

## Coverage (measured 2026-08 against the real warehouse)

202 of 51,531 eligible procurements (0.39%) carry one of the three accelerated-procedure labels. This is
substantially rarer than LT-PRO-01's 4.7% negotiated-procedure rate, consistent with the accelerated procedure being
a narrower legal exception (Lithuanian law reserves it for objectively urgent cases) rather than a query artifact.

## Why no `insufficient_data` case is reachable in practice

`hasRequiredData()` checks `pirkimoBudas !== null`, but `procurementEligibility()` already requires exactly that
before `isEligible()` ever calls `hasRequiredData()` (see `procurementLotDecision.ts`). It is implemented anyway,
matching every other indicator's contract, rather than special-cased away — see `decision.ts`'s comment.

## The honest limitation: only *published* accelerated procedures are visible

`v_pirkimas`/`v_pirkimas_v2` is sourced from CVP IS procurement notices (`viesiejiPirkimai`), which by construction
only ever carries **published** ("skelbiama") procedures — the same limitation documented in `LT-PRO-01`'s README.
An accelerated procedure run without prior publication, if one exists in Lithuanian practice, would not appear in
`pirkimoBudas` at all; this indicator only ever sees the published form.

## Why "without adequate grounds" is not itself verified

No ingested source records a structured legal-grounds justification for a chosen `pirkimoBudas` — the closest
candidate, `pirkimoBudoPagrindimas`, is free text (see the `LT-OTH-01` "Cannot implement" explanation in
[indicators-canonical.md](../../../../docs/indicators-story/indicators-canonical.md) for why pattern-matching prose
was rejected there). Per the catalogue's own framing ("A flag is a reason to review a procurement, not proof"),
this indicator flags the accelerated-procedure pattern itself as review-worthy; a human reviewer, not the formula,
judges whether the urgency was genuine.

## Scope

The parameter timeline applies to every eligible `pirkimoBudas`, following LT-PRO-01/LT-COM-01/LT-COM-03's
convention — no further method-based narrowing, since the formula's whole purpose is to distinguish procedure
labels.

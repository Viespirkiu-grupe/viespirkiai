# LT-PRI-05 — Aukšta numatoma pirkimo vertė (high estimated value)

Source: OLAF-supported Red Flags indicators (OLAF-CN06 "High estimated value of the contract") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[olaf.md](../../../../docs/indicators-story/indicators/olaf.md).

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is a single scalar comparison: `numatomaVerteEUR > minimumValueEUR`.

## Where to look

| File            | Question it answers                                                                     |
|-----------------|---------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `minimumValueEUR`                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject         |
| `test/`         | How we know it works                                                                        |

`Subject.procurement.numatomaVerteEUR` was already loaded by `modules/risk/procurementReader.ts` (from
`public.v_pirkimas_v2`) for other indicators' use — no reader, view, or migration change was needed for this
indicator.

## Why no threshold is stated in the source

The OLAF booklet lists "High estimated value of the contract" only as a summary-list title (item I.7, p. 9 of
[the booklet](https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf)) — one of the "risk
factor" indicators, not an "infringement" one (p. 8), so it carries no legal threshold to begin with. The booklet's
own practical-recommendations section (p. 11) confirms the Hungarian team set "what price for a contract is 'too
high'" through expert consultation on their own market, a benchmark that does not transfer to Lithuania. As with
LT-OTH-04, the bound here is empirical, not sourced from the reference indicator or a legal deadline.

## Threshold

Measured 2026-08 against the real warehouse, restricted to the same population `procurementEligibility()` already
admits (`saltinis = 'cvpis'`, `pirkimoBudas` not null) and further to rows where `numatomaVerteEUR` is not null
(n = 17,403 — matches domain-model.md §5.1's 17,200 as of its 2026-08-18 snapshot):

| Percentile | 50     | 75      | 90      | 95        | 98        | 99         |
|-----------:|-------:|--------:|--------:|----------:|----------:|-----------:|
| EUR        | 55,537 | 165,289 | 600,000 | 1,404,918 | 5,000,000 | 12,000,000 |

`minimumValueEUR: 1_400_000` (a clean amount close to the measured 95th percentile) flags 873/17,403 (5.0%) as
high-value — in line with LT-OTH-04's ~5% single-tail trigger rate. A random sample of procurements just above the
bound (1.4M–1.8M EUR) was read by hand: medical equipment, rail-welding equipment, dynamic purchasing systems,
municipal repair works, IT system maintenance, negotiated-procedure services — genuinely large public contracts, not
an artifact of duplicate rows or a wrong join.

## Coverage (the honest limitation)

Only the `cvpis` source ever carries `numatomaVerteEUR` — `cvpp` never does (domain-model.md §5.1). Even within
`cvpis`, only 17,403 of 51,503 eligible procurements (33.8%) carry a non-null value; the rest report
`insufficient_data`, not "not high", per `limitationLt`.

## Scope

The parameter timeline applies to every `pirkimoBudas` the shared `procurementEligibility()` gate admits — no
method-based narrowing is applied, matching LT-COM-01/LT-COM-03's convention.

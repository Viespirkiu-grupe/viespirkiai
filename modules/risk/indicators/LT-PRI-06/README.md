# LT-PRI-06 — Aukšta numatoma preliminariosios sutarties vertė (high estimated framework value)

Source: OLAF-supported Red Flags indicators (OLAF-CN04 "High estimated framework-agreement value") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[olaf.md](../../../../docs/indicators-story/indicators/olaf.md).

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is: `isFramework = true AND numatomaVerteEUR > minimumValueEUR`, where `isFramework` comes from the ATN-1
(PPA) procedure report's own `preliminariSutartis` field, not from `pirkimoBudas` or any other free-text/procedure
label — see "Why `preliminariSutartis`, not something else" below.

## Where to look

| File            | Question it answers                                                                          |
|------------------|-----------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `minimumValueEUR`                      |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject           |
| `test/`         | How we know it works                                                                          |

## Why `preliminariSutartis`, not something else

No field on `viesiejiPirkimai` (the primary `cvpis` source `v_pirkimas_v2` reads) says whether a procurement
establishes a framework agreement — `pirkimoBudas` names the *procedure type* (open competition, negotiated, etc.),
not the *contract instrument* it produces, and `type` (CfTWS/CfTDPSWS/Pmc) is a CVP IS notice-form category, not a
framework flag either (CfTDPSWS is a Dynamic Purchasing System notice, a related but distinct instrument). The
contract-side `vpmSutartys."tipasId"` dictionary's `PPS` ("Pagrindinė pirkimo sutartis") looked promising at first
but turned out to be the generic "regular contract from a formal CVP IS procedure" bucket — 309,116 rows, far too
broad to mean "framework" specifically (domain-model.md §6.3).

The one field that directly and structurally answers the catalogue question is
`xlsxPPAataskaitos.preliminariSutartis` — a boolean on the same ATN-1/PPA procedure report LT-OTH-03/04/05 already
read via `public.v_pirkimo_pabaiga_v2`. It is a self-reported closed-vocabulary fact from the buyer's own end-of-
procedure filing, the same evidentiary status as every other field that view already exposes.

## Reader/view change

`modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql` now also selects `a."preliminariSutartis"` (procurement-level,
carried on every per-lot row of the view). `modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL` aggregates
it with `bool_or(po."preliminariSutartis")`, added to `Procurement.procedureOutcome.isFramework`
(`modules/risk/types.ts`): `true` if any report revision under the `pirkimoNumeris` said so, `false` if every
revision said no, `null` if no revision ever populated the field. `bool_or` ignores `NULL` inputs, which is exactly
the aggregation this needs — no separate branch for "no revision answered" was written by hand.

## `hasRequiredData()` is not "is one field null"

A report that positively says `isFramework: false` already answers the formula — `not_triggered`, regardless of
whether `numatomaVerteEUR` is known — the same "a null field can still mean something definite" principle
LT-OTH-05's `proceduruPabaiga` gate follows. Only when `isFramework` is `true` (or unknown) does the value's
presence become load-bearing. `missingDataWhenAbsent` names both `preliminariSutartis` and `numatomaVerteEUR`
regardless of which one was actually missing, the same convention every other indicator in this package uses.

## Why no threshold is stated in the source

Same reasoning as LT-PRI-05: the OLAF booklet lists "Estimated total value of framework agreement (high)" only as a
summary-list title (item I.5, p. 9 of
[the booklet](https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf)) — a "risk factor"
indicator, not an "infringement" one — and its own practical-recommendations section (p. 11) confirms the Hungarian
team set benchmarks through expert consultation on their own market, which does not transfer to Lithuania.

## Threshold

Measured 2026-08 against the real warehouse: every procurement whose ATN-1 report sets `preliminariSutartis = true`
and that also resolves to a `numatomaVerteEUR` on `viesiejiPirkimai` (n = 51 — see "Coverage" below for why this is
small):

| Percentile | 50      | 75      | 90        | 95        |
|-----------:|--------:|--------:|----------:|----------:|
| EUR        | 300,000 | 952,467 | 3,000,000 | 5,156,401 |

`minimumValueEUR: 5_000_000` (a clean amount close to the measured 95th percentile) flags 3/51 (5.9%) — in line with
LT-PRI-05's ~5% single-tail trigger rate, despite the much smaller sample. The three flagged values (24.3M, 7.6M,
6.6M EUR) were read by hand against their `pirkimoNumeris`: all three are multi-year framework agreements for
recurring supplies/services (the kind of procurement a framework instrument exists for), not an artifact of a
duplicate row or a wrong join.

## Coverage (the honest limitation)

The ATN-1/PPA report itself is filed for only a fraction of procurements — 5,859 of 51,503 `cvpis` procurements with
`pirkimoBudas` populated (11.4%) carry any report with `preliminariSutartis` non-null at all (5,606 false, 74 true,
measured 2026-08 against distinct `pirkimoNumeris`), the same source-coverage ceiling LT-OTH-03/04/05 already
document. For every procurement that never filed one, `preliminariSutartis` is `insufficient_data`, not "not a
framework" — the same distinction LT-PRI-05 draws for a missing `numatomaVerteEUR`.

Within reported procurements, framework agreements are themselves rare (74 of 5,859, 1.3%) — a realistic reflection
of how public buyers actually use the instrument, not a data-quality problem. The consequence is a threshold
calibrated on n = 51, an order of magnitude smaller than LT-PRI-05's n = 17,403. It is the best population available
without inventing a second, less-direct proxy for "is this a framework agreement" (see "Why `preliminariSutartis`,
not something else" above) — revisit this calibration once ATN-1 report coverage grows.

## Scope

The parameter timeline applies to every framework-flagged procurement the shared `procurementEligibility()` gate
admits (`saltinis = 'cvpis'`, `pirkimoBudas` not null) — no method-based narrowing beyond that, matching
LT-PRI-05/LT-COM-01/LT-COM-03's convention.

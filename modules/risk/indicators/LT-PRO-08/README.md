# LT-PRO-08 — Trumpas pasiūlymų pateikimo (skelbimo) laikotarpis (short submission/advertisement period)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R003, "Submission period is too short") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[ocp.md](../../../../docs/indicators-story/indicators/ocp.md). Also mapped from OCP-R014 ("Short time between tender
advertising and bid opening"), OLAF-CN29 ("Short time limit for tenders or participation") and OT-I04 ("Length of
advertisement period") — see [olaf.md](../../../../docs/indicators-story/indicators/olaf.md) and
[opentender.md](../../../../docs/indicators-story/indicators/opentender.md).

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is a single computed value against a threshold: `pasiulymuPateikimoTerminas − paskelbimoData` (calendar
days) `< minimumDays`.

## Where to look

| File            | Question it answers                                                                                        |
|-----------------|---------------------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `minimumDays`, `excludedProcedures`                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject, and the eligibility override |
| `test/`         | How we know it works                                                                                           |

`Subject.procurement.paskelbimoData` and `Subject.procurement.pasiulymuPateikimoTerminas` were already loaded by
`modules/risk/procurementReader.ts` (from `public.v_pirkimas_v2`) — no reader, view, or migration change was needed
for this indicator (same situation as LT-PRO-01/LT-PRO-05/LT-PRI-05/LT-PRI-06).

## Why the calendar-date-only comparison

`decision.ts`'s `dateOnlyEpochDays()` discards time-of-day and compares whole calendar days, the same helper
LT-OTH-03/LT-OTH-04 use and for the same reason: `Date.parse` on a full, non-"Z"-suffixed timestamp string is
locale/engine dependent, an ambiguity a risk indicator's own threshold must not inherit.

## Why `Rinkos konsultacija` is gated to `not_applicable`

A pre-procurement market consultation (`pirkimoBudas = 'Rinkos konsultacija'`) is not a competitive tender with a
submission-of-tenders deadline — it is a preliminary step where the buyer asks the market for input, not where
suppliers compete for an award. Its own response window is not an instance of the catalogue concept ("time for
suppliers to prepare a competitive tender"), so `decision.ts` overrides `isEligible()` to gate it to `not_applicable`
before the period is even computed — the shared `procurementEligibility()` gate alone does not do this, since it is
correct for every other procurement indicator that a market consultation stays eligible.

This was not a hypothetical concern: measured 2026-08 against the real warehouse, naively applying the same
`minimumDays` threshold to every eligible `pirkimoBudas` (no exclusion) made `Rinkos konsultacija` 1,615 of 3,433
(47%) of the naive triggered population — nearly half the flagged set would have been a different kind of process
entirely, not genuine tender-preparation-time risk. Every other eligible `pirkimoBudas` label is left alone,
following LT-PRO-01/LT-PRO-05's "no further method-based narrowing" convention — only this one label is structurally
not the concept at all, not merely a milder instance of it.

## Why a non-positive period means `insufficient_data`, not "even shorter than short"

A notice cannot genuinely set a submission deadline before, or on the same calendar day as, its own publication —
unlike LT-OTH-03's evaluation-period concept (where a decision genuinely can, on rare occasions, precede the
nominal deadline), this ordering is not something the real-world process can produce. Sampling the 26 negative and
3 zero-day cases in the wider (unfiltered) population found a consistent pattern: `saltinis='cvpis'` rows carrying a
`paskelbimoData` a specific notice's own publication date, and a `pasiulymuPateikimoTerminas` significantly earlier —
e.g. `pirkimoId` `4032037` (`Atviras konkursas`, `statusas='Atšauktas'`): `paskelbimoData` 2025-11-17,
`pasiulymuPateikimoTerminas` 2025-08-31 (−77 days). The most-recently-published notice for a `pirkimoNumeris` (which
`procurementReader.ts`'s `DISTINCT ON` keeps) is often a later event — a cancellation, a status update — whose own
row still carries the *original* tender's now-stale deadline field, while its `paskelbimoData` is the later event's
own date; the same "dirty/reused notice data" family of issue LT-OTH-04's README documents for
`v_sutartys.pirkimoNumeris`. `decision.ts`'s `submissionPeriodDays()` therefore returns `null` (not a negative
number) whenever the computed value is not strictly positive, which `hasRequiredData()` reports as
`insufficient_data` — the same "exclude, don't force a bogus interpretation" convention LT-OTH-04 uses.

## Threshold

Measured 2026-08 against the real warehouse population eligible under `procurementEligibility()` and this
indicator's own `excludedProcedures` gate (`saltinis='cvpis'`, `pirkimoBudas` not null and not `Rinkos konsultacija`,
`paskelbimoData`/`pasiulymuPateikimoTerminas` both present with a strictly positive calendar-day difference;
n=38,655):

| Percentile | 1 | 5 | 10 |
|-----------:|--:|--:|---:|
| Days       | 2 | 5 |  6 |

`minimumDays: 5` (the measured 5th percentile) flags 1,818/38,655 (4.7%) as anomalously short — in line with
LT-OTH-04's 5.0% and LT-PRO-01's 4.7% single-tail/exception trigger rates for other procurement-level indicators. A
random sample of the flagged set (1–4 day periods) was read by hand: no duplicate rows, and the cases looked like
genuine short windows (mostly `pirkimoBudas` unset — the majority `cvpp` population is excluded entirely by the
shared eligibility gate — plus a mix of `Skelbiama apklausa`, `Atviras konkursas`, `Skelbiamos derybos pagal PĮ`),
not a query artifact.

## Coverage (the honest limitation)

`procurementEligibility()` restricts every procurement indicator to `saltinis='cvpis'` with a non-null `pirkimoBudas`
— the `cvpp` source (the majority of `v_pirkimas`, ~80% of rows) never carries `pirkimoBudas` at all
([domain-model.md](../../../../docs/indicators-story/domain-model.md) §5.1), so this indicator reports
`not_applicable`, not "risk-free", for most procurements in the warehouse. Within the eligible population, coverage
of both dates is otherwise excellent (99.7% of all `v_pirkimas` rows, eligible or not, carry both fields).

## Scope

The parameter timeline applies to every eligible `pirkimoBudas` except `Rinkos konsultacija` — see above. Unlike
LT-PRO-01/LT-PRO-05 (whose formulas are themselves about distinguishing `pirkimoBudas` labels), this indicator
narrows by procedure type only for the one label that is not a competitive-tender concept at all.

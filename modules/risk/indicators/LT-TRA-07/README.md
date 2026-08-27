# LT-TRA-07 — Gauta pretenzija (complaint received)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R020 "Tender has a complaint") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) — [ocp.md](../../../../docs/indicators-story/indicators/ocp.md).
Also matches VPT-I13 ("Share of procurements receiving supplier complaints",
[vpt.md](../../../../docs/indicators-story/indicators/vpt.md)) and OECD-GOV-11 ("Accountability" — complaint
mechanisms, [oecd.md](../../../../docs/indicators-story/indicators/oecd.md)); none of the three sources carries an
operational formula beyond the label itself, so the formula is built directly from the one field that answers the
catalogue question.

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is: `pretenzijaPateikta = TRUE`, where `pretenzijaPateikta` comes from the ATN-1 (PPA) procedure report's own
field — the same self-reported, closed-vocabulary source LT-TRA-06/LT-PRI-06 already read.

## Where to look

| File            | Question it answers                                                                          |
|------------------|-----------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline (no numeric threshold)                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject           |
| `test/`         | How we know it works                                                                          |

## Why `pretenzijaPateikta`, not something else

A schema-wide search for `%pretenzij%`/`%klausim%`/`%skund%` (complaint/claim) found exactly one candidate table:
`xlsxPPAataskaitos.pretenzijaPateikta`, a boolean on the same ATN-1/PPA procedure report LT-OTH-03/04/05/LT-TRA-06/
LT-PRI-06 already read via `public.v_pirkimo_pabaiga_v2`. This is a direct, self-reported answer to "did a supplier
file a pretenzija (the pre-litigation complaint Lithuanian procurement law requires before a court challenge) during
this procedure" — exactly the OCP-R020/VPT-I13 concept, not a proxy built from something else. The report's sibling
field `ieskinysTeismui` ("lawsuit filed in court") carries the related-but-distinct LT-TRA-08 ("Procurement challenged
in court") concept and is not read by this indicator.

## Reader/view change

`modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql` now also selects `a."pretenzijaPateikta"` (procurement-level,
carried on every per-lot row of the view, the same way `preliminariSutartis` already is).
`modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL` aggregates it with `bool_or(po."pretenzijaPateikta")`,
added to `Procurement.procedureOutcome.complaintFiled` (`modules/risk/types.ts`): `true` if any report revision under
the `pirkimoNumeris` said so, `false` if every revision said no, `null` if no revision ever populated the field.
`bool_or` ignores `NULL` inputs, the same aggregation `isFramework` already relies on — no separate branch for "no
revision answered" was written by hand.

## `hasRequiredData()` is not "is one field null"

Same principle as every other indicator built on this report: a report that positively says `complaintFiled: false`
already answers the formula (`not_triggered`) — only a total absence of report data (`complaintFiled === null`) is
`insufficient_data`. `missingDataWhenAbsent` names `pretenzijaPateikta`.

## Why no threshold is stated in the source

Unlike LT-PRI-05/LT-PRI-06, this is a plain boolean check — the catalogue concept is "a complaint exists for this
procurement", not "how many" or "how severe". There is no numeric threshold to calibrate.

## Coverage (the honest limitation)

Measured 2026-08 against the real warehouse: of 51,553 eligible `cvpis` procurements (`pirkimoBudas` populated),
5,821 (11.3%) carry any ATN-1/PPA report with `pretenzijaPateikta` non-null at all — the same source-coverage
ceiling LT-OTH-03/04/05/LT-TRA-06/LT-PRI-06 already document, since it is the same report. For every procurement
that never filed one, the indicator reports `insufficient_data`, not "no complaint".

Within reported procurements, a complaint is not rare: 960 of 5,821 (16.5%) are flagged `true`. A handful of manually
inspected `triggered` examples (e.g. `pirkimoNumeris` 1058663 "Atminimo dovanos", 1069713 "Lyderystės kompetencijų
ugdymo mokymų organizavimo paslaugos", 1077076 "Pavoverės pasienio užkardos sienos stebėjimo sistemos atnaujinimas")
are genuine, distinct procurements across unrelated buyers/objects, not an artifact of a duplicate row or a wrong
join — the 1077076 case in particular surfaced two report revisions both saying `true`, exactly the `bool_or`
semantics working as intended, not a double-count.

## Scope

The parameter timeline applies to every complaint-flagged procurement the shared `procurementEligibility()` gate
admits (`saltinis = 'cvpis'`, `pirkimoBudas` not null) — no method-based narrowing beyond that, matching
LT-PRI-05/LT-PRI-06/LT-TRA-06/LT-COM-01/LT-COM-03's convention.

# LT-TRA-08 — Pareikštas ieškinys teismui (procurement challenged in court)

Source: [VPT indicators](../../../../docs/indicators-story/indicators/vpt.md), VPT-I14 ("Share of procurements
challenged in court") in the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md). The
VPT catalogue is a normalized label from the VPT public monitoring dashboard, not an operational formula, so the
formula is built directly from the one field that answers the catalogue question.

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is: `ieskinysTeismui = TRUE`, where `ieskinysTeismui` comes from the ATN-1 (PPA) procedure report's own
field — the same self-reported, closed-vocabulary source LT-TRA-06/LT-TRA-07/LT-PRI-06 already read.

## Where to look

| File            | Question it answers                                                                          |
|------------------|-----------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline (no numeric threshold)                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject           |
| `test/`         | How we know it works                                                                          |

## Why `ieskinysTeismui`, not something else

LT-TRA-07's own README already identified this field while explaining why it was *not* the one that indicator reads:
`xlsxPPAataskaitos.ieskinysTeismui` ("lawsuit filed in court") is the direct sibling field to `pretenzijaPateikta`
("pretenzija filed") on the same ATN-1/PPA procedure report, already read via `public.v_pirkimo_pabaiga_v2`. It is a
direct, self-reported answer to "did a supplier file a lawsuit in court against this procurement" — exactly the
VPT-I14 concept, not a proxy built from something else. Lithuanian procurement law requires the pre-litigation
`pretenzija` (LT-TRA-07) before a court challenge, so the two fields record related but distinct steps of the same
dispute escalation; `ieskinysTeismui` is the later, more severe one.

## Reader/view change

`modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql` now also selects `a."ieskinysTeismui"` (procurement-level,
carried on every per-lot row of the view, the same way `pretenzijaPateikta` already is).
`modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL` aggregates it with `bool_or(po."ieskinysTeismui")`,
added to `Procurement.procedureOutcome.courtChallenged` (`modules/risk/types.ts`): `true` if any report revision
under the `pirkimoNumeris` said so, `false` if every revision said no, `null` if no revision ever populated the
field. `bool_or` ignores `NULL` inputs, the same aggregation `complaintFiled`/`isFramework` already rely on — no
separate branch for "no revision answered" was written by hand.

## `hasRequiredData()` is not "is one field null"

Same principle as every other indicator built on this report: a report that positively says
`courtChallenged: false` already answers the formula (`not_triggered`) — only a total absence of report data
(`courtChallenged === null`) is `insufficient_data`. `missingDataWhenAbsent` names `ieskinysTeismui`.

## Why no threshold is stated in the source

Unlike LT-PRI-05/LT-PRI-06, this is a plain boolean check — the catalogue concept is "a court challenge exists for
this procurement", not "how many" or "how severe". There is no numeric threshold to calibrate.

## Coverage (the honest limitation)

Measured 2026-08 against the real warehouse: of 51,553 eligible `cvpis` procurements (`pirkimoBudas` populated),
5,925 (11.5%) carry any ATN-1/PPA report with a procedure-ending decision at all — the same source-coverage ceiling
LT-OTH-03/04/05/LT-TRA-06/LT-TRA-07/LT-PRI-06 already document, since it is the same report — and 5,848 of those
have `ieskinysTeismui` non-null. For every procurement that never filed a report, or whose report never populated
this field, the indicator reports `insufficient_data`, not "no lawsuit".

Within reported procurements, a court challenge is genuinely rare: 37 of 5,848 (0.63%) are flagged `true` —
noticeably rarer than LT-TRA-07's pretenzija rate (16.5%), consistent with a lawsuit being the escalated, less common
step after a pretenzija is filed and (usually) resolved without litigation. A handful of manually inspected
`triggered` examples (`pirkimoNumeris` 3071878 "Atliekų deginimo metu jėgainėje susidarančių lakiųjų pelenų
tvarkymo paslaugos", 4735601 "Greitosios medicinos pagalbos automobiliai", 3913544 "Šilutės seniūnijos komunalinio
ūkio aptarnavimo paslaugos", 5746837 "Bendrosios civilinės atsakomybės draudimo paslaugos") are genuine, distinct
procurements across unrelated buyers/objects, not an artifact of a duplicate row or a wrong join.

## Scope

The parameter timeline applies to every court-challenge-flagged procurement the shared `procurementEligibility()`
gate admits (`saltinis = 'cvpis'`, `pirkimoBudas` not null) — no method-based narrowing beyond that, matching
LT-PRI-05/LT-PRI-06/LT-TRA-06/LT-TRA-07/LT-COM-01/LT-COM-03's convention.

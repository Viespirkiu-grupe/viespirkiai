# LT-TRA-09 — Pirkimas vykdytas ne elektroniniu būdu (procurement not conducted electronically)

Source: [VPT indicators](../../../../docs/indicators-story/indicators/vpt.md), VPT-I06 ("Share of electronic
procurements"), broadened by [OECD indicators](../../../../docs/indicators-story/indicators/oecd.md) OECD-GOV-07
("Use integrated, secure digital procurement throughout the cycle") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md). Neither reference carries an
operational formula of its own, so the formula is built directly from the one field that answers the catalogue
question.

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is: `elektroninisPirkimas = FALSE`, where `elektroninisPirkimas` comes from the ATN-1 (PPA) procedure
report's own field — the same self-reported, closed-vocabulary source LT-TRA-06/LT-TRA-07/LT-TRA-08/LT-PRI-06 already
read.

## Where to look

| File            | Question it answers                                                                          |
|------------------|-----------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline (no numeric threshold)                    |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject           |
| `test/`         | How we know it works                                                                          |

## Why `elektroninisPirkimas`, not something else

`xlsxPPAataskaitos.elektroninisPirkimas` ("electronic procurement") is a direct, self-reported answer to "was this
procedure conducted through CVP IS electronic means" — exactly the VPT-I06/OECD-GOV-07 concept, not a proxy built
from something else. Its sibling free-text field, `neElektroninisPriežastys` ("reasons it was not electronic"), is
carried on the source table too but is sparsely populated (1 of 43 `false` rows in the live warehouse carries any
text) and not read by this indicator — the boolean alone already answers the catalogue question; the reason text is
left for a human reviewer to read on the underlying report, not parsed here.

## Reader/view change

`modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql` now also selects `a."elektroninisPirkimas"` (procurement-level,
carried on every per-lot row of the view, the same way `ieskinysTeismui`/`pretenzijaPateikta`/`preliminariSutartis`
already are). `modules/risk/procurementReader.ts`'s `PROCEDURE_OUTCOME_SQL` aggregates it with
`bool_or(po."elektroninisPirkimas")`, added to `Procurement.procedureOutcome.electronicProcurement`
(`modules/risk/types.ts`): `true` if any report revision under the `pirkimoNumeris` said so, `false` if every
revision said no, `null` if no revision ever populated the field. `bool_or` ignores `NULL` inputs, the same
aggregation `courtChallenged`/`complaintFiled`/`isFramework` already rely on — no separate branch for "no revision
answered" was written by hand.

## `hasRequiredData()` is not "is one field null"

Same principle as every other indicator built on this report: a report that positively says
`electronicProcurement: true` already answers the formula (`not_triggered`) — only a total absence of report data
(`electronicProcurement === null`) is `insufficient_data`. `missingDataWhenAbsent` names `elektroninisPirkimas`.

## Direction is inverted relative to the raw field

Unlike `courtChallenged`/`complaintFiled`/`isFramework`, this indicator's `triggered` state corresponds to the raw
field being `false`, not `true` — the catalogue concept is "not conducted electronically", the opposite polarity of
the source column's own name. `decision.ts` calls this out explicitly in a comment to avoid a silent sign error.

## Why no threshold is stated in the source

Same as LT-TRA-06/LT-TRA-07/LT-TRA-08: a plain boolean check, not a numeric ratio to calibrate.

## Coverage (the honest limitation)

Measured 2026-08 against the real warehouse: of 51,560 eligible `cvpis` procurements (`pirkimoBudas` populated),
5,858 (11.4%) carry any ATN-1/PPA report at all — the same source-coverage ceiling
LT-OTH-03/04/05/LT-TRA-06/LT-TRA-07/LT-TRA-08/LT-PRI-06 already document, since it is the same report — and 5,847 of
those have `elektroninisPirkimas` non-null.

Within reported procurements, a non-electronic procedure is genuinely rare: 34 of 5,847 (0.58%) are flagged `true`
(6,520 flagged electronic, 43 non-electronic nationwide across the whole report population before restricting to
eligible `cvpis` procurements) — consistent with CVP IS electronic procurement being in force since ~2011 and
essentially mandatory, so a `false` value is expected to be a genuine, rare exception (e.g. a classified/security
procurement conducted outside CVP IS) rather than a common outcome. A handful of manually inspected `triggered`
examples (`pirkimoNumeris` 7295493 "Kompiuterinė įranga ir reikmenys", 6667602 "Šiukšliavežių antstatų remonto
paslaugos", 3553267 "31500-2 Pervažos gumos plokščių danga", 7300538 "Membraniniai filtravimo moduliai") are genuine,
distinct procurements across unrelated buyers/objects, not an artifact of a duplicate row or a wrong join.

## Scope

The parameter timeline applies to every non-electronic-flagged procurement the shared `procurementEligibility()` gate
admits (`saltinis = 'cvpis'`, `pirkimoBudas` not null) — no method-based narrowing beyond that, matching
LT-PRI-05/LT-PRI-06/LT-TRA-06/LT-TRA-07/LT-TRA-08/LT-COM-01/LT-COM-03's convention.

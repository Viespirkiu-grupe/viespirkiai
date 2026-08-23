# LT-OTH-05 — Pirkimo procedūra pasibaigė nesėkmingai arba be sutarties sudarymo (procedure unsuccessful or award not contracted)

Source: OLAF-supported "Red Flags" booklet's contract-award-notice list, items II.5 ("Unsuccessful procedure for
risky reasons"), II.6 ("Unsuccessful procedure without statement of reason") and II.7 ("Successful procedure without
contracting"), merged into one indicator — see the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) and
[olaf.md](../../../../docs/indicators-story/indicators/olaf.md). VPT-I11 ("Share of terminated or unsuccessful
procedures") is the same concept at aggregate/dashboard grain; this indicator states it per procurement.

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`. The formula requires **every**
lot's procedure-ending outcome to be something other than "contract concluded" before it triggers: a multi-lot
procurement where even one lot ended in a signed contract is `not_triggered`, since the buyer did get at least part
of what it set out to procure.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|---------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the `concludedOutcomes` label list — what counts as "concluded"     |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject              |
| `test/`         | How we know it works                                                                              |

`Subject.procurement.procedureOutcome` (`lotOutcomes`/`reportedAt`) comes from
`modules/risk/procurementReader.ts`'s consolidated procurement-grain `PROCEDURE_OUTCOME_SQL` query, reading
`public.v_pirkimo_pabaiga_v2` — a new view (`modules/mcp/analyst/views/v_pirkimo_pabaiga.sql` +
`v_pirkimo_pabaiga_v2.sql`) added for this indicator.

## Why a new view, not `v_dalyviai`

Every other risk-service view reads `xlsxPPAataskaitos` joined through `xlsxPPAdalyviai` (the participant table), a
path that only produces a row when the report lists at least one participant. `xlsxPPAproceduruPabaiga` (the
procedure-ending decision) is a sibling child table of `xlsxPPAataskaitos`, not of `xlsxPPAdalyviai` — a procedure
that ended because **no supplier submitted anything at all** ("Per nustatytą terminą tiekėjams nepateikus nė vienos
paraiškos...") has zero `xlsxPPAdalyviai` rows, so joining through `v_dalyviai` would silently drop exactly the
outcome this indicator most needs to see. `v_pirkimo_pabaiga(_v2)` reads `xlsxPPAataskaitos`/`xlsxPPAproceduruPabaiga`
directly instead.

## The `concludedOutcomes` list

The ATN-1/PPA report's "Pirkimo procedūros pabaigos priežastis" field is a closed dropdown, not free text, but the
real data carries five distinct phrasings for "a contract/framework/DPS/design-contest winner was concluded" —
capitalization and a "pirkimo"/"pirkimų" wording difference between report-form revisions:

```
Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją
Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimo sistemą arba nustačius projekto konkurso laimėtoją
sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją
Sudarius pirkimo sutartį (preliminariąją sutartį) arba nustačius projekto konkurso laimėtoją
Sudarius pirkimo sutartį
```

`decision.ts` matches `lotOutcomes` against this list with plain `.includes()`, the same convention
`LT-COM-20`'s `withdrawalStatuses` already uses for `atmetimoStatusas` — never a free-text pattern. Everything not
in this list (including "Visiems tiekėjams atšaukus pasiūlymus... ar atsisakius sudaryti pirkimo sutartį" and
"Pasibaigus pasiūlymų galiojimo laikui ir nesudarius pirkimo sutarties..." — OLAF-CA07's "successful procedure
without contracting" case, where a winner was picked but the contract was never signed) counts as not concluded.

## Data coverage (measured 2026-08 against the real warehouse)

5,925 procurements carried at least one `xlsxPPAproceduruPabaiga` row. Of those: 5,020 (84.7%) had at least one lot
concluded, 905 (15.3%) had none. A random sample of the 905 `triggered` cases was read by hand — every one carried a
genuine unsuccessful-procedure label ("no bids received", "all applications rejected", "procedure terminated"), not
a query artifact. Re-run the throwaway Phase 6 script (see the plan template) if this measurement needs refreshing.

## Scope

The parameter timeline applies to every `pirkimoBudas` — ATN-1/PPA reports are filed for the procedures this
indicator's data depends on regardless of method, so no method-based narrowing is applied (unlike LT-COM-03's open
scope question, this one has no comparable ambiguity: "did the procedure conclude in a contract" is meaningful for
every method the report covers).

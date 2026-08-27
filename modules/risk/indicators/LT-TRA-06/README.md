# LT-TRA-06 — Pirkimo procedūros sprendimas ar jo priežastis nedokumentuoti (procurement decision or reason not documented)

Source: STT corruption-risk analyses (STT-I15, "neišsami pirkimo dokumentacija ar sprendimai"), broadened by the
OLAF-supported "Red Flags" booklet's item II.6 ("Unsuccessful procedure without statement of reason", OLAF-CA06) —
see the [canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md), [stt.md](../../../../docs/indicators-story/indicators/stt.md)
and [olaf.md](../../../../docs/indicators-story/indicators/olaf.md). `LT-OTH-05` ("Procedure unsuccessful or award
not contracted") is the closest sibling — both read `Subject.procurement.procedureOutcome` — but tests a different
column of the same report row: `LT-OTH-05` asks *what* the outcome was, `LT-TRA-06` asks whether the buyer *said
why*.

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`. Unlike `LT-OTH-05`'s "every lot
must fail" formula, this one triggers if **any** lot's procedure-ending decision lacks a stated reason: a
well-documented decision on one lot does not offset an undocumented one on another — each lot's decision is its own
transparency event.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|---------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording — no tunable threshold, this is a pure presence/absence check            |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject              |
| `test/`         | How we know it works                                                                              |

`Subject.procurement.procedureOutcome.lots[].sprendimoPriezastys` comes from `modules/risk/procurementReader.ts`'s
`PROCEDURE_OUTCOME_SQL`, reading `public.v_pirkimo_pabaiga_v2` (`modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql`)
— the same view `LT-OTH-03`/`LT-OTH-05`/`LT-PRI-06` already share. Adding this indicator extended both the view and
the reader's `lots` json_agg with one more column, `xlsxPPAproceduruPabaiga."sprendimoPriezastys"`, and added the
matching field to `ProcedureOutcomeLot` in `modules/risk/types.ts` — a required field, so every existing fixture
building a `ProcedureOutcomeLot` literal (`LT-OTH-03/04/05`, `LT-PRI-06`, `test/risk/procurementReader.it.ts`) picked
up an explicit `sprendimoPriezastys: null`/value alongside it.

## The formula

For each lot with a procedure-ending decision recorded, "documented" means `sprendimoPriezastys` is non-null and not
blank/whitespace-only (the report form accepts a submitted-but-empty field, which carries the same absence of
information as a NULL column). The procurement triggers if at least one lot's decision is undocumented.

Deliberately **not** scoped to unsuccessful outcomes only, even though OLAF-CA06's own wording is "unsuccessful
procedure without statement of reason": STT-I15's broader "documentation or decisions are incomplete" is the
canonical row's actual concept, and the real data confirms the two are not collinear — a meaningful share of
*concluded* (successful) decisions also carry no stated reason (see coverage below). Testing only unsuccessful
outcomes would silently drop that half of the real signal.

## Data coverage (measured 2026-08 against the real warehouse)

Of 12,275 `xlsxPPAproceduruPabaiga` rows carrying a non-null outcome label, 11,356 (92.5%) carry a non-empty
`sprendimoPriezastys` and 919 (7.5%) do not — split across both concluded and unsuccessful outcome labels, not
concentrated in one:

| `proceduruPabaiga`                                           | with reason | without reason |
|----------------------------------------------------------------|------------:|----------------:|
| Sudarius pirkimo sutartį... (the "pirkimų" wording variant)    |       8,785 |             231 |
| Sudarius pirkimo sutartį... (the "pirkimo" wording variant)    |         235 |             316 |
| Per nustatytą terminą... nepateikus nė vienos paraiškos        |         687 |             220 |
| Atmetus visas paraiškas, pasiūlymus...                         |         956 |             103 |
| Nutraukus pirkimo ar projekto konkurso procedūras               |         617 |              36 |

At procurement grain (5,925 procurements with at least one outcome row, the same population `LT-OTH-05` measures):
**457 (7.71%)** have at least one lot whose decision carries no stated reason — the `triggered` set. Not a query
artifact: the split spans both successful and unsuccessful outcome labels roughly proportionally to their own
share of the population, not concentrated in one label the way a join bug or a single mis-mapped status would
produce. Re-run the throwaway Phase 6 script (see the implementation plan template) if this measurement needs
refreshing.

## Scope

Applies to every `pirkimoBudas` the ATN-1/PPA report covers, the same as `LT-OTH-05` — no method-based narrowing.

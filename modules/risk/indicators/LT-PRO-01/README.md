# LT-PRO-01 — Nepagrįstai naudota nekonkurencinė (derybų) procedūra (unjustified non-competitive procedure)

Source: STT corruption-risk analyses (STT-I08, "unjustified non-competitive or negotiated procedure") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[stt.md](../../../../docs/indicators-story/indicators/stt.md). Also mapped from OCP-R010 ("Unjustified use of
non-competitive procedure"), OLAF-CN23 ("Negotiated procedure lacks proper legal grounds"), OT-I03 ("Procedure
type") and VPT-I15 ("Share/value of non-competitive procedures") — see [ocp.md](../../../../docs/indicators-story/indicators/ocp.md),
[olaf.md](../../../../docs/indicators-story/indicators/olaf.md), [opentender.md](../../../../docs/indicators-story/indicators/opentender.md)
and [vpt.md](../../../../docs/indicators-story/indicators/vpt.md).

Unit of analysis is the **procurement** — one row per `pirkimoNumeris`, keyed by `saltinis` + `pirkimoNumeris`. The
formula is a single set-membership check: `pirkimoBudas ∈ {negotiated-procedure labels}`.

## Where to look

| File            | Question it answers                                                                     |
|-----------------|-------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — `nonCompetitiveProcedures`         |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject       |
| `test/`         | How we know it works                                                                      |

`Subject.procurement.pirkimoBudas` was already loaded by `modules/risk/procurementReader.ts` (from
`public.v_pirkimas_v2`) — `procurementEligibility()` itself already requires it to be non-null for a subject to be
eligible at all, so no reader, view, or migration change was needed for this indicator.

## What counts as "non-competitive"

STT-I08 frames the non-competitive concept as the negotiated procedure itself ("unjustified non-competitive **or
negotiated** procedure"), not a separate legal category. The 15 distinct `pirkimoBudas` labels observed 2026-08
against the real warehouse population `procurementEligibility()` admits (`saltinis='cvpis'`, `pirkimoBudas` not
null; n=51,531) split cleanly into two groups:

| Group             | Labels                                                                                                                                                                                                        |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Competitive by design (`not_triggered`) | `Atviras konkursas`, `Atviras konkursas (pagreitinta procedūra)`, `Ribotas konkursas pagal VPĮ/PĮ/GSPĮ/KĮ`, `Ribotas konkursas (pagreitinta procedūra) pagal VPĮ/GSPĮ`, `Dinaminė pirkimo sistema`, `Konkurencinis dialogas`, `Skelbiama apklausa`, `Rinkos konsultacija`, `Kvalifikacijos reikalavimų sistema` |
| Negotiated (`triggered`, the `nonCompetitiveProcedures` parameter) | `Skelbiamos derybos pagal PĮ` (1,830), `Skelbiamos derybos pagal VPĮ` (318), `Skelbiama apklausa su derybomis` (239), `Skelbiamos derybos pagal GSPĮ` (26), `Derybos pagal KĮ` (2), `Skelbiamos derybos (pagreitinta procedūra) pagal GSPĮ` (1) |

`decision.ts` matches `pirkimoBudas` against the parameter list with plain `.includes()`, the same convention
`LT-COM-20`'s `withdrawalStatuses` and `LT-OTH-05`'s `concludedOutcomes` already use — never a free-text pattern.
Open competition, restricted competition, a dynamic purchasing system, and competitive dialogue are excluded as
competitive-by-design procedures under Lithuanian procurement law, even though restricted competition and
competitive dialogue are also two-stage/negotiation-involving mechanisms: all four admit any interested supplier to
compete on the merits, unlike a negotiated procedure, which restricts *whom the buyer negotiates with* to
suppliers the buyer itself selects. `Rinkos konsultacija` (pre-procurement market consultation) and
`Kvalifikacijos reikalavimų sistema` (qualification system) are not competitive-outcome procedures at all — they
are excluded from the triggered set for the same "not what the indicator is about" reason, not because they were
found to be competitive.

## Coverage (measured 2026-08 against the real warehouse)

2,416 of 51,531 eligible procurements (4.7%) carry one of the six negotiated-procedure labels. This is the same
order of magnitude as LT-PRI-05/LT-OTH-04's ~5% single-tail trigger rates for other procurement-level indicators —
plausible for a genuine minority-use exception mechanism, not a query artifact.

## Why no `insufficient_data` case is reachable in practice

`hasRequiredData()` checks `pirkimoBudas !== null`, but `procurementEligibility()` already requires exactly that
before `isEligible()` ever calls `hasRequiredData()` (see `procurementLotDecision.ts`). It is implemented anyway,
matching every other indicator's contract, rather than special-cased away — see `decision.ts`'s comment.

## The honest limitation: only *published* negotiated procedures are visible

`v_pirkimas`/`v_pirkimas_v2` is sourced from CVP IS procurement notices (`viesiejiPirkimai`), which by construction
only ever carries **published** ("skelbiama") procedures. The most clearly non-competitive procedure under
Lithuanian law — negotiated procedure *without* prior publication ("neskelbiamos derybos"), typically used for
low-value or sole-source purchases — is never published as a CVP IS notice and therefore never appears in
`pirkimoBudas` at all. `cvppPlanuojamiPirkimai` (the planning-notice table) does carry a `pirkimoBudas` value of
`Neskelbiamos derybos` (3,913 rows) and several related unpublished-procedure labels, but the domain model's own
planning-to-procurement link is unreliable (`v_pirkimo_planas` "no key: matched on buyer, object, period" —
[domain-model.md](../../../../docs/indicators-story/domain-model.md) §2.3), so it cannot be joined onto a
`v_pirkimas` subject with confidence. This indicator therefore only ever sees the milder, *advertised* form of
negotiated procedure — its `limitationLt` states this explicitly rather than implying full coverage of "unjustified
non-competitive" procurement.

## Why "unjustified" is not itself verified

No ingested source records a structured legal-grounds justification for a chosen `pirkimoBudas` — the closest
candidate, `pirkimoBudoPagrindimas`, is free text (see the `LT-OTH-01` "Cannot implement" explanation in
[indicators-canonical.md](../../../../docs/indicators-story/indicators-canonical.md) for why pattern-matching prose
was rejected there). Per the catalogue's own framing ("A flag is a reason to review a procurement, not proof"),
this indicator flags the negotiated-procedure pattern itself as review-worthy; a human reviewer, not the formula,
judges whether the specific legal grounds actually applied.

## Scope

The parameter timeline applies to every eligible `pirkimoBudas`, following LT-COM-01/LT-COM-03's convention — no
further method-based narrowing, since the formula's whole purpose is to distinguish procedure methods.

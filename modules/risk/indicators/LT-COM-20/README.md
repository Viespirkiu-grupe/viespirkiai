# LT-COM-20 — Netikėtas ar dažnas pasiūlymo atsiėmimas (unexpected or frequent bid withdrawal)

Source: OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update (OECD-BR-04, "Suppliers
unexpectedly or frequently withdraw submitted bids"), in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md).

Unit of analysis is the **bid** — one row per `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, the domain model's
`v_dalyviai` subject entity ([domain-model.md](../../../../docs/indicators-story/domain-model.md) §1.1) and the
catalogue's "Bid / bidder participation" subject register. This is the first `bid`-grain indicator deployed, so it
also introduces the `bid` `SubjectType` and its supporting infrastructure (`Bid`/`BidSubject` in `types.ts`,
`ABidIndicatorDecision`, the Procurement Reader's bid-grain query, `RiskDecisionEngine.evaluateBid`) rather than
reusing an existing one — see the Follow-up section below.

A bid triggers when the ATN-1/PPA procedure report's own **structured rejection status**
(`xlsxPPAatmestuPasiulymuStatusai`, exposed as `public.v_dalyviai_v2."atmetimoStatusas"`) says the participant
withdrew their own bid, rather than the buyer rejecting it for cause.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the parameter timeline — the withdrawal status label(s), and since when |
| `decision.ts`   | The `ABidIndicatorDecision` subclass whose `assessRisk()` judges the subject |
| `test/`         | How we know it works                                                        |

`Bid` (`tiekejoKodas`/`eileNumeris`/`pasiulymoKaina`/`atmetimoPriezastis`/`atmetimoStatusas`/`reportedAt`) comes from
`modules/risk/procurementReader.ts`'s bid-grain query, merged onto `Lot.bids` before `decision.ts` runs — one row per
bidder observed in `public.v_dalyviai_v2`, deduplicated by `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`.

`test/fixtures.ts` states the expected `Bid` shape for each scenario; `decision.test.ts` decides those fixtures with
no database. The bid-grain query itself is tested in `test/risk/procurementReader.it.ts`. Identity fields, parameter
resolution, and the `not_applicable` case belong to `ARiskIndicatorDecision`/`ABidIndicatorDecision` and follow the
same shared machinery `test/risk/procurementLotDecision.test.ts` covers for `AProcurementIndicatorDecision`.

## Data source

`xlsxPPAatmestiPasiulymai.statusasId` → `xlsxPPAatmestuPasiulymuStatusai.pavadinimas` is a structured dictionary, not
free text — distinct from the general rejection-reason text (`atmetimoPriezastis`) LT-COM-01 reads, which records a
self-withdrawal only inconsistently (measured: 4 free-text rows nationwide out of 12,564 rejected bids, against 78
rows carrying the dedicated withdrawal status, across 70 distinct procurements — measured 2026-08-15). The status
dictionary currently carries exactly one label meaning self-withdrawal:

> "Dalyvis (kandidatas) pasiūlymus (galutinius pasiūlymus) atsiėmė iki pasiūlymų eilės sudarymo"
> (the participant withdrew their bid(s) before the price ranking was established)

`v_dalyviai.sql`/`v_dalyviai_v2.sql` both expose this as `"atmetimoStatusas"` — a new column added for this
indicator (see their `git log`).

## Eligibility and required data

Reuses the shared Lot Eligibility Decision (parent lot → parent procurement: `cvpis` + `pirkimoBudas` present) — no
bid-specific eligibility rule exists yet. `hasRequiredData()` requires the ATN-1 report's own offer-detail join to
have found *some* outcome for this bidder — either a price ranking (`eileNumeris`) or a rejection
(`atmetimoPriezastis`/`atmetimoStatusas`); a bidder listed as a participant but with neither is `insufficient_data`,
not `not_triggered`.

## Scope and threshold

`withdrawalStatuses: [WITHDRAWN_STATUS]` is a parameter (list, not a literal in `decision.ts`) so a future addition
to the source dictionary can be added as a new effective-dated entry without a new indicator version.

## Follow-up

- **"Frequent" withdrawal is not implemented.** OECD-BR-04 is "unexpectedly *or* frequently" — this version only
  judges each withdrawal event on its own. A supplier-grain aggregate ("this supplier has withdrawn N times across
  M procurements") would need the `supplier` `SubjectType`'s own `Subject` variant, not yet built.
- **Withdrawal *after* the price ranking is established is not distinguished.** That is the more suspicious pattern
  (the bidder saw their competitive position, then pulled out) but the structured status dictionary only currently
  carries a label for withdrawal *before* ranking; a handful of free-text `atmetimoPriezastis` rows mention
  after-ranking withdrawal, but too inconsistently (2 rows nationwide) to build a rule on.
- The new `bid` `SubjectType` infrastructure this indicator introduces is now available to the next bid-grain
  indicator (e.g. LT-COM-21, LT-PRI-09, LT-PRI-11, also catalogued under "Bid / bidder participation") without
  repeating this setup.

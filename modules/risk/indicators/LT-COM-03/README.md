# LT-COM-03 — Konsultuotas ar kviestas tik vienas tiekėjas (only one supplier invited or consulted)

Source: STT corruption-risk analyses (STT-I02, "only one supplier consulted or invited") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[stt.md](../../../../docs/indicators-story/indicators/stt.md).

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`, rolling up every lot into a
single subject. `totalSuppliers` counts every distinct supplier recorded anywhere in the procurement, **whether or
not their bid was later rejected**, and regardless of which lot they bid on.

## Where to look

| File            | Question it answers                                                                  |
|-----------------|------------------------------------------------------------------------------------------|
| `parameters.ts` | What it compares against, and since when                                                |
| `definition.ts` | Identity, lifecycle, public wording                                                     |
| `decision.ts`   | The `AProcurementIndicatorDecision` subclass whose `assessRisk()` judges the subject     |
| `test/`         | How we know it works                                                                    |

The cross-lot distinct-supplier count (`totalSuppliers`/`reportedAt`) comes from
`modules/risk/procurementReader.ts`'s consolidated procurement-grain participation query and arrives already merged
onto `Subject.procurement.participation` before `decision.ts` runs.

`test/fixtures.ts` states the expected `Subject.procurement.participation` shape for each scenario;
`decision.test.ts` decides those fixtures with no database. The participation query's cross-lot union is tested in
`test/risk/procurementReader.it.ts`. Identity fields, parameter resolution, and the `not_applicable` case belong to
`ARiskIndicatorDecision`/`AProcurementIndicatorDecision` and are tested in `test/risk/procurementLotDecision.test.ts`.

## How this differs from LT-COM-01 and LT-COM-02

All three are judged from participation counts the Procurement Reader merges onto `Lot`/`Procurement`, and share the
`insufficient_data` reasoning, but they differ in grain and in what they measure:

- **LT-COM-01** and **LT-COM-02** both judge one **lot** at a time — a multi-lot procurement produces one decision
  per lot.
- **LT-COM-03** judges the **whole procurement**: every lot's participants are unioned into one distinct-supplier
  count before the threshold is applied. A supplier that bid on two lots of the same procurement is counted once,
  not twice (`test/fixtures.ts`'s `sameSupplierAcrossTwoLots`), and a procurement where lot 1 drew one supplier and
  lot 2 drew a different one is **not** a single-supplier procurement even though neither lot alone reached two
  (`differentSuppliersAcrossTwoLots`).
- The threshold is stricter and differently framed: `minimumSuppliers: 2` (trigger only when a procurement drew **at
  most one** distinct supplier in total) versus LT-COM-02's `minimumBidders: 3` per lot. STT-I02 names exactly one
  supplier as the flagged case, not "few" suppliers, so LT-COM-03 is a narrower, rarer signal than LT-COM-02.

## Scope

`parameters.ts` ships with `scope: {}`, applying to every `pirkimoBudas`, following LT-COM-01 and LT-COM-02's
precedent for the same open scope question. STT-I02 is conceptually about procedures where the buyer chooses **whom
to approach** — negotiated procedures, restricted competitions, and low-value survey ("apklausa") procurements — not
open competitions, which by design admit any interested supplier. Narrowing the scope to those methods is deferred
until the `pirkimoBudas` vocabulary those procedures actually produce is confirmed against ingested data; low-value
"apklausa" procurements are statutorily exempt from the procedure-completion report this indicator's data depends
on, so they are unreachable through `v_dalyviai` regardless of scoping. `lifecycle: 'shadow'` until this is
resolved.

## Threshold

`minimumSuppliers: 2` triggers when a procurement drew fewer than two distinct suppliers in total — i.e. exactly
one, since zero is `insufficient_data`. This is the smallest integer that captures STT-I02's own framing ("only one
supplier"); the broader "few suppliers" signal is what LT-COM-02 already covers at lot grain. It is a parameter
rather than a literal so a revised threshold can be added as a new effective-dated entry rather than a new
implementation version.

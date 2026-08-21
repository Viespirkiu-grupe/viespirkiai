# LT-COM-03 — Konsultuotas ar kviestas tik vienas tiekėjas (only one supplier invited or consulted)

Source: STT corruption-risk analyses (STT-I02, "only one supplier consulted or invited") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md) —
[stt.md](../../../../docs/indicators-story/indicators/stt.md).

Unit of analysis is the **procurement**, not the lot — one row per `pirkimoNumeris`, rolling up every lot of its ATN-1
report(s) into a single subject. `totalSuppliers` counts every distinct supplier recorded anywhere in the procurement,
**whether or not their bid was later rejected**, and regardless of which lot they bid on.

## Where to look

| File             | Question it answers                                                                     |
|-------------------|-------------------------------------------------------------------------------------------|
| `collect.sql`     | What is true about each procurement — the distinct-supplier count, method, when reported  |
| `parameters.ts`   | What it compares against, and since when                                                  |
| `definition.ts`   | Identity, lifecycle, public wording — pure metadata, no behaviour                          |
| `decision.ts`     | What the facts mean — the state, the threshold that decided it, the evidence — plus the `AProcurementIndicatorDecision` wiring, with `static decide()` as its judgement method (replaces `rules.ts`) |
| `test/`           | How we know it works                                                                      |

Inside `test/`, `fixtures.ts` states both the source rows and the fact row `collect.sql` must produce from them;
`decision.test.ts` decides those fact rows with no database, and `collect.it.ts` proves the statement really produces
them against a real PostgreSQL. Everything else — identity fields, parameter resolution, `not_applicable` when no entry
applies — belongs to `ARiskIndicatorDecision`/`AProcurementIndicatorDecision` and is tested once in `test/risk/procurementLotDecision.test.ts`.

## How this differs from LT-COM-01 and LT-COM-02

All three read `public.v_dalyviai` and share the `insufficient_data` reasoning (unmatched procurement, an empty
report), but they differ in grain and in what they measure:

- **LT-COM-01** ("single valid bid") and **LT-COM-02** ("low number of bidders") both judge one **lot** at a time —
  a multi-lot procurement produces one fact row (and one decision) per lot.
- **LT-COM-03** judges the **whole procurement** — every lot's participants are unioned into one distinct-supplier
  count before the threshold is applied. A supplier that bid on two lots of the same procurement is counted once, not
  twice (`test/fixtures.ts`'s `sameSupplierAcrossTwoLots`), and a procurement where lot 1 drew one supplier and lot 2
  drew a different one is **not** a single-supplier procurement even though neither lot alone reached two
  (`differentSuppliersAcrossTwoLots`). Real data confirms the union matters: procurement `cvpis:3265470` has the same
  supplier (`305575214`) bidding on both of its two lots, and correctly rolls up to `totalSuppliers: 1` (see
  "Real-data sanity run" below).
- The threshold itself is also stricter and differently framed: `minimumSuppliers: 2` (trigger only when a
  procurement drew **at most one** distinct supplier in total) versus LT-COM-02's `minimumBidders: 3` per lot. STT-I02
  names exactly one supplier as the flagged case, not "few" suppliers, so LT-COM-03 is a narrower, rarer signal than
  LT-COM-02, and a procurement can trigger LT-COM-02 on some lots without ever triggering LT-COM-03, or vice versa —
  that non-overlap is expected, the same way LT-COM-01 and LT-COM-02 coexist.

## Open question: method scope

`parameters.ts` ships with `scope: {}` (applies to every `pirkimoBudas`) as a v1 placeholder, following LT-COM-01 and
LT-COM-02's precedent for the same unresolved question.

STT-I02 is conceptually about procedures where the buyer chooses **whom to approach** — negotiated procedures (with
or without prior publication), restricted competitions, and low-value survey ("apklausa") procurements — not about
open competitions, which by design admit any interested supplier rather than inviting or consulting specific ones.
Narrowing the scope to those methods, once the `pirkimoBudas` vocabulary the ATN-1 relational pipeline actually
produces for them is confirmed, is the honest way to make "invited or consulted" mean what the catalogue says; a
subject outside every scope then becomes `not_applicable` rather than a suppressed or mislabelled trigger.

That narrowing is deferred for two reasons:

1. **Current ATN-1 relational data has zero coverage of those methods.** Every one of the 443 reports currently in
   `atn1ataskaitos` (and so every subject `collect.sql` can produce) has `pirkimoBudas = 'Atviras konkursas'` — see
   "Real-data sanity run" below. Scoping today would make every current subject `not_applicable`, telling us nothing
   about whether the scope itself is correct.
2. **The exact vocabulary needs confirming against real ingested rows, not inferred from a different pipeline.** The
   historical JSON archive `public."cvppAtaskaitos".turinys->>'pirkimoBudas'` (a much larger, older ATN-1 scrape not
   wired into any canonical view) shows the relevant labels are `Skelbiamos derybos`, `Derybos be išankstinio
   skelbimo`, `Ribotas konkursas`, and `Konkurencinis dialogas` — distinct from
   [`modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`](../../../viesiejiPirkimai/viesiejiPirkimaiEnums.js)'s
   `PIRKIMO_BUDAS` map, which is the CVP IS *notice* vocabulary, not the ATN-1 *report* vocabulary. Low-value
   "apklausa" (survey) procurements are outside ATN-1's scope entirely — they are statutorily exempt from the
   procedure-completion report this indicator's data source depends on — so "invited or consulted" for that method
   is not reachable through `v_dalyviai` at all, regardless of scoping. Confirm the split once
   `atn1ataskaitos.pirkimoBudas` itself starts recording non-open procedures, then append a scoped entry.

Until then this version stays `lifecycle: 'shadow'`.

## Threshold

`minimumSuppliers: 2` triggers when a procurement drew **fewer than two** distinct suppliers in total — i.e. exactly
one, since zero is `insufficient_data` (an empty report, not a competition with no suppliers). This is the smallest
integer that captures STT-I02's own framing ("only one supplier"), rather than a broader "few suppliers" signal — that
broader signal is what LT-COM-02 already covers at lot grain. It is a parameter rather than a literal because a
reviewer may later decide the line belongs elsewhere for a particular scope — that argument should be a new
effective-dated entry, not a new implementation version.

## v2 architecture note: subject universe now comes from the Procurement Reader

As of the [v2 architecture](../../../../docs/indicators-story/risk-service-architecture-v2.md) port, this
indicator's subject universe is exactly the procurements the Procurement Reader loads from `v_pirkimas` —
not, as before, every distinct `pirkimoNumeris` `collect.sql` itself could find in ATN-1 data via a
`LEFT JOIN`. The ~0.5% of subjects below with "no matching procurement" (2 of 403) no longer appear at all
(not even as `insufficient_data`): a `pirkimoNumeris` with no `v_pirkimas` row is not a Procurement Reader
subject to begin with. A real-data run after the port should show **≈401**, not 403, subjects — this is the
expected, documented consequence of the Reader owning the subject universe, not a regression.

## Real-data sanity run

Read-only run of `collect.sql` against the real database, cutoff **2026-08-14T11:01:45Z** (`data_as_of` = query time):

| Metric                                          | Value                                                                                 |
|--------------------------------------------------|----------------------------------------------------------------------------------------|
| Subjects evaluated (procurements)                | 403 — the 425 distinct `pirkimoNumeris` in `atn1ataskaitos`, minus 22 whose ATN-1 report has no `atn1dalyviai` row at all and so never reach `v_dalyviai` (an `INNER JOIN` inside the view) |
| `triggered`                                      | 102 (25.3%)                                                                             |
| `not_triggered`                                  | 293 (72.7%)                                                                             |
| `insufficient_data` (no matching procurement)    | 2 (0.5%)                                                                                |
| `insufficient_data` (participant row with a null supplier code) | 6 (1.5%)                                                                |
| `pirkimoBudas` distribution across all 425 reports | 100% `Atviras konkursas` — **zero** negotiated, restricted, or dialogue procedures currently ingested (see "Open question: method scope") |
| Query time                                       | ~63s for the full subject universe (403 rows). Same order of magnitude as LT-COM-02's ~77s over 1,272 lot-grain rows; the cost is `v_pirkimas`'s CVPP-fallback join, not this indicator's own aggregation. |

25.3% is a real, non-degenerate trigger rate — not a 0%/100% design smell — but it is worth reading carefully: because
every currently-ingested report is an open competition, today's triggers are procurements where only one supplier
*chose* to bid in an open call, not procurements where the buyer *chose* to approach only one supplier. Both are
captured by the same STT-I02 label in the unscoped v1, and only the second is really what "invited or consulted"
describes — see "Open question: method scope".

Spot-checked three triggered subjects against `public.v_dalyviai` directly:

- `cvpis:3265470` — the same supplier (`305575214`) bid on both of the procurement's two lots
  (`daliesNumeris` 1 and 2). Rolls up correctly to `totalSuppliers: 1`, confirming the cross-lot union works on real
  multi-lot data, not just fixtures.
- `cvpis:3469739` — a single lot, single supplier (`133140587`). `totalSuppliers: 1` as expected.
- `cvpis:3632300` — a single lot, single supplier (`1108683314`). `totalSuppliers: 1` as expected.

Kept `lifecycle: 'shadow'` — the method-scope question above is unresolved, and every current subject shares the one
method (`Atviras konkursas`) that scoping would most affect, so the sanity numbers cannot yet distinguish "the buyer
invited only one supplier" from "only one supplier answered an open call."

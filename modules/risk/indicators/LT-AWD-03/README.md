# LT-AWD-03 — Nepakankamai pagrįstas atmetimas (poorly supported disqualification)

Source: OCP Red Flags in Public Procurement 2024 (OCP-R037, "Poorly supported disqualifications") and the STT
catalogue (STT-I14, "Bid rejected on weak or inconsistent grounds") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md). `LT-AWD-01`'s and `LT-AWD-02's`
own `limitationLt` text both point here for "was the disqualification itself legitimate".

Unit of analysis is the **lot** — one row per `(pirkimoNumeris, daliesNumeris)`. Like `LT-AWD-02`, this reads the
per-bid array (`Lot.bids`) rather than the aggregate `LotParticipation` counts `LT-AWD-01`/`LT-COM-01`/`LT-COM-02`
use.

## Where to look

| File            | Question it answers                                                                              |
|-----------------|----------------------------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the `weakLegalBases` parameter list                                 |
| `decision.ts`   | The `ALotIndicatorDecision` subclass whose `assessRisk()` judges the subject                      |
| `test/`         | How we know it works                                                                               |

`Lot.bids` comes from `modules/risk/procurementReader.ts`'s `LOT_BIDS_SQL`, itself reading `public.v_dalyviai_v2`.
`test/fixtures.ts` states the expected `Bid` shapes; `decision.test.ts` decides those fixtures with no database.

## Data source: a new structured legal-basis field

The ATN-1/PPA procedure report's rejected-bids sheet (`xlsxPPAatmestiPasiulymai`) carries two independent
dictionary-backed fields for a rejection: `atmetimoPriezastysId` (free-text-shaped — 1,918 distinct values
nationwide, already exposed as `atmetimoPriezastis` and used by `LT-COM-01`/`LT-AWD-01`/`LT-AWD-02` as the
"was this bid disqualified at all" test) and `atmetimoTeisinisPagrindasId` — a genuinely small, closed dictionary
(23 distinct values nationwide) of the statutory ground cited for the rejection, e.g. "VPĮ 45 str. 1 d. 5 p.". This
second field was not previously exposed anywhere in the risk service — it is the "smallest addition" this
indicator needed (Phase 1 of the implementation plan).

**New column added**: `atmetimoTeisinisPagrindas` on `modules/mcp/analyst/views/v_dalyviai.sql` and its `_v2` copy
(same `LEFT JOIN xlsxPPAatmetimoTeisiniaiPagrindai` pattern already used for `atmetimoPriezastis`/`atmetimoStatusas`
in the same LATERAL subquery), on the `Bid` type (`types.ts`), and on `LOT_BIDS_SQL`/its row mapping in
`procurementReader.ts`. The test schema (`migrations/risk/test/001_public_test_tables.sql`) gained the
`xlsxPPAatmetimoTeisiniaiPagrindai` lookup table and the `atmetimoTeisinisPagrindasId` column, and
`xlsxPPAFixtures.ts`'s `insertAtmestasPasiulymas()` gained an optional `teisinisPagrindas` parameter.

## Formula

Among the lot's bids, a bid is **disqualified** when `atmetimoPriezastis IS NOT NULL` — the same test
`LT-COM-01`/`LT-AWD-01`/`LT-AWD-02` already use. A disqualified bid is **poorly supported** when its
`atmetimoTeisinisPagrindas` is null (no legal basis recorded at all) or equals one of the `weakLegalBases` — the
dictionary's own generic "Other" catch-all ("Kita"/"kita") or its unfilled dropdown-placeholder text. The lot
triggers if **any** disqualified bid in it is poorly supported — a single disqualification issued without a
specific legal ground is itself the event this indicator flags, regardless of how any other bid in the lot was
handled.

## Data coverage (measured 2026-08 against the real warehouse)

Of 12,564 rejected-bid rows nationwide, 9,348 (74.4%) carry a legal-basis value; restricted to rows whose
`statusasId` marks an actual buyer-initiated rejection (as opposed to a self-withdrawal or "candidate not invited"),
coverage rises to ~98%. At lot grain: 4,808 lots nationwide have at least one disqualified bid with a legal-basis
join reachable through this formula, and 443 of those (9.2%) have at least one poorly-supported disqualification —
a non-trivial but far-from-universal rate. A random sample of the poorly-supported cases was read by hand: every
one was a genuine rejection whose structured legal-basis field was left at "Kita" or empty, not a query artefact.
Re-run the throwaway Phase 6 script (see the plan template) if this measurement needs refreshing.

## Eligibility and required data

Reuses the shared Lot Eligibility Decision (parent lot → parent procurement: `cvpis` + `pirkimoBudas` present) — no
lot-specific eligibility rule exists yet. `hasRequiredData()` requires `Lot.participation !== null` (an ATN-1 report
was observed for this lot at all), the same test `LT-AWD-01`/`LT-AWD-02` use. Distinct from that: a lot with
participation but zero per-bid rows (every participant's `tiekejoKodas` was null) is `insufficient_data` with
`missingData: ["atmetimoPriezastis"]`, handled inside `assessRisk()` — the same split `LT-AWD-02` already makes
between the eligibility-gate case and the "report exists but the per-bid array is empty" case.

## Known limitation

`atmetimoTeisinisPagrindas` is a separate, structured (dropdown) field from the free-text `atmetimoPriezastis` a
buyer also fills in. Sampling the "Kita" rows by hand found several where the free-text reason *does* cite a
specific VPĮ/KSPĮ article, but the buyer nonetheless left the structured dropdown at "Kita" — a data-entry
inconsistency in the source report, not evidence the disqualification itself lacked a legal ground. The
`limitationLt` text states this: the indicator can only say the buyer's own report didn't *formally record* a
specific legal basis, not that no legal basis existed. It also does not judge whether a cited legal basis actually
fits the rejection's stated facts (the "inconsistent grounds" half of STT-I14) — only whether a basis was cited at
all.

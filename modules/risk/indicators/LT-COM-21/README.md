# LT-COM-21 — Netikėtai neišsamus ar nepajėgaus tiekėjo pasiūlymas (non-genuine, incomplete, or incapable bid)

Source: OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update (OECD-BR-13, "Usually capable
bidder submits an unexpectedly incomplete or erroneous bid"; OECD-BR-16, "Bids lack expected detail or otherwise
appear non-genuine"; OECD-BR-46, "Bid is submitted by a company incapable of performing the contract") in the
[canonical catalogue](../../../../docs/indicators-story/indicators-canonical.md). The catalogue row also cites
OECD-BR-32 and OECD-BR-38 — see "Scope" below for why those two are not covered.

Unit of analysis is the **bid** — one row per `(pirkimoNumeris, daliesNumeris, tiekejoKodas)`, the same `bid`
`SubjectType` `LT-COM-20` introduced.

## Where to look

| File            | Question it answers                                                          |
|-----------------|--------------------------------------------------------------------------------|
| `definition.ts` | Identity, public wording, and the `nonGenuineIncompleteIncapableLegalBases` parameter list |
| `decision.ts`   | The `ABidIndicatorDecision` subclass whose `assessRisk()` judges the subject |
| `test/`         | How we know it works                                                        |

`Bid` (`tiekejoKodas`/`atmetimoPriezastis`/`atmetimoStatusas`/`atmetimoTeisinisPagrindas`) comes from
`modules/risk/procurementReader.ts`'s bid-grain query, merged onto `Lot.bids` before `decision.ts` runs.
`test/fixtures.ts` states the expected `Bid` shape for each scenario; `decision.test.ts` decides those fixtures with
no database.

## Data source

Reuses `atmetimoTeisinisPagrindas` — the ATN-1/PPA procedure report's structured (dropdown) legal-basis citation for
a rejection (`xlsxPPAatmestiPasiulymai.atmetimoTeisinisPagrindasId` → `xlsxPPAatmetimoTeisiniaiPagrindai.pavadinimas`,
e.g. `"VPĮ 45 str. 1 d. 1 p."`), first exposed for `LT-AWD-03`. No new view/reader work was needed: the column is
already on `public.v_dalyviai_v2`, `Bid` (`types.ts`), and `LOT_BIDS_SQL`/its row mapping in `procurementReader.ts`.

Lietuvos Respublikos viešųjų pirkimų įstatymo (VPĮ) 45 straipsnio 1 dalis lists the grounds a proposal is rejected
on. The three points this indicator matches:

- **1 p.** — the bid does not conform to the tender documents' own requirements (non-genuine/incomplete bid).
- **3 p.** — the bidder does not meet the qualification requirements (incapable bidder).
- **4 p.** — the bidder failed to clarify, supplement, or explain requested documents within the deadline (also read
  as incomplete — the bidder's own follow-through, not just its original submission).

Deliberately excluded: **2 p.** (a supplier-exclusion ground — criminal/tax/conflict-of-interest, a different risk
concept entirely) and **5 p.** (price too high/unacceptable — `LT-PRI-*` territory, not non-genuineness).

## Data coverage (measured 2026-08-31 against the real warehouse)

Of 8,978 disqualified bid rows nationwide (`atmetimoPriezastysId` present), 3,479 (38.8%) cite one of the three
target legal-basis points — 2,168 distinct lots, 2,952 distinct bids. A random sample of rows under each of the
three points was read by hand: 1 p. rows were genuine non-conformity ("Pasiūlymas neatitinka pirkimo dokumentuose
nustatytų reikalavimų", "Neatitiko pirkimo dokumentų techninės specifikacijos..."), 3 p. rows were genuine
qualification failures ("Neatitinka kvalifikacinių reikalavimų"), and 4 p. rows were genuine clarification failures
("Tiekėjas per perkančiosios organizacijos nustatytą terminą nepatikslino savo pasiūlymo") — with one 4 p. sample
row about an unjustified abnormally-low price, a data-entry edge case rather than a query artefact (see
"Limitation" below). At bid grain (approximated directly against the real warehouse, since the `_v2` views this
indicator's own reader query depends on are not populated in any environment reachable while implementing this) the
state distribution across ~31k observed bids nationwide was roughly 8.6% `triggered`, 79.5% `not_triggered`, 10.5%
`insufficient_data` — a non-trivial but far-from-universal rate, consistent with the concept being a specific
failure mode rather than the default outcome.

## Eligibility and required data

Reuses the shared Lot Eligibility Decision (parent lot → parent procurement: `cvpis` + `pirkimoBudas` present) — no
bid-specific eligibility rule exists yet. `hasRequiredData()` mirrors `LT-COM-20`: requires the ATN-1 report's own
offer-detail join to have found *some* outcome for this bidder — a price ranking (`eileNumeris`), a rejection status
(`atmetimoStatusas`), or a rejection reason (`atmetimoPriezastis`). A bidder listed as a participant but with none of
those is `insufficient_data`, not `not_triggered`.

## Formula

A bid triggers when it was disqualified (`atmetimoPriezastis IS NOT NULL`) **and** its `atmetimoTeisinisPagrindas`
is one of `nonGenuineIncompleteIncapableLegalBases`. A disqualified bid whose legal-basis field is null or cites a
different point (price, exclusion) is `not_triggered` — including the case `LT-AWD-03` covers (disqualified with no
legal basis recorded at all, or a generic "Kita"): that is a *poorly-supported* disqualification, a different
catalogue concept, not evidence this one applies.

## Scope

OECD-BR-32 ("only one bidder contacts wholesalers for pricing before submission") and OECD-BR-38 ("statement
indicating cover bidding") are cited by the catalogue row but not implemented: neither is observable from the ATN-1
procedure report — the first needs pre-submission market-intelligence behaviour never captured in any ingested
source, the second needs a bidder's own verbatim statement, which is `LT-COM-23`'s territory ("Bidder statements
indicate collusion") and already marked "Cannot implement" there for the identical reason (no such text is captured).
This indicator covers the "incomplete/incapable" half of the catalogue concept (OECD-BR-13/16/46) that the
structured legal-basis field can actually evidence.

## Known limitation

Same as `LT-AWD-03`: `atmetimoTeisinisPagrindas` is the buyer's own structured (dropdown) selection, filled in
alongside the free-text `atmetimoPriezastis`. A buyer who disqualifies a bid for non-conformity but leaves the
dropdown at "Kita" or empty will not be caught here — that is `LT-AWD-03`'s concept, not this one. Conversely, a
handful of 4 p. rows in the source data describe an unjustified abnormally-low price rather than an unclarified
qualification document — a data-entry inconsistency in how buyers use the dropdown, not this indicator misreading a
genuine ground. Disqualification for non-conformity, weak qualification, or a lapsed clarification deadline can also
have an entirely legitimate cause; the indicator is a review prompt, not evidence of a non-genuine bid on its own.

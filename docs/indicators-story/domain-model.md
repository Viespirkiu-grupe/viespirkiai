# Domain model

Both the MCP analyst and Procurement Risk Service (Risk Indicators) use domain model that aggregates data table to the
logical stable model.

## Entity-relationship diagram

```mermaid
erDiagram
    v_pirkimas {
        text saltinis PK "cvpis or cvpp"
        text pirkimoNumeris PK
        text pavadinimas
        text jarKodas FK "buyer org code"
        text organizatorius
        text pirkimoBudas
        text statusas
        numeric numatomaVerteEUR
        date paskelbimoData
    }

    v_pirkimo_dalis {
        text subjektoRaktas PK "saltinis:pirkimoNumeris:daliesNumeris"
        text saltinis
        text pirkimoNumeris FK
        text daliesNumeris
        text daliesPavadinimas
        text pirkimoBudas
        date ataskaitosData
    }

    v_dalyviai {
        text pirkimoNumeris FK
        text daliesNumeris FK
        text pirkejoKodas FK "buyer"
        text tiekejoKodas FK "bidder"
        text tiekejas
        numeric pasiulymoKaina
        text atmetimoPriezastis
        boolean interesuKonfliktasNustatytas
    }

    v_company {
        text jarKodas PK
        text pavadinimas
        text adresas
        text statusoPavadinimas
        numeric darbuotojai
        boolean melagingisTiekejas
        boolean nepatikimasTiekejas
        integer vdiPazeidimuSkaicius
        integer bylosSkaicius
        integer domenaiSkaicius
        integer neskelbiamosDerybosSkaicius
    }

    v_sutartys {
        text sutartiesUnikalusId PK
        text sutartiesNumeris
        text pirkimoNumeris FK
        text pirkejoKodas FK "buyer"
        text tiekejoKodas FK "primary supplier"
        text_array tiekejaiKodai "primary + additional suppliers"
        numeric suma
        numeric faktineIvykdimoVerte
        date sudarymoData
        boolean istrinta
    }

    v_bylos {
        integer bylosId PK
        text bylosNumeris
        text bylosRusis
        text jarKodas FK
        text dalyvioVardasIrPavarde
        text bylojeKaip
    }

    v_person_links {
        integer id PK
        text vardas
        text pavarde
        text jarKodas FK
        text pareigos
        text rysioPobudzioPavadinimas
        boolean dalyvaujaViesuosePirkimuose
    }

    v_pirkimas ||--o{ v_pirkimo_dalis: "pirkimoNumeris = pirkimoNumeris (value match, no FK)"
    v_pirkimo_dalis ||--o{ v_dalyviai: "pirkimoNumeris + daliesNumeris"
    v_pirkimas ||--o{ v_dalyviai: "pirkimoNumeris = pirkimoNumeris (value match, no FK)"
    v_pirkimas ||--o{ v_sutartys: "pirkimoNumeris = pirkimoNumeris (value match, no FK)"
    v_company ||--o{ v_pirkimas: "jarKodas = buyer org code"
    v_company ||--o{ v_dalyviai: "jarKodas = tiekejoKodas (bidder)"
    v_company ||--o{ v_sutartys: "jarKodas = tiekejoKodas (supplier)"
    v_company ||--o{ v_sutartys: "jarKodas = pirkejoKodas (buyer)"
    v_company ||--o{ v_bylos: "jarKodas (court case party)"
    v_company ||--o{ v_person_links: "jarKodas (linked legal entity)"
```

None of these relationships are enforced foreign keys — every one is a text-value match evaluated at query time (see
`docs/indicators-story/procurement-number-clarification.md` for the `v_pirkimas` ↔ `v_pirkimo_dalis` ↔
`v_dalyviai` case specifically). That's exactly why coverage matters: a match can legitimately fail, and the table below
is how large those gaps actually are.

## Row counts per entity

| Entity            |        Rows | Notes                                                                                                                                                         |
|-------------------|------------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `v_pirkimas`      |     264,332 | 50,810 from `cvpis` (primary scrape) + 213,522 from `cvpp` (fallback, no matching `cvpis` row)                                                                |
| `v_pirkimo_dalis` | 13,396 lots | Across 5,464 distinct procurements. 13,238 lots resolve to `cvpis`, 44 to `cvpp`, 114 to neither (`saltinis` unresolved)                                      |
| `v_dalyviai`      |      36,793 | One row per (procurement, lot, bidder)                                                                                                                        |
| `v_company`       |     547,298 | = row count of `jarAsmenys`; `v_company` is a pure `LEFT JOIN` enrichment, so this is every legal entity in the registry, not just ones active in procurement |
| `v_sutartys`      |   5,904,634 | 5,902,689 not marked `istrinta` (deleted)                                                                                                                     |
| `v_bylos`         |   2,422,300 | One row per (court case, party)                                                                                                                               |
| `v_person_links`  |     546,639 | PINREG declared relationships                                                                                                                                 |

## Relationship coverage (the gaps)

| Relationship                                          |                                                                                                                    Coverage | Reading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `v_pirkimas` → `v_pirkimo_dalis`                      |                                                                                     **5,464 / 264,332 procurements (2.1%)** | Lot data only exists for procurements that have a PPA XLSX report (`xlsxPPAataskaitos`/`xlsxPPAdalyviai`, "Pirkimo procedūrų ataskaita") on file. `v_pirkimo_dalis` is built by grouping `v_dalyviai`, sourced from that XLSX ingestion; `daliesPavadinimas` (the lot's own name) is enriched separately, from `atn1ataskaitos`/`atn1pirkimoDalys`. The other 97.9% of procurements have no known lot breakdown at all — unmeasured, not "1 lot". Of the 5,464 covered, 3,788 turned out to have exactly 1 lot and 1,677 had 2+ (up to dozens).                                                               |
| `v_pirkimo_dalis` → `v_dalyviai`                      |                                                                                                    **100% by construction** | Every lot is derived directly from grouping `v_dalyviai`, so this direction can't have gaps — the question is really "how many bidder-rows per lot": 36,793 rows / 13,396 lots ≈ 2.7 avg.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `v_dalyviai` → `v_pirkimas`                           |                                           **36,374 / 36,793 rows (98.9%)**; **5,414 / 5,464 distinct procurements (99.1%)** | Almost every PPA-XLSX-derived lot resolves back to a known procurement notice. The ~1–2% that don't are the `insufficient_data` cases documented in `procurement-number-clarification.md`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `v_pirkimas` → `v_sutartys`                           | **372,387 / 5,904,634 contract rows (6.3%)**; **88.5% of contracts have a NULL `pirkimoNumeris` entirely** (5,223,286 rows) | Only 307,239 distinct `pirkimoNumeris` values appear across all contracts. Broken down by `tipas` (full table in [Problem 3](#high-problem-3-missing-v_sutartyspirkimonumeris) below): `MVPŽ` and `MVP` — legally exempt from CVP IS, verbal/low-value contracts — account for 78.2% and 16.5% of the NULLs respectively (94.7% combined). `TSP` and `PPS`, the two types legally required to have a number, account for only 3.6% of the NULLs (~186,000 rows), and 68.4%/55.8% of their own rows are in fact populated. That ~186,000-row slice, not the 88.5% headline rate, is the real data-quality gap. |
| `v_company` → `v_dalyviai` (`tiekejoKodas`)           |                                                **34,875 / 36,793 rows (94.8%)**; **3,554 / 4,044 distinct bidders (87.9%)** | 873 rows (2.4%) have no supplier code at all; the rest that fail to match are codes not found in the company registry (foreign suppliers, natural persons, data-entry variants).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `v_company` → `v_sutartys` (`pirkejoKodas`, buyer)    |                                                                                      **5,874,080 / 5,904,634 rows (99.5%)** | Buyer-side identification is nearly complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `v_company` → `v_sutartys` (`tiekejoKodas`, supplier) |                                                                                      **5,271,364 / 5,904,634 rows (89.3%)** | Supplier-side is weaker than buyer-side — ~10.7% of contracts name a supplier code that isn't in the registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `v_company` → `v_bylos`                               |                                                                                      **2,286,489 / 2,422,300 rows (94.4%)** | Most court-case parties resolve to a known legal entity; the remainder are presumably natural persons or codes outside the registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `v_company` → `v_person_links`                        |                     **523,520 / 546,639 rows (95.8%)**; of the 533,581 rows that carry a company code at all, 98.1% resolve | 2.4% of PINREG relationship rows have no company code recorded in the first place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Data Problems

### (low) Problem 1: `v_company` enrichment coverage (of 547,298 companies)

These are the risk-relevant flags/counters on `v_company` — most are sparse, which matters when using them as indicator
inputs.

| Field                                                       | Companies with data |  Share |
|-------------------------------------------------------------|--------------------:|-------:|
| Sodra payroll data (`darbuotojai` / `vidutinisAtlyginimas`) |             164,050 |  30.0% |
| Own ≥1 domain (`domenaiSkaicius > 0`)                       |              43,602 |   8.0% |
| Flagged `nepatikimasTiekejas` (unreliable supplier)         |                 154 |  0.03% |
| Flagged `melagingisTiekejas` (false-info supplier)          |                 198 |  0.04% |
| Involved in `neskelbiamosDerybos` (unpublished negotiation) |                 232 |  0.04% |
| `vdiPazeidimuSkaicius > 0` (labour-inspection violations)   |                  20 | 0.004% |

The VDI and blacklist figures in particular are thin: they say more about how much of that source has been ingested than
about the true prevalence of violations in the supplier base, so treat low counts there as a coverage limit, not a clean
bill of health.

> RESPONSE: Not a bug — this is a hard ceiling on the source data, not something ingestion can fix. One concrete
> takeaway: `domenaiSkaicius` should not be used as a risk-indicator input. DOMREG
> doesn't expose the domain owner's `jarKodas` directly — resolving a domain to a company means matching through the
> fields DOMREG does provide up to the legal entity, which isn't reliable enough for the resulting count to stand as a
> signal on its own.

### (high) Problem 1: Dirty pirkimoNumeris

Every table/view with a `pirkimoNumeris` column was queried live (`10.1.10.2:9118`, `viespirkiai`, 2026-08-17) for
values that don't match `^[0-9]+$` — i.e. not a plain positive integer. "Dirty" below is measured against **non-NULL**
values only (NULLs are a separate, much larger gap already covered in
[Relationship coverage](#relationship-coverage-the-gaps)). `cvppPirkimai.pirkimoNumeris` is a real `integer` column and
is excluded — it can't be dirty by construction.

| Table                                                   | Non-null rows |   Dirty |   % dirty | Examples                                                                                                                                                                                                                          |
|---------------------------------------------------------|--------------:|--------:|----------:|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `vpmSutartys` (= `v_sutartys`, passthrough)             |       681,349 | 138,637 | **20.4%** | `'Žodinė sutartis'` (7,496), `'-'` (2,058), `'žodinė sutartis'` (1,648), `'sutartis žodinė'` (491), `'ŽODINĖ SUTARTIS'` (364), `'žodžiu'` (352), `'žodinė'` (341), `'+'` (339) — verbal-contract sentinels, not malformed numbers |
| `nepatikimiTiekejai`                                    |           219 |      54 | **24.7%** | `''` empty string (33), `'CPO314092-21524-1'`, `'CPO266294'`, `'701969+542538'` (`+`-joined multi-procurement refs)                                                                                                               |
| `melagingiTiekejaiPagrindimai`                          |            40 |       6 | **15.0%** | `'110749+355857'`, `'6295090+6297813'`, `'7981318+7980273'`, `'110749-355856'`                                                                                                                                                    |
| `nepatikimiTiekejaiPagrindimai`                         |           221 |      21 |  **9.5%** | `'CPO353717'`, `'CPO314092-21524-1'`, `'701969+542538'`                                                                                                                                                                           |
| `melagingiTiekejai`                                     |           219 |       4 |  **1.8%** | `'174484+693640'`, `'110749+355856'`, `'110749-355856'`                                                                                                                                                                           |
| `v_dalyviai` (from `xlsxPPAataskaitos`, per bidder-row) |        36,714 |     154 | **0.42%** | `'Nr.1174796'` (78), `'Pirkimo procedūrų ataskaita'` (10), `'1,218,908'` (9, Excel thousands separator), `'ID 693110'` (8), `'ID  \t5115453'` (6, stray tab)                                                                      |
| `xlsxPPAataskaitos` (per report-row)                    |         6,560 |      22 | **0.34%** | same patterns as `v_dalyviai`, one row per report instead of per bidder                                                                                                                                                           |
| `cvppAtaskaitos`                                        |       104,008 |       0 |        0% | —                                                                                                                                                                                                                                 |
| `cvppViesiejiPirkimai`                                  |       257,535 |       0 |        0% | declared `text`, but every non-null value is currently a clean 6-digit number — this is the table `v_pirkimas` casts `viesiejiPirkimai."pirkimoId"` to `text` against for `UNION ALL`                                             |

> RESPONSE: Essentially unsolvable from the source data alone. Also worth internalizing: a value
> matching `^[0-9]+$` is not proof it's a real procurement number either — e.g.
> `https://viespirkiai.org/?pirkimoNumeris=123`
> resolves to nothing meaningful. The same procurement numbers repeat across both source systems (cvpis/cvpp), which is
> itself a matching opportunity. And the mess goes beyond the dirty-value scan above — real `pirkimoNumeris` values seen
> in the wild include free text like `„Parengti ir atlikti koncertinę programą"`, `„Įrašykite arba įkelkite kopijuotus
> duomenis naudoj"`, `„Kietasis kompiuterio diskas"`, and `„Užvenčio kultūros centras"` — someone pasted the wrong field
> into `pirkimoNumeris`. The only thing consistently guaranteed across all of it is that it fits in `varchar(50)`.
>
> Proposed direction: rather than chasing one canonical clean number, build a normalized matching table that carries a
> confidence/quality score per match. The matching logic already exists in the FE — this would mean porting it into SQL.
> Quality will legitimately vary row to row, and that's expected, not a defect to fix away — beyond a certain point you
> can't out-engineer the Public Procurement Office's own data quality.

### (high) Problem 3: Missing v_sutartys.pirkimoNumeris

| tipas                                                               |      rows |      NULL |      % NULL | Pirkimo numeris privalomas?                                                                                                                                 |
|---------------------------------------------------------------------|----------:|----------:|------------:|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| MVPŽ — Mažos vertės pirkimas (žodinė sutartis)                      | 4,281,331 | 4,082,227 |       95.3% | **Ne** — low-value, verbal; legally exempt from CVP IS                                                                                                      |
| MVP — Mažos vertės pirkimas                                         |   998,503 |   861,643 |       86.3% | **Ne** — low-value; CVP IS use is optional, buyer's choice (explains the ~14% that do have one)                                                             |
| PPS — Pagrindinė pirkimo sutartis (preliminariosios/DPS pagrindu)   |   308,965 |   136,442 | (!!!) 44.2% | **Taip** — the framework/DPS itself is a formal CVP IS procedure; missing values here are a real data gap, not an exemption                                 |
| TSP — Tarptautinis arba supaprastintas pirkimas                     |   157,173 |    49,678 | (!!!) 31.6% | **Taip** — formal procedure, always run through CVP IS; the 31.6% missing is a genuine gap                                                                  |
| SP — Sutarties pakeitimas                                           |   129,967 |    65,738 |       50.6% | **Paveldi iš pirminės sutarties** — amendments follow the same "filled only if CVP IS" rule as their parent contract, no independent number                 |
| Ilgalaikė MVPŽ — Ilgalaikis mažos vertės pirkimas (žodinė sutartis) |    21,752 |    21,520 |       98.9% | **Ne** — same exemption as MVPŽ                                                                                                                             |
| SPŽ — Supaprastintas pirkimas (žodinė sutartis)                     |     3,754 |     3,691 |       98.3% | **Ne** — verbal, same CVP IS-optional exemption                                                                                                             |
| ŽS — Žodinė sutartis                                                |     2,599 |     1,805 |       69.4% | **Ne** — verbal contract                                                                                                                                    |
| VS — Vidaus sandoris                                                |       499 |       478 |       95.8% | **Ne** — VPĮ Art. 10 exemption; the contract itself must still be published in CVP IS, but no competitive procedure (and thus no procurement number) exists |
| PSĮ — Pirkimas iš susijusios įmonės                                 |        79 |        57 |       72.2% | **Ne** — related-party exemption, same structure as `VS`                                                                                                    |
| Nenurodyta (type not set)                                           |        17 |        12 |       70.6% | — (no type recorded)                                                                                                                                        |
| KSS                                                                 |         1 |         0 |        0.0% | — (not in `CONTRACT_TYPES`/`vpmSutartysTipai` dictionary, 1 row, unclassified)                                                                              |

The genuine gap is `TSP` and `PPS` — both are *required* to run through CVP IS and get a number, yet 31.6% and 44.2% are
missing one respectively; that's ~186,000 rows worth investigating as an actual data-quality problem rather than an
expected absence.

> RESPONSE (superseded, see below): the original response here framed this as depending on Problem 1's
> dirty-string/fuzzy-matching work. That framing doesn't hold up: these rows aren't dirty strings, they're real SQL
> `NULL`s (confirmed against `modules/sutartys/parsePage.js:270-279` — `pirkimoNumeris` is only ever set when the CVP
> IS contract page has a table row labeled "Pirkimo numeris"; there's no default, so an absent row on the source page
> leaves the field `undefined` → `NULL`). There is no raw value to normalize. See the investigation below for what was
> actually tested and found.

**Root cause, verified against live data:** this is a historical gap in the CVP IS source pages, not scattered per-row
noise. Breaking the NULLs down by `sudarymoData` year:

| Years     | PPS NULL rate | TSP NULL rate |
|-----------|--------------:|--------------:|
| 2015–2019 |       90–100% |       90–100% |
| 2020–2026 |        26–37% |         7–15% |

Something changed in the source (or the scraper) around 2019/2020 — CVP IS began actually carrying the "Pirkimo numeris"
row for most PPS/TSP contract pages from that point on. The bulk of the ~186,000 missing rows are pre-2020 legacy
records; the field's presence is a property of *when* the contract was scraped, not something broken per-row.

**Recovery actually tested, not just proposed:** the natural next question — can these be reconstructed by matching the
contract to a procurement notice on other fields (buyer code, title, date), the way `v_pirkimo_dalis` already does fuzzy
resolution elsewhere — was tested directly against the live database rather than assumed:

- Exact `jarKodas` + exact `pavadinimas` match against the primary procurement table (`viesiejiPirkimai`):
  **1,456 of 186,188 rows recovered (0.8%)** (787 PPS, 669 TSP).
- Relaxed to `jarKodas` + "procurement `paskelbimoData` within 2 years before contract `sudarymoData`" (title ignored):
  only 1,436 rows get a *unique* candidate; **~12,484 become ambiguous** (the same buyer published multiple notices in
  that window, so there's no way to pick one without more information); and **~172,000 rows (92%) have zero candidate
  procurement notice from that buyer in the primary table at all** — nothing to match against, unique or ambiguous.
- The `cvpp` fallback table (`cvppViesiejiPirkimai`) contributes **zero** additional matches — it carries no buyer code
  to join on directly, and matching by buyer name text + title found nothing.

The dominant number is the 92% with no candidate at all: for the great majority of these rows the procurement notice
itself was never ingested/published in a linkable form, not that a matching algorithm is too strict to find it. A
confidence-scored matching table (as proposed for Problem 1) would recover well under 1% of this gap — it is not a
meaningful mitigation for Problem 3, and the NULL rate should be reported as a real, largely-unrecoverable data-quality
gap in pre-2020 CVP IS records rather than something blocked on future matching infrastructure.

## Mitigations

Traced against the actual view definitions (`modules/mcp/analyst/views/*.sql`) and the domain-ownership pipeline
(`modules/domenai/`), to separate what's fixable at the SQL/view level from what's a genuine ceiling on the source data.

### Dirty / unmatched `pirkimoNumeris` (Problems 1 and 3)

Root cause: `v_dalyviai.sql:5` passes `xlsxPPAataskaitos."pirkimoNumeris"` straight through with no cleaning, and
`v_sutartys.sql:4` does the same for `vpmSutartys."pirkimoNumeris"` — that's where both the free-text garbage
(`'Nr.1174796'`, `'ID 693110'`, `'1,218,908'`) and the verbal-contract sentinels (`'Žodinė sutartis'`, `'-'`, `'+'`)
enter. `v_pirkimo_dalis.sql:31` already validates `pirkimoNumeris ~ '^[0-9]+$'` before trusting it for `saltinis`
resolution — dirty values fall through to `saltinis = NULL` (the 114 "unresolved" rows) — so there's existing precedent
in this codebase for "validate, don't blindly join."

**Cheap, view-level (no new infra):**

- Add a normalized derived column in `v_dalyviai`/`v_pirkimo_dalis` — `regexp_replace` to strip `Nr.`/`ID ` prefixes,
  stray whitespace/tabs, and Excel thousands-separator commas (`^\d{1,3}(,\d{3})+$` → digits only). Recovers roughly 101
  of the 154 dirty `v_dalyviai` rows without touching any matching logic.
- In `v_sutartys`, map the known verbal-contract sentinel strings to real `NULL` via a `CASE`. This doesn't recover
  data, but it makes the Problem 3 NULL-rate honest — right now "missing" conflates true `NULL` with strings that were
  never a number — and stops those sentinels from being silently compared against `v_pirkimas.pirkimoNumeris`.

**Harder, structural fix:** a side table of `(raw_value, saltinis, candidate_pirkimoNumeris, confidence, method)`,
populated by porting the FE's existing matching logic into SQL/a batch job, with views doing a `LEFT JOIN` against it
instead of raw string equality. Multi-ref values (`'701969+542538'`) need to fan out into multiple rows, which a plain
view can't express — this needs a materialized table, refreshed like other ingestion tasks in `tasks/`. This is a real
fix for Problem 1's dirty *strings*, where a raw value exists to normalize and match.

**It does not meaningfully fix Problem 3.** That gap is real `NULL`, not a dirty string — there's nothing to normalize.
Reconstructing it means matching a contract to a procurement notice on *other* fields (buyer, title, date), which was
tested directly against the live database rather than left as a hypothesis: exact buyer+title match recovers 0.8%
(1,456/186,188); a looser buyer+date-proximity match still leaves 92% of rows with zero candidate procurement notice to
match against at all, because most of the gap is pre-2020 CVP IS pages that never carried the field.
See [Problem 3](#high-problem-3-missing-v_sutartyspirkimonumeris) above for the full breakdown. Treat this ~186,000-row
gap as a largely permanent ceiling on the source data, not a matching-infrastructure backlog item.

### `v_company.domenaiSkaicius` reliability (low-priority Problem 1)

Traced the pipeline: `v_company.sql:44-46` counts `domenai` rows where `savininkoKodas = jarKodas`. `savininkoKodas`
is populated by `modules/domenai/rastiSavininkuKodus.js:35`, which calls `findSingleJuridinis(savininkas)`
(`modules/juridiniai/search.js:140`) — a Typesense name search over the free-text DOMREG registrant name, ranked by
Levenshtein distance, accepted only if `distance ≤ similarityThreshold` (default **1**). This confirms DOMREG genuinely
doesn't hand back a `jarKodas` — this is already a best-effort fuzzy name match, not a lookup, matching the
"reikia matchinti pagal ten privestas pievas iki juridinio" response above.

**Cheap fix:** `findSingleJuridinis` computes `distance` (`search.js:174`) and then discards it — only pass/fail is
persisted (`rastiSavininkuKodus.js:36`). Persisting that distance alongside `savininkoKodas` (e.g. a new
`domenai."savininkoKodasAtstumas"` column) would let `v_company` expose a quality-gated `domenaiSkaicius` — e.g.
"count only where distance = 0 (exact name match)" — turning the current blanket advice ("don't use this field")
into "usable if filtered to high-confidence matches." It won't make the field denser — DOMREG names will still be
abbreviated/misspelled — but it stops good matches from being lumped in with bad ones.

### Summary

| Problem                                                                 | Mitigable?                   | Effort                                                   |
|-------------------------------------------------------------------------|------------------------------|----------------------------------------------------------|
| `v_dalyviai`/`v_pirkimo_dalis` dirty values (`Nr.`, `ID`, commas, tabs) | Yes                          | Low — regex cleanup in the view                          |
| `v_sutartys` verbal-contract sentinels counted as "dirty"               | Yes (clarity, not recovery)  | Low — `CASE` → `NULL` in the view                        |
| Multi-ref (`+`/`-`-joined) `pirkimoNumeris` values                      | Partially                    | High — needs a real matching table, not a plain view     |
| Problem 3's TSP/PPS genuine gap                                         | No — tested, <1% recoverable | Not worth pursuing; source-data ceiling, mostly pre-2020 |
| `domenaiSkaicius` reliability                                           | Partially                    | Low — persist the already-computed Levenshtein distance  |
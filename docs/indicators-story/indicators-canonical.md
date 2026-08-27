# Canonical Lithuanian catalogue

Status: draft

A flag is a reason to review a procurement, not proof of fraud, corruption, or illegality.

This document is the single definition of **what** the 106 canonical `LT-*` indicators are, **which subject** each one
decides about, and **which Risk Decision Service** evaluates it. The service that runs them is specified in
[`risk-service-architecture-v2.md`](risk-service-architecture-v2.md); the entities they read are specified in
[`domain-model.md`](domain-model.md). No indicator list is maintained anywhere else.

## 1. Reference-code prefixes

| Prefix                           | Source                                                     |
|----------------------------------|------------------------------------------------------------|
| `OCP-R`                          | [OCP indicators](indicators/ocp.md)                        |
| `OLAF-CN`, `OLAF-CA`             | [OLAF-supported Red Flags indicators](indicators/olaf.md)  |
| `OT-I`                           | [OpenTender indicators](indicators/opentender.md)          |
| `STT-I`                          | [STT indicators](indicators/stt.md)                        |
| `VPT-I`                          | [VPT indicators](indicators/vpt.md)                        |
| `ARACHNE-CAP`, `ARACHNE-LEG`     | [ARACHNE+ public documentation](indicators/arachne.md)     |
| `OECD-GOV`, `OECD-TD`, `OECD-BR` | [OECD procurement integrity framework](indicators/oecd.md) |

Mapping semantics: a reference may be an exact equivalent, a narrower/broader metric, or local supporting evidence. The
canonical row is the concept to implement; source formulas must not be combined blindly. `—` means no direct reference
among the seven scoped catalogues, so the indicator is a Lithuanian catalogue gap/proposal requiring a separate legal or
methodological basis.

`ARACHNE-CAP` references identify publicly documented ARACHNE+ capabilities, not individual members of the unpublished
78-indicator register. `ARACHNE-LEG` references are publicly named legacy indicators whose retention in ARACHNE+ is not
publicly confirmed. They provide supporting provenance and must not be implemented as current ARACHNE+ formulas.

Coverage rule: every coded OCP, OLAF-supported Red Flags, OpenTender, STT, and VPT entry, every `OECD-BR` warning sign,
and every publicly named `ARACHNE-LEG` indicator is represented by at least one canonical row. `OECD-GOV`, `OECD-TD`,
and `ARACHNE-CAP` entries describe principles, controls, or broad capabilities rather than one-to-one executable flags;
they are referenced only where they directly support a canonical concept. ARACHNE legacy categories are taxonomy labels
and are not canonical indicators.

## 2. Evaluation subjects

### 2.1 What a primary evaluation subject is

**Primary evaluation subject** is the entity whose risk state the rule decides, not every entity used as input. It
therefore also determines the natural 360° page on which the signal should be shown:

| Evaluation subject                  | Natural placement                                                                         |
|-------------------------------------|-------------------------------------------------------------------------------------------|
| Procurement, lot                    | Procurement page; a lot signal rolls up to its procurement                                |
| Bid / bidder participation          | Procurement page, attached to the participant/proposal                                    |
| Contract                            | Contract page; also link it from the originating procurement                              |
| Supplier company, buyer institution | Company page for that legal entity                                                        |
| Buyer–supplier relationship         | Both companies' relationship view; optionally roll up to related procurements             |
| Bidder group / relationship         | Procurement relationship view and each involved company's 360° view                       |
| Market / category portfolio         | Analytical/market view; only show on a company or procurement page as contextual evidence |

A portfolio indicator may read many procurements but still decide a state about a company or relationship. Conversely,
company facts such as sanctions can be evidence for a procurement-specific decision without changing the primary
subject. Where a rule is calculated at lot grain, the durable subject key must include both procurement and lot
identifiers.

### 2.2 Subject register

Each stored subject type resolves to exactly one entity of the [domain model](domain-model.md), and that entity — never
a warehouse table — is what an indicator is specified against. Live database snapshot: **2026-08-18**; counts are
`count(*)`, not planner estimates.

| Domain Model Entity       |  Subjects | Canonical LT-* indicators | Identity                                             | Decision Service                 | Subject type                  |
|---------------------------|----------:|--------------------------:|------------------------------------------------------|----------------------------------|-------------------------------|
| `v_pirkimas`              |   264,415 |                        28 | `saltinis` + `pirkimoNumeris`                        | Procurement Risk                 | `procurement`                 |
| `v_pirkimo_dalis`         |    48,564 |                        17 | `subjektoRaktas`                                     | Procurement Risk                 | `lot`                         |
| `v_dalyviai`              |    36,793 |                        11 | `pirkimoNumeris` + `daliesNumeris` + `tiekejoKodas`  | Procurement Risk                 | `bid`                         |
| `v_sutartys`              | 5,906,258 |                        17 | `sutartiesUnikalusId`, not deleted                   | Contract Risk                    | `contract`                    |
| `v_company` as supplier   |    80,479 |                        10 | `jarKodas` that has supplied under a contract or bid | Company Risk                     | `supplier`                    |
| `v_company` as buyer      |     6,103 |                         3 | `jarKodas` that has purchased under a contract       | Company Risk                     | `buyer`                       |
| `v_pirkejo_tiekejo_rysys` | 1,090,112 |                         5 | `rysioRaktas`                                        | Buyer–Supplier Relationship Risk | `buyer_supplier_relationship` |
| `v_dalyviu_pora`          |    19,989 |                        12 | `porosRaktas`, order-independent                     | Bidder Relationship Risk         | `bidder_relationship`         |
| `v_rinka`                 |        45 |                         3 | `rinkosRaktas` (BVPŽ division)                       | Market Risk                      | `market`                      |
| **Total**                 |           |                   **106** |                                                      | 6 services                       | 9 subject types               |

`procurement_source` and `procurement_id` are optional context/navigation keys, not part of the subject's identity. A
supplier sanction is one company-level result that may be shown as context on many procurements; duplicating it as a
separate procurement decision would distort counts and history.

Storage constraint: `SubjectType` in `modules/risk/types.ts` and the `risk_signals_subject_type_check` constraint in
`migrations/risk/001_risk.sql` today admit only `procurement`, `lot`, `contract`, and `supplier`. The remaining five
subject types must be added there before their indicators can be stored.

### 2.3 Procurement lifecycle in the domain model

Entities, not tables. Solid arrows are the sequence a purchase moves through; dashed arrows are links the sources do not
enforce and that can legitimately fail to resolve.

```mermaid
flowchart LR
    PR(["Pirkėjas"])
    TK(["Tiekėjas"])
    PL["Pirkimo planas"]
    P["Pirkimas"]
    SK["Skelbimas"]
    D["Pirkimo dalis"]
    B["Dalyvis"]
    S["Sutartis"]
    R["Pirkėjo–tiekėjo ryšys"]
    PO["Dalyvių pora"]
    PR -->|" plans "| PL
    PL -.->|" no key: matched on buyer, object, period "| P
    PR -->|" publishes "| P
    P -->|" advertised through "| SK
    P -->|" split into 1..n "| D
    TK -->|" submits a proposal "| B
    B -->|" competes in "| D
    B -.->|" co-bids with "| PO
    D -->|" awarded, producing 1..n "| S
    S -.->|" links back by procurement number "| P
    S -->|" performed by "| TK
    S -.->|" summarised into "| R
```

The two dashed links out of `Pirkimas` are the model's weak points and the reason `insufficient_data` exists as an
outcome: a plan carries no procurement number at all, and a contract's procurement number is free text that resolves
only 6.1% of the time even among contracts legally obliged to carry one. Both are measured in
[`domain-model.md`](domain-model.md).

## 3. Risk Decision Services

### 3.1 Service register

| Decision Service                 | Business object root      | Subject types evaluated       | Indicators | Evidence entities read                                                                                                |
|----------------------------------|---------------------------|-------------------------------|-----------:|-----------------------------------------------------------------------------------------------------------------------|
| Procurement Risk                 | `v_pirkimas`              | `procurement`, `lot`, `bid`   |     **56** | `v_skelbimas`, `v_pirkimo_planas`, `v_dokumentas`, `v_vertinimo_kriterijai`, `v_proceduros_pabaiga`, `v_company`      |
| Contract Risk                    | `v_sutartys`              | `contract`                    |     **17** | `v_sutarties_pakeitimas`, `v_mokejimai`, `v_subranga`, `v_pirkimas`, `v_company`                                      |
| Company Risk                     | `v_company`               | `supplier`, `buyer`           |     **13** | `v_imones_finansai`, `v_bylos`, `v_person_links`, `v_valdymas`, `v_dalyviai`, `v_sutartys`, `v_pirkejo_tiekejo_rysys` |
| Bidder Relationship Risk         | `v_dalyviu_pora`          | `bidder_relationship`         |     **12** | `v_dalyviai`, `v_valdymas`, `v_person_links`, `v_company`                                                             |
| Buyer–Supplier Relationship Risk | `v_pirkejo_tiekejo_rysys` | `buyer_supplier_relationship` |      **5** | `v_sutartys`, `v_pirkimas`, `v_company`                                                                               |
| Market Risk                      | `v_rinka`                 | `market`                      |      **3** | `v_pirkimas`, `v_pirkimo_dalis`, `v_dalyviai`, `v_sutartys`                                                           |
| **Total**                        |                           | 9                             |    **106** |                                                                                                                       |

## 4. Indicators by primary evaluation subject

Sections are ordered by Decision Service, then by subject type within the service. The **Canonical category** column
carries the taxonomy the catalogue was originally grouped by; totals per category are reconciled in
[§5](#5-coverage-matrix).

### 4.1 Procurement Risk Decision Service (56)

#### Subject `procurement` — Procurement (28)

| Code      | Canonical indicator                                   | Canonical category | Reference indicators                                                                                                                                           | Note             |
|-----------|-------------------------------------------------------|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------|
| LT-COM-03 | Only one supplier invited or consulted                | Competition        | STT-I02                                                                                                                                                        | Accepted         |
| LT-COM-18 | Procurement object has elevated cartel risk           | Competition        | OLAF-CN05                                                                                                                                                      | Cannot implement |
| LT-OTH-01 | No documented market research                         | Other              | STT-I01; OECD-TD-01                                                                                                                                            | Cannot implement |
| LT-OTH-03 | Evaluation/decision period anomalously short or long  | Other              | OCP-R015; OCP-R061; OCP-R062; OLAF-CA08; OT-I05; VPT-I10                                                                                                       | Accepted         |
| LT-OTH-04 | Award-to-signature period unusually long              | Other              | OCP-R060                                                                                                                                                       | Accepted         |
| LT-OTH-05 | Procedure unsuccessful or award not contracted        | Other              | OLAF-CA05; OLAF-CA06; OLAF-CA07; VPT-I11                                                                                                                       | Accepted         |
| LT-OTH-06 | Strategic-policy objective not applied where relevant | Other              | VPT-I02; VPT-I03; VPT-I04; VPT-I05; OECD-GOV-04                                                                                                                | Cannot implement |
| LT-PRI-05 | High estimated value                                  | Pricing            | OLAF-CN06                                                                                                                                                      | Accepted         |
| LT-PRI-06 | High estimated framework value                        | Pricing            | OLAF-CN04                                                                                                                                                      | Accepted         |
| LT-PRO-01 | Unjustified non-competitive procedure                 | Procedure design   | OCP-R010; OLAF-CN23; OT-I03; STT-I08; VPT-I15                                                                                                                  | Accepted         |
| LT-PRO-02 | Direct award contrary to procurement plan             | Procedure design   | OCP-R012                                                                                                                                                       | Cannot implement |
| LT-PRO-04 | Procedure without prior publication                   | Procedure design   | OLAF-CA01; OT-I02                                                                                                                                              | Cannot implement |
| LT-PRO-05 | Accelerated procedure without adequate grounds        | Procedure design   | OLAF-CN22                                                                                                                                                      | Accepted         |
| LT-PRO-08 | Short submission/advertisement period                 | Procedure design   | OCP-R003; OCP-R014; OLAF-CN29; OT-I04                                                                                                                          | Accepted         |
| LT-PRO-09 | Unreasonable prequalification requirements            | Procedure design   | OCP-R006; OLAF-CN10; OLAF-CN11; OLAF-CN12; OLAF-CN14; OLAF-CN15; OLAF-CN16; OLAF-CN17; OLAF-CN18; OLAF-CN19; OLAF-CN20; OLAF-CN21; STT-I05; OT-I10; OECD-TD-02 | Cannot implement |
| LT-PRO-10 | Tailored or restrictive technical specifications      | Procedure design   | OCP-R007; OLAF-CN20; STT-I04; OT-I10; OECD-TD-03                                                                                                               | Cannot implement |
| LT-PRO-11 | Unreasonable participation or document fees           | Procedure design   | OCP-R008; OCP-R009                                                                                                                                             | Cannot implement |
| LT-PRO-12 | Excessive tender guarantee                            | Procedure design   | OLAF-CN31                                                                                                                                                      | Cannot implement |
| LT-PRO-13 | Low predefined number of candidates                   | Procedure design   | OLAF-CN24                                                                                                                                                      | Cannot implement |
| LT-PRO-14 | Missing method for reducing candidate numbers         | Procedure design   | OLAF-CN25                                                                                                                                                      | Cannot implement |
| LT-TRA-01 | Planning documents unavailable                        | Transparency       | OCP-R001; VPT-I09; OECD-GOV-01                                                                                                                                 | Cannot implement |
| LT-TRA-02 | Tender insufficiently advertised                      | Transparency       | OCP-R004; OLAF-CN30; OT-I02                                                                                                                                    | Cannot implement |
| LT-TRA-03 | Key tender information/documents unavailable          | Transparency       | OCP-R005; STT-I15                                                                                                                                              | Cannot implement |
| LT-TRA-05 | Bidder questions unanswered                           | Transparency       | OCP-R039                                                                                                                                                       | Cannot implement |
| LT-TRA-06 | Procurement decision or reason not documented         | Transparency       | STT-I15; OLAF-CA06                                                                                                                                             | Accepted         |
| LT-TRA-07 | Complaint received                                    | Transparency       | OCP-R020; VPT-I13; OECD-GOV-11                                                                                                                                 | Accepted         |
| LT-TRA-08 | Procurement challenged in court                       | Transparency       | VPT-I14                                                                                                                                                        |                  |
| LT-TRA-09 | Procurement not conducted electronically              | Transparency       | VPT-I06; OECD-GOV-07                                                                                                                                           |                  |

#### Subject `lot` — Lot (17)

| Code      | Canonical indicator                                           | Canonical category | Reference indicators                                       |
|-----------|---------------------------------------------------------------|--------------------|------------------------------------------------------------|
| LT-AWD-01 | All bids except winner disqualified                           | Award              | OCP-R035; OT-I11                                           |
| LT-AWD-02 | Lowest bid disqualified                                       | Award              | OCP-R036                                                   |
| LT-AWD-03 | Poorly supported disqualification                             | Award              | OCP-R037; STT-I14                                          |
| LT-AWD-04 | Excessive share of disqualified bids                          | Award              | OCP-R038                                                   |
| LT-AWD-07 | Evaluation criteria excessively discretionary                 | Award              | OCP-R021; STT-I13                                          |
| LT-AWD-08 | Award criteria or scoring method incomplete                   | Award              | OLAF-CN26; OLAF-CN27; OLAF-CN28; OT-I10                    |
| LT-COM-01 | Single valid bid                                              | Competition        | OCP-R018; OLAF-CA02; OT-I01; STT-I03; VPT-I01              |
| LT-COM-02 | Low number of bidders                                         | Competition        | OCP-R019; OLAF-CN01; OLAF-CN02; OLAF-CA02; VPT-I12         |
| LT-COM-07 | Missing expected bidder                                       | Competition        | OCP-R027; OECD-BR-03                                       |
| LT-COM-10 | Identical bid prices                                          | Competition        | OCP-R028; OECD-BR-24                                       |
| LT-COM-11 | Fixed-multiple bid prices                                     | Competition        | OCP-R023; OECD-BR-25                                       |
| LT-COM-12 | Suspiciously close bid prices                                 | Competition        | OCP-R024; OECD-BR-26                                       |
| LT-COM-13 | Wide disparity in bid prices                                  | Competition        | OCP-R022; OECD-BR-26                                       |
| LT-PRI-01 | Estimated value anomalous against market benchmark            | Pricing            | OCP-R016; OLAF-CN07; STT-I10                               |
| LT-PRI-03 | Winning price close to or above estimate                      | Pricing            | OCP-R031; OLAF-CN13; OECD-BR-28                            |
| LT-PRI-08 | Bid prices deviate from Benford's Law                         | Pricing            | OCP-R029; OT-I07                                           |
| LT-PRI-10 | Bid-price or discount movements inconsistent with competition | Pricing            | OECD-BR-20; OECD-BR-21; OECD-BR-22; OECD-BR-23; OECD-BR-29 |

#### Subject `bid` — Bid / bidder participation (11)

| Code      | Canonical indicator                                     | Canonical category | Reference indicators                                                                                       | Note             |
|-----------|---------------------------------------------------------|--------------------|------------------------------------------------------------------------------------------------------------|------------------|
| LT-AWD-05 | Late bid accepted and won                               | Award              | OCP-R030                                                                                                   | Cannot implement |
| LT-AWD-06 | Winner does not meet award criteria                     | Award              | OCP-R056                                                                                                   | Cannot implement |
| LT-COM-16 | Similar bid documents                                   | Competition        | OCP-R041; OECD-BR-09; OECD-BR-10; OECD-BR-12; OECD-BR-14; OECD-BR-15; OECD-BR-39                           | Cannot implement |
| LT-COM-17 | Bids submitted in suspiciously repeated order           | Competition        | OCP-R034; OECD-BR-18                                                                                       | Cannot implement |
| LT-COM-20 | Unexpected or frequent bid withdrawal                   | Competition        | OECD-BR-04                                                                                                 | Accepted         |
| LT-COM-21 | Non-genuine, incomplete, or incapable bid               | Competition        | OECD-BR-13; OECD-BR-16; OECD-BR-32; OECD-BR-38; OECD-BR-46                                                 | Accepted         |
| LT-COM-23 | Bidder statements indicate collusion                    | Competition        | OECD-BR-33; OECD-BR-34; OECD-BR-35; OECD-BR-36; OECD-BR-37; OECD-BR-38; OECD-BR-39; OECD-BR-40; OECD-BR-41 | Cannot implement |
| LT-PRI-02 | Line-item price anomalously high or low                 | Pricing            | OCP-R017                                                                                                   | Cannot implement |
| LT-PRI-09 | Heavily discounted bid                                  | Pricing            | OCP-R058                                                                                                   | Accepted         |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract | Pricing            | OECD-BR-27                                                                                                 | Accepted         |
| LT-PRI-12 | Anomalous geographic delivery or transport pricing      | Pricing            | OECD-BR-30; OECD-BR-31                                                                                     | Cannot implement |

#### Cannot Implement Explanations

**LT-AWD-05** — Late bid accepted and won: not implementable with currently ingested data. The only per-bid data source
is the PPA procedure report (`v_dalyviai_v2`, backed by `xlsxPPAdalyviai` / `xlsxPPApasiulymuEile` /
`xlsxPPAatmestiPasiulymai`), and none of its columns carry a bid-level submission timestamp — only `ataskaitosData`
(report creation date, procurement-grain). Without a submission-time signal there is nothing to compare against the
tender deadline, so the indicator would only ever produce `insufficient_data`. Revisit if a data source carrying bid
submission timestamps is ever ingested.

**LT-AWD-06** — Winner does not meet award criteria: not implementable with currently ingested data. The planned
`v_vertinimo_kriterijai` entity (backed by `xlsxPPAvertinimoKriterijai`) captures the award-criteria *definitions*
applied to a lot, not a per-bidder compliance verdict against them. No ingested source records whether the winning bid
actually satisfied each criterion — `v_dalyviai` only carries the resulting rank (`eileNumeris`) and, for rejected bids,
a free-text rejection reason. Without a compliance-verdict signal the indicator would only ever produce
`insufficient_data`. Revisit if a source carrying per-criterion compliance assessments is ever ingested.

**LT-COM-16** — Similar bid documents: not implementable with currently ingested data. Every document table in the
warehouse — `viesiejiPirkimaiFailai`, `cvppFailai`, `vpmSutartysFailai`, and the planned `v_dokumentas` — is keyed to a
procurement or a contract, never to a bidder; they hold documents the buyer publishes (notices, tender dossiers, signed
contracts), not the technical or financial proposals individual bidders submit. There is no per-bidder submission to
compare for textual, formatting, or metadata similarity. Revisit if bidder-submitted proposal documents are ever
ingested with a bidder attribution.

**LT-COM-17** — Bids submitted in suspiciously repeated order: not implementable with currently ingested data, for the
same underlying reason as LT-AWD-05. `v_dalyviai."eileNumeris"` (sourced from `xlsxPPApasiulymuEile`, "queue of
proposals") is the post-evaluation price/score ranking used to infer the winner, not the chronological order in which
bids were submitted or opened. No source carries a bid submission timestamp or sequence number, so a "repeated
submission order" pattern cannot be distinguished from a "repeated final ranking" pattern with the data available.
Revisit alongside LT-AWD-05 if submission-order data is ever ingested.

**LT-COM-18** — Procurement object has elevated cartel risk: not implementable with currently ingested data. The
procurement's CPV codes (`v_pirkimas."bvpzKodai"`, 99.9% populated on the primary `cvpis` source) are available, but
`OLAF-CN05`'s source booklet (the OLAF-supported *"Red Flags" – a New Automatic Warning System*, p. 9, item I.6)
names this only as a summary-list title, "Object of public procurement (cartel risk)", with no operational definition,
threshold, or list of cartel-prone product categories in the booklet itself — the underlying Hungarian methodology
paper it references is not included and, being built from Hungary's own TED cartel-case history, would not transfer
to Lithuania regardless. No table in the warehouse records Lithuanian cartel or bid-rigging case history by CPV
division (`\dt` for `kartel`/`konkurenc`/`cartel`/`competition` finds nothing), so there is no data-grounded way to
classify which CPV divisions carry elevated cartel risk for the Lithuanian market specifically. Hand-picking sectors
from general international literature (construction, waste management, catering, etc.) would be an unsourced,
un-auditable judgment call disguised as a formula, not a reflection of the catalogue concept. Revisit if a Lithuanian
Competition Council (Konkurencijos taryba) cartel/bid-rigging case dataset, coded to CPV or a comparable sector
classification, is ever ingested.

**LT-COM-23** — Bidder statements indicate collusion: not implementable with currently ingested data. The only
report-level fields that resemble a collusion signal — `konkurencijaIskreipiantisAsmuo` and `konkurencijosPriemones`
on `xlsxPPAataskaitos` — record whether the buyer ran pre-tender market consultations and what came of them (606 of
6,583 reports flag one; sampled `konkurencijosPriemones` values describe market research and consultations, not bidder
conduct), not statements made by bidders during the procedure. No source captures bidder correspondence, minutes, or
testimony. Revisit if a source carrying bidder statements or procedural minutes is ever ingested.

**LT-OTH-01** — No documented market research: not implementable with currently ingested data. No table in the
warehouse records whether, or how, a buyer researched the market before starting a procurement. The only report-level
fields that come close — `xlsxPPAataskaitos."konkurencijaIskreipiantisAsmuo"`/`"konkurencijosPriemones"` — record
whether the buyer identified a competition-distorting economic operator among those who helped prepare the tender
(5,177 of 6,583 reports carry a non-null flag, 606 true) and what measures were taken about it, not whether market
research preceded the procurement; `planuojamiPirkimaiDuomenys` (the planning-document entity) carries a price
estimate and a free-text `aprasymas`, but no market-research field either. The remaining candidates —
`pirkimoBudoPagrindimas` (procurement-method justification) and `kitaInformacija` — are unstructured free text a
buyer may or may not use to mention market research, so testing for it would mean pattern-matching prose for an
unbounded vocabulary rather than reading a structured fact, the kind of fragile-regex approach Phase 1 of the
implementation plan warns against. Revisit if a structured "preliminary market consultation" field is ever ingested
(e.g. a future PPA report revision, or a CVP IS notice field mirroring TED's prior-market-consultation indicator).

**LT-OTH-06** — Strategic-policy objective not applied where relevant: not implementable with currently ingested
data. The only structured self-reported flags for these objectives — `xlsxPPAsutartys."centralizuotasPirkimas"` /
`"zaliasisPirkimas"` / `"inovatyvusProduktas"` and `xlsxPPAvertinimoKriterijai."vertinimoKriterijus"`, all sourced
from the Atn-1 procedure report (`xlsxPPAataskaitos`, 6,583 of 264,415 procurements, ~2.5%) — record only whether a
policy was self-reported as *applied*, never whether it was *relevant* to the specific procurement, and the
catalogue concept is precisely the gap between the two. No table in the warehouse carries the Lithuanian reference
data that would establish relevance independently of self-report — e.g. the government's mandatory-centralized-
purchasing product list or the environment ministry's green-procurement product-group list — so "relevant" cannot be
derived from CPV code or object description either. Sampling also shows the self-report flag is not a discriminating
signal even on its own terms: `"zaliasisPirkimas"` is `true` for 9,583 of 9,725 non-null rows (98.5%) across
unrelated objects — a bridge reconstruction, an echoscope, health-insurance services, a forklift rental, a car
purchase all read `true` — which rules it out as an audit signal before the relevance question is even reached.
Hand-picking CPV categories as "where relevant" from general literature would be the same unsourced, un-auditable
judgment call the LT-COM-18 explanation above rejects. Revisit if a Lithuanian reference dataset establishing which
categories each objective (green/innovative/quality/centralized) applies to is ever ingested.

**LT-PRI-02** — Line-item price anomalously high or low: not implementable with currently ingested data.
`v_dalyviai."pasiulymoKaina"` is a single total bid price per (procurement, lot, bidder); no ingested source breaks a
bid down into its constituent line items or unit prices — no such table exists in the warehouse. Revisit if a
line-item/unit-price data source is ever ingested.

**LT-PRI-12** — Anomalous geographic delivery or transport pricing: not implementable with currently ingested data. No
ingested source records a delivery location, distance, or transport-cost component for a bid — `pasiulymoKaina` is one
undifferentiated total, and `v_company."adresas"` is the supplier's registered address, not a delivery site. Revisit if
delivery-location or transport-cost data is ever ingested.

**LT-PRO-02** — Direct award contrary to procurement plan: not implementable with currently ingested data. The
concept requires linking a specific procurement to the specific plan entry it fulfilled, then comparing the plan's
declared `pirkimoBudas` against the procedure the buyer actually ran. `v_pirkimo_planas` (`planuojamiPirkimai` +
`planuojamiPirkimaiDuomenys`) carries no procurement number — the plan register and the notice register are two
independent Public Procurement Office datasets that were never joined by key — so any link is a heuristic match over
buyer, CPV code and a time window, "with its own confidence" per [domain-model.md](domain-model.md) §5.2
(`v_pirkimo_planas` → `v_pirkimas`: "no key exists"). Sampling 20 real procurements and counting candidate plan rows
sharing the same buyer, an overlapping CPV code, and a loose ±3/12-month window around the notice date shows the
match is not resolvable to one row: candidate counts range from 0 (no plan found at all) to 109, with most non-zero
cases landing at 2–14 plausible candidates and no field left to break the tie. Loosening or tightening the window
does not fix this — it trades false negatives (0 candidates) for false positives (dozens of candidates), because
CPV codes on the plan are broad and a buyer with hundreds of planned purchases in a year has many candidates in any
reasonable window. `LT-PRO-01`'s implementation independently reached and documented the same conclusion about this
link (see its README's "only *published* negotiated procedures are visible" section) when it needed the plan's
`Neskelbiamos derybos` label for the same reason. Fabricating a single "most likely" match per procurement from an
ambiguous candidate set would be an unsourced, un-auditable judgment call, not a reflection of the catalogue concept.
Revisit if the Public Procurement Office ever publishes a key linking a plan entry to the procurement it became.

**LT-PRO-04** — Procedure without prior publication: not implementable with currently ingested data. The concept
needs to identify procurements actually run under a "negotiated without prior publication of a call for tenders"
legal basis (Lithuanian `Neskelbiamos derybos` / `Neskelbiama apklausa`), the sub-threshold or sole-source mechanism
that, by definition, does not produce the notice our `procurement` subject is built from. Checking every
`pirkimoBudas` dictionary actually populated on an executed or reported procurement in the warehouse confirms this
structurally, not just as a coverage gap: `viesiejiPirkimai."pirkimoBudas"` (the `cvpis` source, 50,893 rows with a
method — [domain-model.md](domain-model.md) §5.1) carries 15 distinct labels and every one of them is a *published*
("Skelbiama…"/"Atviras…"/"Ribotas…"/"Dinaminė…"/"Konkurencinis dialogas"/"Kvalifikacijos reikalavimų sistema")
procedure type — no "Neskelbiama…" label appears at all. The `cvpp` fallback (213,522 rows, the majority of
`v_pirkimas`) never carries `pirkimoBudas` at all (0%, per the same table), so it cannot help either way.
`xlsxPPApirkimoBudai` (the PPA procedure-report method dictionary behind `v_dalyviai`) has only four values —
`Skelbiamos derybos`, `Atviras konkursas`, `Ribotas konkursas`, `Atviras konkuras` — again all published types. The
only warehouse table that names an unpublished method at all is the plan register
(`planuojamiPirkimaiBudai`: `Neskelbiama apklausa` 24,830 rows, `Neskelbiamos derybos pagal VPĮ/GSPĮ` 2,026,
`Neskelbiamos derybos pagal PĮ/KĮ` 528, `Vidaus sandoriai` 17, `Pirkimai iš susijusių įmonių` 4), and that register
cannot be linked to the procurement it became with any confidence — see the `LT-PRO-02` explanation above for the
measured ambiguity of that same link. `LT-PRO-01`'s README independently reached the same conclusion about the
`cvpis` notice source for the same underlying reason ("only *published* negotiated procedures are visible"). Revisit
if a source recording unpublished/negotiated-without-publication procedures at procurement grain — not just planning
intent — is ever ingested.

**LT-PRO-09** — Unreasonable prequalification requirements: not implementable with currently ingested data. The
concept's natural evidence entity, `v_dokumentas` (domain-model.md §1.3/§4.3), is itself unimplemented — only its raw
warehouse sources are ingested (`dokumentai`, `viesiejiPirkimaiFailai`, `vpmSutartysFailai`, `cvppFailai`), and those
carry file *metadata* (filename, MIME type, page/word/character count), not the tender document's *content* — nothing
records what qualification thresholds a tender document actually sets. A schema-wide search 2026-08 for a column
matching any of the twelve OLAF-CN10–CN21 sub-concepts this canonical row bundles (`%kvalifikac%`, `%apyvart%`,
`%patirt%`, `%reikalav%`, `%kapital%`, `%finansin%`) found exactly one candidate:
`xlsxPPAataskaitos."pajamosReikalavimas"` (a boolean from the ATN-1 report's "V.–VI.2" section, notice field
"VI.2.1.") plus a free-text `"pajamosReikalavimasPriezastys"`. Measured against the real warehouse, this field is too
thin and too inconsistent to build a formula on: only 24 of 6,583 reports (0.36%) mark it `true`; of those, only one
carries any reason text at all, and that text names a market-consultation notice rather than stating a turnover or
capacity figure; meanwhile 25 of the 5,849 `false` rows carry non-empty reason text — a pairing that contradicts the
hypothesis that the text is "the justification for a `true` value", so even this one candidate's meaning cannot be
trusted at its current, sparse coverage. No other structured column anywhere in the schema records a qualification
requirement's actual content (minimum turnover, capital level, reference-value ratio, reference period, required
years of expert experience, geographic technical-capacity restriction, exclusion grounds). Extracting these from the
unstructured tender documents themselves would mean parsing free text for an open-ended vocabulary of numeric
thresholds — the same fragile, un-auditable approach the `LT-OTH-01` and `LT-COM-16` explanations above already
reject for the same underlying reason. Revisit if `v_dokumentas` is implemented with structured qualification-
requirement fields (not just file metadata), or if a source recording tender qualification criteria in structured
form is ever ingested.

**LT-PRO-10** — Tailored or restrictive technical specifications: not implementable with currently ingested data, for
the same underlying reason as `LT-PRO-09`. The concept needs the actual content of a tender's technical specification
— whether it names a specific brand/manufacturer/product without an "or equivalent" clause (the Article 42(4),
Directive 2014/24/EU concept OLAF-CN20/STT-I04/OT-I10 all point at), or otherwise sets requirements only one supplier
could meet. That content lives, if anywhere, in `v_dokumentas` (domain-model.md §1.3/§4.3, listed there as blocking
both `LT-PRO-09` and `LT-PRO-10`), which is itself unimplemented: only its raw warehouse sources are ingested
(`dokumentai`, `viesiejiPirkimaiFailai`, `vpmSutartysFailai`, `cvppFailai`), and every one of them carries file
*metadata* (filename, MIME type, page/word/character count, size, download link) — never the document's text. A
schema-wide search for a structured column recording specification content, brand restrictions, or an "equivalent"
clause (`%specifik%`, `%konkret%`, `%technin%`, `%lygiavert%`, `%zenkl%`, `%gamintoj%`) finds nothing usable: the one
`%zenkl%` hit (`cvppViesiejiPirkimai."zenkliukas"`) is a scraped-page UI icon flag, not a trademark field, and the
`%gamintoj%` hits are all in the unrelated vehicle registry (`regitra`). `v_vertinimo_kriterijai`
(`xlsxPPAvertinimoKriterijai."vertinimoKriterijus"`) is an award-criteria weighting label (price/quality mix), not
technical-spec content either. The only free-text notice fields that exist (`cvppPirkimai."aprasymas"`/`"turinysHtml"`,
`planuojamiPirkimaiDuomenys."aprasymas"`) are unstructured summary prose of the notice, not the specification
document, and building a formula on regex/NLP over open-ended prose is the same fragile, un-auditable approach the
`LT-OTH-01` and `LT-COM-16` explanations above already reject. Revisit if `v_dokumentas` is implemented with
structured technical-specification or brand-restriction fields (not just file metadata), or if a source recording
tender specification content in structured form is ever ingested.

**LT-PRO-11** — Unreasonable participation or document fees: not implementable — a legal/procurement-system mismatch
rather than a data gap. `OCP-R008`/`OCP-R009` (the World Bank OCP catalogue's "Unreasonable participation fees" and
"Buyer increases the cost of the bidding documents") target jurisdictions where bidders must pay to obtain tender
documents or to participate; Lithuania's CVP IS, the mandatory national e-procurement portal in force since ~2011,
provides free electronic access to tender documents and charges no participation fee, so the underlying real-world
event this indicator would detect essentially does not occur under the current legal regime. Confirming this is not
just an assumption: a schema-wide search of `dbSchema/*.sql` for `%mokest%` (fee/payment) finds no procurement-related
hit — the only matches are `darboVieta` (salary data) and `mokesciai` (a municipal tax-payment fact table), both
unrelated to tenders — and no `%dalyvavimo%` (participation) or document-cost column exists on `viesiejiPirkimai` or
any other procurement table; it carries only value/estimate fields (`numatomaVerteEUR`,
`numatomaBendraPirkimoVerte`), never a fee. The planned `v_dokumentas` entity (domain-model.md §1.3, also blocking
`LT-PRO-09`/`LT-PRO-10`) lists LT-PRO-11 among the indicators it would need to support, but even its own not-yet-fixed
attribute list proposes no fee/price field — the team has not identified a real value here to capture. Revisit only if
Lithuanian procurement law reintroduces paid tender-document access or participation fees, and a source records it.

**LT-PRO-12** — Excessive tender guarantee: not implementable with currently ingested data. Lithuanian procurement law
does allow a buyer to require a "pasiūlymo galiojimo užtikrinimas" (bid/tender security) as a guarantee that a
submitted bid stays valid, but no structured field anywhere in the warehouse records its amount or percentage. A
schema-wide search of `dbSchema/*.sql` for `%garantij%` (guarantee) returns zero hits across every procurement table,
and the only near-miss terms (`%uztikrinim%`/`%galiojimo%`) all name bid- or notice-*validity dates/periods* —
`viesiejiPirkimaiKeys."pasiulymoGaliojimoTerminasDienomisArbaMenesiais"` (bid validity period, days/months),
`viesiejiPirkimaiKeys."dpsGaliojimoDataIrLaikas"`/`"kvsGaliojimoDataIrLaikas"`, `cvppSkelbimai."galiojimoData"`,
and several contract-validity-date columns — never a guarantee sum. The ATN-1 procedure-report table
(`atn1ataskaitos`, the source behind `xlsxPPAataskaitos` in other indicators' documentation) carries no guarantee
field either; its full column list has no fee/guarantee-shaped entry. The only place a guarantee amount could live is
the actual tender-document text, i.e. the unimplemented `v_dokumentas` entity (raw file metadata only, no content —
see the `LT-PRO-09`/`LT-PRO-10` explanations above for why parsing that is not viable). Revisit if a tender-security
amount/percentage is ever ingested as a structured field, e.g. from a future PPA report revision or a parsed
tender-document field.

**LT-PRO-13** — Low predefined number of candidates: not implementable with currently ingested data. The concept
needs a buyer's pre-announced maximum number of candidates it will invite to bid after prequalification (a
restricted/negotiated-procedure feature). The procedure-type field itself is populated
(`viesiejiPirkimai."pirkimoBudas"`, e.g. "Ribotas konkursas"), so the gate is not the blocker — but no companion
numeric field exists anywhere in the schema for a pre-announced invite cap. A search across `viesiejiPirkimai*`,
`cvppViesiejiPirkimai`, `planuojamiPirkimai*`, `atn1*`, and `cvppDumpAtn1*` for `%kandidat%` (candidate),
`%kviec%`/`%kviest%` (invite), and `%maksimal%`/`%minimal%` (max/min) finds no such column. The closest-named tables,
`cvppDumpAtn1ContractedCandidates` and `cvppDumpAtn1RejectedCandidates`, are post-hoc per-candidate outcome records
(name, price/quality ratio, rejection reason) captured after the procedure ends, not a pre-announced cap set at
publication time. Revisit if a source recording the pre-announced maximum invited-candidate count is ever ingested.

**LT-PRO-14** — Missing method for reducing candidate numbers: not implementable with currently ingested data, for
the same root cause as `LT-PRO-13` — since no field records whether a buyer capped invited candidates at all, there
is nothing to check "did they publish a reduction method" against. No column anywhere stores objective
selection-method/criteria text for choosing among qualified candidates when a cap is exceeded either; the one
plausible-looking free-text field, `atn1dalyviai."atrinktoPasirinkomoPriezastys"` ("reason candidate was selected"),
lives in the post-award report, is per-candidate rather than a published pre-procedure method statement, and isn't
reliably populated for restricted-procedure selection methodology. Revisit alongside `LT-PRO-13` if both a candidate
cap and a published selection-method field are ever ingested.

**LT-TRA-01** — Planning documents unavailable: not implementable at `procurement` grain — blocked by the identical
root cause as `LT-PRO-02`. The concept needs to know, for a specific procurement, whether its buyer's planning
documents (procurement-plan entry, prior information notice) were published; that requires linking `v_pirkimas` to
its `v_pirkimo_planas` entry, and [domain-model.md](domain-model.md) §5.2 states plainly that "no key exists" —
"The plan register records no procurement number. Any link is a match over buyer, object and period, with its own
confidence." `LT-PRO-02`'s explanation above documents the measured ambiguity of that same heuristic match (0 to 109
candidate plan rows per procurement, no field to break the tie). A schema-wide search for a genuine FK-like field on
the notice side — `%plan%`, `%PIN%`, `%ankstesn%` (prior), `%preliminar%` across `viesiejiPirkimai*`,
`cvppViesiejiPirkimai`, `cvppSkelbimai`, `atn1*`, `cvppDumpAtn1*` — finds only false leads:
`atn1ataskaitos."ankstesnioNumeris"` and `cvppDumpAtn1PreviousProcurements."procurementNo"` both record a *prior
procurement procedure number* (re-tendering history), not a planning-document reference. No plan-entry field records
a "was this published" flag independent of a link either — every `planuojamiPirkimai`/`cvppPlanuojamiPirkimai` row is
by construction a scraped, already-published entry. A `buyer`-grain aggregate ("did this buyer publish any plan
entries this period") is theoretically computable from `v_pirkimo_planas` alone without the link, but that changes
the indicator's subject away from the `procurement` grain the canonical catalogue fixes for `LT-TRA-01` — a Phase 0a-
scale scope change, not a fix available within this row's current definition. Revisit alongside `LT-PRO-02` if the
Public Procurement Office ever publishes a key linking a plan entry to the procurement it became.

**LT-TRA-02** — Tender insufficiently advertised: not implementable with currently ingested data — the concept splits
into two halves and both are unmeasurable here. The first half, "a procurement exists with no corresponding public
notice," is structurally excluded from this data model: `v_pirkimas_v2`'s `cvpp` branch only produces a row *because*
a call-for-tenders notice was found (`WHERE c."skelbimoTipas" = 'Skelbimas apie pirkimą'`), and the `cvpis` branch
(`viesiejiPirkimai`) is itself CVP IS's scraped notice register — a procurement without a notice cannot appear as a
subject at all, so that half would only ever produce a vacuous `not_triggered`. The second half, "published through
an inadequate channel" (e.g. CVP IS only, never reaching TED/OJEU for an above-EU-threshold value), has no backing
column anywhere: `v_skelbimas` (350,157 rows, `viesiejiPirkimaiSkelbimai` ∪ `cvppSkelbimai`,
[domain-model.md](domain-model.md) §1.2/§4.2) records notice *kind* (`skelbimoTipas`/`skelbimoRusis` — "Skelbimas apie
pirkimą" / "Pataisos skelbimas" / etc.), never publication *channel*, and no table anywhere records a TED/OJEU
cross-reference or an EU-threshold flag to compare against. `v_skelbimas` is also not currently read by the risk
service at all (`modules/risk/procurementReader.ts` has no reference to it) and its link to `v_pirkimas` is a soft
value-match on `pirkimoNumeris` — the domain model's own §3 notes no relationship here is an enforced foreign key,
and unlike every other relationship in §5.2's coverage table, this one has no measured match rate. Revisit if a
TED/OJEU publication cross-reference or an EU-threshold flag is ever ingested.

**LT-TRA-03** — Key tender information/documents unavailable: not implementable — the one candidate signal exists but
fails on measured data-quality grounds, not mere absence. Unlike `LT-PRO-09`/`LT-PRO-10`, this concept only needs
document *existence* (are any files attached at all), which the file-metadata tables can in principle answer without
`v_dokumentas`: `viesiejiPirkimaiFailai."pirkimoId"` joins cleanly to the `cvpis`-sourced branch of `v_pirkimas`
(19.5% of the 264,415 subjects), and there only 128 of 51,540 procurements (0.25%) show zero attached files —
plausibly a genuine signal on that branch alone. But the `cvpp`-sourced branch is 80.5% of `v_pirkimas`
(213,522 rows) and file existence there requires a two-hop join, `cvppFailai."pirkimoId"` →
`cvppPirkimai."pirkimoId"` → `cvppPirkimai."pirkimoId"::text = cvppViesiejiPirkimai."pirkimoNumeris"` (the identity
`v_pirkimas` actually uses for this branch, per `modules/mcp/analyst/views/v_pirkimas_v2.sql` line 30 —
`cvppPirkimai."pirkimoNumeris"` itself is unusable, populated on only 12,236 of 217,786 rows). Measured directly
against the live warehouse (2026-08): of the 213,522 `cvpp`-branch procurements, **111,553 (52.2%) have no matching
`cvppPirkimai` row at all** — `cvppPirkimai` is itself a partial detail-scrape covering roughly half of
`cvppViesiejiPirkimai`'s notices, not a complete mirror of the notice register. For those 111K+ procurements, "zero
files found" is indistinguishable from "our detail-scrape hasn't reached this procurement yet" — a scraper-coverage
artifact, not a buyer-transparency failure. Building the formula on this data would make roughly half of `triggered`
results on the majority source wrong for reasons that have nothing to do with what the buyer actually published,
which Phase 1's coverage-quantification guidance treats as disqualifying rather than a caveat to word around: scoping
the formula to the reliable `cvpis` minority alone would silently drop 80% of the subject population the canonical
row is meant to cover, and flagging the `cvpp` majority as designed would make the indicator mostly measure our own
ingestion backlog. Revisit if `cvppPirkimai`'s detail-scrape coverage of `cvppViesiejiPirkimai` improves materially
(re-measure the match rate first), or if `v_dokumentas` ships with a reliable per-procurement document-existence
signal across both sources.

**LT-TRA-05** — Bidder questions unanswered: not implementable with currently ingested data. The concept needs the
actual clarification-question thread for a procurement — which questions bidders submitted, when, and whether/when the
buyer answered each one — but no warehouse table records individual questions or answers at all. A schema-wide search
of `dbSchema/*.sql` for `%klausim%` (question), `%atsakym%` (answer), and `%paaiskin%`/`%paaiškin%` (explanation/
clarification) finds exactly one table with a hit, `viesiejiPirkimaiKeys`, and its two matching columns —
`"paaiskinimuTerminoPabaiga"` (end of the clarifications period) and `"prasymuPateiktiPaaiskinimusTerminoPabaiga"`
(deadline for submitting a clarification request) — are both buyer-declared *deadlines* set at notice publication, the
same kind of process-design metadata already used elsewhere (e.g. the procurement timeline in
`src/lib/viesiejiPirkimai.ts`), not records of whether a question was actually asked or answered. No table anywhere —
including the file-metadata tables (`viesiejiPirkimaiFailai`, `cvppFailai`) and the ATN-1 procedure report
(`atn1ataskaitos`) — carries a question count, an answer count, a per-question timestamp, or even a boolean flag for
"a question went unanswered". Building a proxy from document titles (e.g. matching `dokumentasPavadinimas` for
"atsakymai į klausimus") would mean pattern-matching free-text filenames for an unbounded, un-auditable vocabulary,
the same fragile-regex approach the `LT-OTH-01` and `LT-COM-16` explanations above already reject for the same
underlying reason. Revisit if a source recording individual clarification questions and their answer status is ever
ingested.

### 4.2 Contract Risk Decision Service (17)

#### Subject `contract` — Contract (17)

| Code      | Canonical indicator                                          | Canonical category | Reference indicators             |
|-----------|--------------------------------------------------------------|--------------------|----------------------------------|
| LT-EXE-01 | Contract modified after award                                | Contract execution | OCP-R064; STT-I16                |
| LT-EXE-02 | Amendment reduces line items                                 | Contract execution | OCP-R065                         |
| LT-EXE-03 | Amendment increases line items                               | Contract execution | OCP-R066                         |
| LT-EXE-04 | Amendment increases contract price                           | Contract execution | OCP-R069; STT-I17                |
| LT-EXE-05 | Direct award followed by changes above competitive threshold | Contract execution | OCP-R054                         |
| LT-EXE-06 | Final contract amount differs greatly from award             | Contract execution | OCP-R059                         |
| LT-EXE-07 | Payments exceed contract amount                              | Contract execution | OCP-R068; ARACHNE-CAP-11         |
| LT-EXE-08 | Delivery failure                                             | Contract execution | OCP-R067                         |
| LT-EXE-09 | Delivered work differs from specifications                   | Contract execution | OCP-R073; STT-I18                |
| LT-EXE-10 | Weak supervision or acceptance controls                      | Contract execution | STT-I19                          |
| LT-EXE-11 | Losing bidder hired as subcontractor                         | Contract execution | OCP-R070; OECD-BR-03; OECD-BR-48 |
| LT-EXE-12 | Contractor subcontracts most of the work                     | Contract execution | OCP-R071                         |
| LT-EXE-13 | High prevalence of subcontracting                            | Contract execution | OCP-R072                         |
| LT-OTH-02 | Long or indefinite contract/framework duration               | Other              | OLAF-CN03; OLAF-CN08; OLAF-CN09  |
| LT-PRI-04 | Final-to-estimated value ratio anomalous                     | Pricing            | OLAF-CA04                        |
| LT-PRI-07 | High final contract value                                    | Pricing            | OLAF-CA09                        |
| LT-TRA-04 | Contract not published                                       | Transparency       | OCP-R063; VPT-I07; VPT-I08       |

### 4.3 Company Risk Decision Service (13)

#### Subject `supplier` — Supplier company (10)

| Code      | Canonical indicator                                                    | Canonical category    | Reference indicators                                      |
|-----------|------------------------------------------------------------------------|-----------------------|-----------------------------------------------------------|
| LT-COM-05 | High supplier market share                                             | Competition           | OCP-R050                                                  |
| LT-COM-08 | Excessive unsuccessful bids                                            | Competition           | OCP-R025; VPT-I11; OECD-BR-05; OECD-BR-08                 |
| LT-SUP-04 | Supplier operates across unusually unrelated markets                   | Supplier relationship | OCP-R048; OT-I09                                          |
| LT-SUP-05 | Supplier not found in business registry                                | Supplier relationship | OCP-R045                                                  |
| LT-SUP-06 | Supplier not traceable through normal public sources                   | Supplier relationship | OCP-R047                                                  |
| LT-SUP-07 | Abnormal supplier address or phone                                     | Supplier relationship | OCP-R042                                                  |
| LT-SUP-08 | Supplier is debarred or sanctioned                                     | Supplier relationship | OCP-R046; ARACHNE-CAP-07                                  |
| LT-SUP-09 | Supplier registered in tax-haven jurisdiction                          | Supplier relationship | OT-I06                                                    |
| LT-SUP-12 | Winning operator carries adverse risk information                      | Supplier relationship | OLAF-CA03; ARACHNE-CAP-03; ARACHNE-CAP-08; ARACHNE-CAP-09 |
| LT-SUP-13 | Supplier or associated-company financial risk is high or deteriorating | Supplier relationship | ARACHNE-LEG-01; ARACHNE-LEG-02; ARACHNE-LEG-03            |

#### Subject `buyer` — Buyer institution (3)

| Code      | Canonical indicator                                | Canonical category | Reference indicators         |
|-----------|----------------------------------------------------|--------------------|------------------------------|
| LT-PRO-03 | High institutional use of non-competitive methods  | Procedure design   | OCP-R013; VPT-I15            |
| LT-PRO-06 | Purchase splitting to avoid threshold              | Procedure design   | OCP-R011; STT-I09            |
| LT-PRO-07 | Manipulation/bunching around procurement threshold | Procedure design   | OCP-R002; OCP-R049; OCP-R055 |

### 4.4 Bidder Relationship Risk Decision Service (12)

#### Subject `bidder_relationship` — Bidder group / relationship (12)

| Code      | Canonical indicator                                               | Canonical category    | Reference indicators                                         |
|-----------|-------------------------------------------------------------------|-----------------------|--------------------------------------------------------------|
| LT-COI-01 | Bidder and project official share contact information             | Conflict of interest  | OCP-R043; STT-I12                                            |
| LT-COI-02 | Bidders share beneficial owner                                    | Conflict of interest  | OCP-R032; ARACHNE-CAP-05; ARACHNE-CAP-10                     |
| LT-COI-03 | Bidders share major shareholder                                   | Conflict of interest  | OCP-R033                                                     |
| LT-COI-04 | Undeclared or unmanaged conflict of interest                      | Conflict of interest  | STT-I11; ARACHNE-CAP-12; OECD-GOV-02                         |
| LT-COI-05 | Buyer official has personal or business tie to supplier           | Conflict of interest  | STT-I12; ARACHNE-CAP-10; ARACHNE-CAP-12; ARACHNE-LEG-04      |
| LT-COI-06 | Common control links competing bidders                            | Conflict of interest  | OCP-R032; OCP-R033; OCP-R044; ARACHNE-CAP-05; ARACHNE-CAP-10 |
| LT-COI-07 | Politically exposed person linked to supplier or beneficial owner | Conflict of interest  | ARACHNE-CAP-06                                               |
| LT-COM-14 | Bid rotation                                                      | Competition           | OCP-R057; OECD-BR-06                                         |
| LT-COM-15 | Recurrent winner among co-bidding pairs                           | Competition           | OCP-R053                                                     |
| LT-COM-22 | Competing bids operationally coordinated                          | Competition           | OECD-BR-11; OECD-BR-17; OECD-BR-44; OECD-BR-45               |
| LT-COM-24 | Suppliers meet or socialize before bidding                        | Competition           | OECD-BR-42; OECD-BR-43                                       |
| LT-SUP-10 | Business similarities suggest connected bidders                   | Supplier relationship | OCP-R044; OECD-BR-19; OECD-BR-47                             |

### 4.5 Buyer–Supplier Relationship Risk Decision Service (5)

#### Subject `buyer_supplier_relationship` — Buyer–supplier relationship (5)

| Code      | Canonical indicator                                      | Canonical category    | Reference indicators                                           |
|-----------|----------------------------------------------------------|-----------------------|----------------------------------------------------------------|
| LT-COM-04 | High buyer–supplier award concentration                  | Competition           | OCP-R040; OT-I08; STT-I06; STT-I07; ARACHNE-CAP-04; OECD-BR-01 |
| LT-SUP-01 | Repeated awards to same supplier                         | Supplier relationship | OCP-R040; STT-I06                                              |
| LT-SUP-02 | Small initial purchase followed by much larger purchases | Supplier relationship | OCP-R052                                                       |
| LT-SUP-03 | Multiple direct awards to same supplier near threshold   | Supplier relationship | OCP-R055                                                       |
| LT-SUP-11 | Supplier supports or donates to purchasing institution   | Supplier relationship | STT-I20                                                        |

### 4.6 Market Risk Decision Service (3)

#### Subject `market` — Market / category portfolio (3)

| Code      | Canonical indicator                      | Canonical category | Reference indicators               |
|-----------|------------------------------------------|--------------------|------------------------------------|
| LT-COM-06 | High market concentration                | Competition        | OCP-R051; ARACHNE-CAP-04           |
| LT-COM-09 | Prevalence of bidding consortia          | Competition        | OCP-R026; OECD-BR-07               |
| LT-COM-19 | Geographic or customer-market allocation | Competition        | OECD-BR-02; OECD-BR-35; OECD-BR-36 |

## 5. Coverage matrix

Every canonical indicator appears in exactly one cell: rows are primary evaluation subjects
([§4](#4-indicators-by-primary-evaluation-subject)), columns are canonical categories.

| Primary evaluation subject  | Competition | Procedure design | Supplier relationship | Pricing | Award | Contract execution | Conflict of interest | Transparency | Other |   Total |
|-----------------------------|------------:|-----------------:|----------------------:|--------:|------:|-------------------:|---------------------:|-------------:|------:|--------:|
| Procurement                 |           2 |               11 |                     — |       2 |     — |                  — |                    — |            8 |     5 |  **28** |
| Lot                         |           7 |                — |                     — |       4 |     6 |                  — |                    — |            — |     — |  **17** |
| Bid / bidder participation  |           5 |                — |                     — |       4 |     2 |                  — |                    — |            — |     — |  **11** |
| Contract                    |           — |                — |                     — |       2 |     — |                 13 |                    — |            1 |     1 |  **17** |
| Supplier company            |           2 |                — |                     8 |       — |     — |                  — |                    — |            — |     — |  **10** |
| Buyer institution           |           — |                3 |                     — |       — |     — |                  — |                    — |            — |     — |   **3** |
| Buyer–supplier relationship |           1 |                — |                     4 |       — |     — |                  — |                    — |            — |     — |   **5** |
| Bidder group / relationship |           4 |                — |                     1 |       — |     — |                  — |                    7 |            — |     — |  **12** |
| Market / category portfolio |           3 |                — |                     — |       — |     — |                  — |                    — |            — |     — |   **3** |
| **Total**                   |      **24** |           **14** |                **13** |  **12** | **8** |             **13** |                **7** |        **9** | **6** | **106** |

## 6. Implementation note

The mapping is many-to-many and preserves provenance while removing conceptual duplication. A production specification
should add, for every canonical indicator: Lithuanian title, definition, unit of analysis, required fields, exact
formula and threshold, applicable procedure types, risk/compliance distinction, severity, missing-data behavior, source
page/version, and validation status. Thresholds must be calibrated on Lithuanian data and current Lithuanian/EU law
rather than copied mechanically from another jurisdiction.

# Canonical Lithuanian catalogue

A flag is a reason to review a procurement, not proof of fraud, corruption, or illegality.

## Reference-code prefixes

| Prefix                           | Source                                          |
|----------------------------------|-------------------------------------------------|
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

## Competition (24)

| Code      | Canonical indicator                           | Reference indicators                                           |
|-----------|-----------------------------------------------|----------------------------------------------------------------|
| LT-COM-01 | Single valid bid                              | OCP-R018; OLAF-CA02; OT-I01; STT-I03; VPT-I01                  |
| LT-COM-02 | Low number of bidders                         | OCP-R019; OLAF-CN01; OLAF-CN02; OLAF-CA02; VPT-I12             |
| LT-COM-03 | Only one supplier invited or consulted        | STT-I02                                                        |
| LT-COM-04 | High buyer–supplier award concentration       | OCP-R040; OT-I08; STT-I06; STT-I07; ARACHNE-CAP-04; OECD-BR-01 |
| LT-COM-05 | High supplier market share                    | OCP-R050                                                       |
| LT-COM-06 | High market concentration                     | OCP-R051; ARACHNE-CAP-04                                       |
| LT-COM-07 | Missing expected bidder                       | OCP-R027; OECD-BR-03                                           |
| LT-COM-08 | Excessive unsuccessful bids                   | OCP-R025; VPT-I11; OECD-BR-05; OECD-BR-08                      |
| LT-COM-09 | Prevalence of bidding consortia               | OCP-R026; OECD-BR-07                                           |
| LT-COM-10 | Identical bid prices                          | OCP-R028; OECD-BR-24                                           |
| LT-COM-11 | Fixed-multiple bid prices                     | OCP-R023; OECD-BR-25                                           |
| LT-COM-12 | Suspiciously close bid prices                 | OCP-R024; OECD-BR-26                                           |
| LT-COM-13 | Wide disparity in bid prices                  | OCP-R022; OECD-BR-26                                           |
| LT-COM-14 | Bid rotation                                  | OCP-R057; OECD-BR-06                                           |
| LT-COM-15 | Recurrent winner among co-bidding pairs       | OCP-R053                                                       |
| LT-COM-16 | Similar bid documents                         | OCP-R041; OECD-BR-09; OECD-BR-10; OECD-BR-12; OECD-BR-14; OECD-BR-15; OECD-BR-39 |
| LT-COM-17 | Bids submitted in suspiciously repeated order | OCP-R034; OECD-BR-18                                           |
| LT-COM-18 | Procurement object has elevated cartel risk   | OLAF-CN05                                                      |
| LT-COM-19 | Geographic or customer-market allocation      | OECD-BR-02; OECD-BR-35; OECD-BR-36                             |
| LT-COM-20 | Unexpected or frequent bid withdrawal         | OECD-BR-04                                                     |
| LT-COM-21 | Non-genuine, incomplete, or incapable bid     | OECD-BR-13; OECD-BR-16; OECD-BR-32; OECD-BR-38; OECD-BR-46     |
| LT-COM-22 | Competing bids operationally coordinated      | OECD-BR-11; OECD-BR-17; OECD-BR-44; OECD-BR-45                 |
| LT-COM-23 | Bidder statements indicate collusion          | OECD-BR-33; OECD-BR-34; OECD-BR-35; OECD-BR-36; OECD-BR-37; OECD-BR-38; OECD-BR-39; OECD-BR-40; OECD-BR-41 |
| LT-COM-24 | Suppliers meet or socialize before bidding    | OECD-BR-42; OECD-BR-43                                         |

## Procedure design (14)

| Code      | Canonical indicator                                | Reference indicators                                                                                                                                           |
|-----------|----------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| LT-PRO-01 | Unjustified non-competitive procedure              | OCP-R010; OLAF-CN23; OT-I03; STT-I08; VPT-I15                                                                                                                  |
| LT-PRO-02 | Direct award contrary to procurement plan          | OCP-R012                                                                                                                                                       |
| LT-PRO-03 | High institutional use of non-competitive methods  | OCP-R013; VPT-I15                                                                                                                                              |
| LT-PRO-04 | Procedure without prior publication                | OLAF-CA01; OT-I02                                                                                                                                              |
| LT-PRO-05 | Accelerated procedure without adequate grounds     | OLAF-CN22                                                                                                                                                      |
| LT-PRO-06 | Purchase splitting to avoid threshold              | OCP-R011; STT-I09                                                                                                                                              |
| LT-PRO-07 | Manipulation/bunching around procurement threshold | OCP-R002; OCP-R049; OCP-R055                                                                                                                                   |
| LT-PRO-08 | Short submission/advertisement period              | OCP-R003; OCP-R014; OLAF-CN29; OT-I04                                                                                                                          |
| LT-PRO-09 | Unreasonable prequalification requirements         | OCP-R006; OLAF-CN10; OLAF-CN11; OLAF-CN12; OLAF-CN14; OLAF-CN15; OLAF-CN16; OLAF-CN17; OLAF-CN18; OLAF-CN19; OLAF-CN20; OLAF-CN21; STT-I05; OT-I10; OECD-TD-02 |
| LT-PRO-10 | Tailored or restrictive technical specifications   | OCP-R007; OLAF-CN20; STT-I04; OT-I10; OECD-TD-03                                                                                                               |
| LT-PRO-11 | Unreasonable participation or document fees        | OCP-R008; OCP-R009                                                                                                                                             |
| LT-PRO-12 | Excessive tender guarantee                         | OLAF-CN31                                                                                                                                                      |
| LT-PRO-13 | Low predefined number of candidates                | OLAF-CN24                                                                                                                                                      |
| LT-PRO-14 | Missing method for reducing candidate numbers      | OLAF-CN25                                                                                                                                                      |

## Supplier relationship (13)

| Code      | Canonical indicator                                      | Reference indicators                                      |
|-----------|----------------------------------------------------------|-----------------------------------------------------------|
| LT-SUP-01 | Repeated awards to same supplier                         | OCP-R040; STT-I06                                         |
| LT-SUP-02 | Small initial purchase followed by much larger purchases | OCP-R052                                                  |
| LT-SUP-03 | Multiple direct awards to same supplier near threshold   | OCP-R055                                                  |
| LT-SUP-04 | Supplier operates across unusually unrelated markets     | OCP-R048; OT-I09                                          |
| LT-SUP-05 | Supplier not found in business registry                  | OCP-R045                                                  |
| LT-SUP-06 | Supplier not traceable through normal public sources     | OCP-R047                                                  |
| LT-SUP-07 | Abnormal supplier address or phone                       | OCP-R042                                                  |
| LT-SUP-08 | Supplier is debarred or sanctioned                       | OCP-R046; ARACHNE-CAP-07                                  |
| LT-SUP-09 | Supplier registered in tax-haven jurisdiction            | OT-I06                                                    |
| LT-SUP-10 | Business similarities suggest connected bidders          | OCP-R044; OECD-BR-19; OECD-BR-47                          |
| LT-SUP-11 | Supplier supports or donates to purchasing institution   | STT-I20                                                   |
| LT-SUP-12 | Winning operator carries adverse risk information        | OLAF-CA03; ARACHNE-CAP-03; ARACHNE-CAP-08; ARACHNE-CAP-09 |
| LT-SUP-13 | Supplier or associated-company financial risk is high or deteriorating | ARACHNE-LEG-01; ARACHNE-LEG-02; ARACHNE-LEG-03   |

## Pricing (12)

| Code      | Canonical indicator                                | Reference indicators            |
|-----------|----------------------------------------------------|---------------------------------|
| LT-PRI-01 | Estimated value anomalous against market benchmark | OCP-R016; OLAF-CN07; STT-I10    |
| LT-PRI-02 | Line-item price anomalously high or low            | OCP-R017                        |
| LT-PRI-03 | Winning price close to or above estimate           | OCP-R031; OLAF-CN13; OECD-BR-28 |
| LT-PRI-04 | Final-to-estimated value ratio anomalous           | OLAF-CA04                       |
| LT-PRI-05 | High estimated value                               | OLAF-CN06                       |
| LT-PRI-06 | High estimated framework value                     | OLAF-CN04                       |
| LT-PRI-07 | High final contract value                          | OLAF-CA09                       |
| LT-PRI-08 | Bid prices deviate from Benford's Law              | OCP-R029; OT-I07                |
| LT-PRI-09 | Heavily discounted bid                             | OCP-R058                        |
| LT-PRI-10 | Bid-price or discount movements inconsistent with competition | OECD-BR-20; OECD-BR-21; OECD-BR-22; OECD-BR-23; OECD-BR-29 |
| LT-PRI-11 | Supplier bid much higher than for a comparable contract | OECD-BR-27                  |
| LT-PRI-12 | Anomalous geographic delivery or transport pricing | OECD-BR-30; OECD-BR-31          |

## Award (8)

| Code      | Canonical indicator                           | Reference indicators                    |
|-----------|-----------------------------------------------|-----------------------------------------|
| LT-AWD-01 | All bids except winner disqualified           | OCP-R035; OT-I11                        |
| LT-AWD-02 | Lowest bid disqualified                       | OCP-R036                                |
| LT-AWD-03 | Poorly supported disqualification             | OCP-R037; STT-I14                       |
| LT-AWD-04 | Excessive share of disqualified bids          | OCP-R038                                |
| LT-AWD-05 | Late bid accepted and won                     | OCP-R030                                |
| LT-AWD-06 | Winner does not meet award criteria           | OCP-R056                                |
| LT-AWD-07 | Evaluation criteria excessively discretionary | OCP-R021; STT-I13                       |
| LT-AWD-08 | Award criteria or scoring method incomplete   | OLAF-CN26; OLAF-CN27; OLAF-CN28; OT-I10 |

## Contract execution (13)

| Code      | Canonical indicator                                          | Reference indicators             |
|-----------|--------------------------------------------------------------|----------------------------------|
| LT-EXE-01 | Contract modified after award                                | OCP-R064; STT-I16                |
| LT-EXE-02 | Amendment reduces line items                                 | OCP-R065                         |
| LT-EXE-03 | Amendment increases line items                               | OCP-R066                         |
| LT-EXE-04 | Amendment increases contract price                           | OCP-R069; STT-I17                |
| LT-EXE-05 | Direct award followed by changes above competitive threshold | OCP-R054                         |
| LT-EXE-06 | Final contract amount differs greatly from award             | OCP-R059                         |
| LT-EXE-07 | Payments exceed contract amount                              | OCP-R068; ARACHNE-CAP-11         |
| LT-EXE-08 | Delivery failure                                             | OCP-R067                         |
| LT-EXE-09 | Delivered work differs from specifications                   | OCP-R073; STT-I18                |
| LT-EXE-10 | Weak supervision or acceptance controls                      | STT-I19                          |
| LT-EXE-11 | Losing bidder hired as subcontractor                         | OCP-R070; OECD-BR-03; OECD-BR-48 |
| LT-EXE-12 | Contractor subcontracts most of the work                     | OCP-R071                         |
| LT-EXE-13 | High prevalence of subcontracting                            | OCP-R072                         |

## Conflict of interest (7)

| Code      | Canonical indicator                                               | Reference indicators                                         |
|-----------|-------------------------------------------------------------------|--------------------------------------------------------------|
| LT-COI-01 | Bidder and project official share contact information             | OCP-R043; STT-I12                                            |
| LT-COI-02 | Bidders share beneficial owner                                    | OCP-R032; ARACHNE-CAP-05; ARACHNE-CAP-10                     |
| LT-COI-03 | Bidders share major shareholder                                   | OCP-R033                                                     |
| LT-COI-04 | Undeclared or unmanaged conflict of interest                      | STT-I11; ARACHNE-CAP-12; OECD-GOV-02                         |
| LT-COI-05 | Buyer official has personal or business tie to supplier           | STT-I12; ARACHNE-CAP-10; ARACHNE-CAP-12; ARACHNE-LEG-04      |
| LT-COI-06 | Common control links competing bidders                            | OCP-R032; OCP-R033; OCP-R044; ARACHNE-CAP-05; ARACHNE-CAP-10 |
| LT-COI-07 | Politically exposed person linked to supplier or beneficial owner | ARACHNE-CAP-06                                               |

## Transparency (9)

| Code      | Canonical indicator                           | Reference indicators           |
|-----------|-----------------------------------------------|--------------------------------|
| LT-TRA-01 | Planning documents unavailable                | OCP-R001; VPT-I09; OECD-GOV-01 |
| LT-TRA-02 | Tender insufficiently advertised              | OCP-R004; OLAF-CN30; OT-I02    |
| LT-TRA-03 | Key tender information/documents unavailable  | OCP-R005; STT-I15              |
| LT-TRA-04 | Contract not published                        | OCP-R063; VPT-I07; VPT-I08     |
| LT-TRA-05 | Bidder questions unanswered                   | OCP-R039                       |
| LT-TRA-06 | Procurement decision or reason not documented | STT-I15; OLAF-CA06             |
| LT-TRA-07 | Complaint received                            | OCP-R020; VPT-I13; OECD-GOV-11 |
| LT-TRA-08 | Procurement challenged in court               | VPT-I14                        |
| LT-TRA-09 | Procurement not conducted electronically      | VPT-I06; OECD-GOV-07           |

## Other (6)

| Code      | Canonical indicator                                   | Reference indicators                                     |
|-----------|-------------------------------------------------------|----------------------------------------------------------|
| LT-OTH-01 | No documented market research                         | STT-I01; OECD-TD-01                                      |
| LT-OTH-02 | Long or indefinite contract/framework duration        | OLAF-CN03; OLAF-CN08; OLAF-CN09                          |
| LT-OTH-03 | Evaluation/decision period anomalously short or long  | OCP-R015; OCP-R061; OCP-R062; OLAF-CA08; OT-I05; VPT-I10 |
| LT-OTH-04 | Award-to-signature period unusually long              | OCP-R060                                                 |
| LT-OTH-05 | Procedure unsuccessful or award not contracted        | OLAF-CA05; OLAF-CA06; OLAF-CA07; VPT-I11                 |
| LT-OTH-06 | Strategic-policy objective not applied where relevant | VPT-I02; VPT-I03; VPT-I04; VPT-I05; OECD-GOV-04          |

## Canonical totals

| Category              |  Count |
|-----------------------|-------:|
| Competition           |     24 |
| Procedure design      |     14 |
| Supplier relationship |     13 |
| Pricing               |     12 |
| Award                 |      8 |
| Contract execution    |     13 |
| Conflict of interest  |      7 |
| Transparency          |      9 |
| Other                 |      6 |
| **Total**             | **106** |

## Implementation note

The mapping is many-to-many and preserves provenance while removing conceptual duplication. A production specification
should add, for every canonical indicator: Lithuanian title, definition, unit of analysis, required fields, exact
formula and threshold, applicable procedure types, risk/compliance distinction, severity, missing-data behavior, source
page/version, and validation status. Thresholds must be calibrated on Lithuanian data and current Lithuanian/EU law
rather than copied mechanically from another jurisdiction.

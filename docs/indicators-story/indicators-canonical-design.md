The OCP document is **one methodology**, not the only framework you can use in the EU or Lithuania. In fact, the
document itself says its indicators must be adapted to the country's regulatory and market context, and that its list is
not exhaustive. It contains 73 red-flag indicators intended as a catalogue that you can adapt.

For Lithuania, I would not use the OCP document alone. There are several relevant alternatives and complementary
sources:

| Source                                         | Status                                            | Best use for Lithuania                                                                           |
|------------------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------|
| **OCP – Red Flags in Public Procurement 2024** | International / non-governmental                  | Excellent technical catalogue of computable indicators and formulas                              |
| **European Commission / OLAF red flags**       | **Official EU guidance**                          | Strong basis for fraud/corruption detection, especially for EU-funded procurement                |
| **ARACHNE+**                                   | **Official European Commission system**           | Automated risk scoring for projects, beneficiaries, contractors and contracts involving EU funds |
| **Lithuanian VPT indicators / Švieslentė**     | **Official Lithuanian**                           | Lithuania-specific procurement performance/risk indicators                                       |
| **Lithuanian STT corruption-risk analyses**    | **Official Lithuanian anti-corruption authority** | Lithuania-specific corruption patterns and qualitative red flags                                 |
| **OpenTender / iMonitor**                      | Independent European research framework           | Data-driven corruption-risk scoring specifically designed around European procurement data       |
| **OECD procurement integrity framework**       | International intergovernmental                   | Risk-management principles, bid-rigging/collusion detection and governance                       |

OCP – Red Flags in Public Procurement 2024
European Commission / OLAF red flags
ARACHNE+ 
Lithuanian VPT indicators / Švieslentė
Lithuanian STT corruption-risk analyses
OpenTender / iMonitor
OECD procurement integrity framework

The European Commission actually maintains a substantial collection of relevant methodologies. It includes **“Fraud in
Public Procurement – A collection of Red Flags and Best Practices” (2017)**, the **2009 Information Note on Fraud
Indicators**, the **Fraud Risk Assessment and Effective and Proportionate Anti-Fraud Measures** framework,
conflict-of-interest guidance, procurement-error guidance, and OECD bid-rigging material.
([Anti-Fraud Knowledge Centre][1])

For EU-funded procurement, **ARACHNE+ is particularly important**. As of 2026 it is the Commission's
risk-scoring/data-mining system for detecting risks involving fraud, conflicts of interest, procurement, eligibility,
beneficiaries, contractors and contracts. It combines programme data with external company/ownership/compliance
information and generates risk indicators rather than automatically deciding that fraud occurred.
([Anti-Fraud Knowledge Centre][2])

There is also a legal distinction worth making. EU procurement law requires controls but generally does **not prescribe
one universal red-flag algorithm**. For example, Article 24 of Directive 2014/24/EU requires contracting authorities to
take appropriate measures to prevent, identify and remedy conflicts of interest, rather than defining one mandatory
computational red-flag catalogue. ([EUR-Lex][3]) For EU cohesion-type funds there are additional anti-fraud obligations;
the Commission refers to Article 74 (1)(c) of Regulation 2021/1060 as the basis for implementing effective and
proportionate anti-fraud measures. ([EUR-Lex][4])

### For Lithuania specifically

There are already useful national signals you should incorporate.

The Lithuanian **Viešųjų pirkimų tarnyba (VPT)** has its procurement monitoring system/Švieslentė. In 2026 it added
explicit procurement-risk indicators, including the share of procurements receiving supplier complaints and the share
challenged in court. ([Viešųjų Pirkimų Tarnyba][5]) VPT also publishes broader public-procurement efficiency indicators
and guidance. ([Viešųjų Pirkimų Tarnyba][6])

The Lithuanian **STT** is perhaps even more useful when designing corruption red flags because it publishes actual
corruption-risk analyses of Lithuanian procurements. Its findings include patterns such as **absence of market research,
only one supplier being approached, single-bidder procurement, overly specific technical requirements, repeated
relationships with particular suppliers and technical specifications closely matching a particular supplier's product**.
([STT][7])

There is also a particularly interesting alternative for your case: **OpenTender/iMonitor**. Its updated 2026
methodology uses **11 individual integrity indicators** to identify higher-risk European procurements. ([I Monitor][8])
Lithuania has been one of the countries specifically supported in the iMonitor/OpenTender work, including Lithuanian
training material. ([I Monitor][9]) Moreover, an OCDS-formatted Lithuania dataset derived from OpenTender is already
available, covering hundreds of thousands of Lithuanian procurement records. ([Open Contracting Data Registry][10])

And Lithuania's own procurement infrastructure is increasingly usable programmatically: VPT's current CVP IS API exposes
fields such as procurement number, procedure/directive, CPV, NUTS, deadlines, EU funding status, TED references and
contract date. ([Viešųjų Pirkimų Tarnyba][11])

### What I would use for a Lithuanian system

If your goal is to **build a software system that automatically identifies suspicious Lithuanian public procurements**,
I would combine the frameworks rather than select one.

I would structure it approximately as:

**EU/LT law → EC/OLAF → STT/VPT → OCP → OpenTender/OECD**

In practice:

**OCP** gives you the *technical indicator catalogue and formulas*. **EC/OLAF** tells you which fraud patterns matter in
the EU control environment. **STT** tells you which patterns actually occur in Lithuania. **VPT** gives you
Lithuania-specific metrics, rules and data. **OpenTender/iMonitor** gives you a second, independently developed European
statistical model for comparison. **ARACHNE+** is the reference point if your system deals specifically with EU-funded
projects.

For example, your Lithuanian risk model might eventually contain rules such as:

```text
LT-R001  Single bidder
LT-R002  Repeated awards to same supplier
LT-R003  Very short submission period
LT-R004  Non-open procedure
LT-R005  Contract just below procurement threshold
LT-R006  Repeated contracts just below threshold
LT-R007  Technical specification unusually restrictive
LT-R008  No evidence of market consultation
LT-R009  Supplier concentration for buyer + CPV
LT-R010  Winning supplier repeatedly receives direct awards
LT-R011  Contract value significantly above market benchmark
LT-R012  Abnormally high number of amendments
LT-R013  Large post-award price increase
LT-R014  Complaint submitted by bidder
LT-R015  Procurement challenged in court
LT-R016  Buyer/supplier relationship anomaly
LT-R017  Potential conflict of interest
...
```

Crucially, **a red flag should normally mean “investigate this procurement”, not “this procurement is corrupt.”** Both
the OCP methodology and EU approaches make this distinction.

So if you are choosing a basis for a **Lithuanian procurement risk-detection product**, I would use the OCP document as
an excellent starting catalogue, **but not as the specification**. I would create a **Lithuanian Red Flag Catalogue** by
mapping OCP + EC/OLAF + OpenTender indicators against Lithuanian VPĮ rules, VPT data and STT findings. That would be
much stronger legally and analytically than implementing the 73 OCP indicators unchanged.

[1]: https://antifraud-knowledge-centre.ec.europa.eu/guidance-legislation/official-guidelines-and-material_en "Official guidelines and material - Anti-Fraud Knowledge Centre"
[2]: https://antifraud-knowledge-centre.ec.europa.eu/useful-tools/what-arachne_en?utm_source=chatgpt.com "What is ARACHNE? - Anti-Fraud Knowledge Centre - European Commission"
[3]: https://eur-lex.europa.eu/legal-content/EN-DE/TXT/?from=EN&uri=CELEX%3A32014L0024&utm_source=chatgpt.com "Directive - 2014/24 - DE - EUR-Lex"
[4]: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52024SC0191&utm_source=chatgpt.com "EUR-Lex - 52024SC0191 - IT - EUR-Lex"
[5]: https://vpt.lrv.lt/lt/naujienos-3/svieslenteje-realizuoti-du-nauji-pirkimu-rizikinguma-matuojantys-rodikliai-kurie-bus-itraukti-i-bendra-pirkimu-vykdytoju-vertinima-nuo-2026-m-60e?utm_source=chatgpt.com "Švieslentėje realizuoti du nauji pirkimų rizikingumą matuojantys rodikliai, kurie bus įtraukti į bendrą pirkimų vykdytojų vertinimą nuo 2026 m. - Viešųjų pirkimų tarnyba"
[6]: https://vpt.lrv.lt/lt/statistika-ir-analize/viesuju-pirkimu-efektyvumo-stebesenos-rodikliai/?utm_source=chatgpt.com "Viešųjų pirkimų sistemos efektyvumo stebėsenos rodikliai - Viešųjų pirkimų tarnyba"
[7]: https://www.stt.lt/korupcijos-prevencija/korupcijos-rizikos-analizes/atliktos-korupcijos-rizikos-analizes/7471?utm_source=chatgpt.com "Atliktos korupcijos rizikos analizės | STT"
[8]: https://imonitor.govtransparency.eu/2026/03/12/corruption-risk-indicators-in-public-procurement-an-updated-opentender-eu-framework/?utm_source=chatgpt.com "Corruption Risk Indicators in Public Procurement: An updated opentender.eu framework – iMonitor Govtransparency"
[9]: https://imonitor.govtransparency.eu/training-program/?utm_source=chatgpt.com "Training program – iMonitor Govtransparency"
[10]: https://data.open-contracting.org/en/publication/68?utm_source=chatgpt.com "Lithuania: OpenTender | OCP Data Registry"
[11]: https://vpt.lrv.lt/lt/naujienos-3/del-api-funkcionalumo-papildymo-w0Y/?utm_source=chatgpt.com "Dėl API funkcionalumo papildymo - Viešųjų pirkimų tarnyba"

I recommend creating a **canonical Lithuanian indicator catalogue**, where each practical risk concept appears once,
while every source that supports or overlaps with it is referenced.

So instead of implementing:

* OCP indicator A
* OLAF indicator B
* OpenTender indicator C
* STT finding D

as four separate checks when they essentially detect the same thing, create one canonical indicator:

**LT-R001 — Single-bidder procurement**

and attach all relevant references to it.

For example:

```text
LT-R001: Single-bidder procurement

Definition:
Only one valid bid was submitted in a competitive procedure.

Risk rationale:
Low competition may indicate restrictive requirements,
poor market outreach, tailoring, or other competition risks.

Sources:
- OCP: indicator XYZ — Single bidder
- OpenTender: Single bidder
- OLAF: limited competition / single tender red flag
- STT: Lithuanian findings concerning procurements with one supplier
- VPT: relevant competition indicator
- VPĮ: relevant legal/procedural provisions

Data:
- tender.numberOfTenders
- procedure type
- excluded bids

Detection:
numberOfValidBids == 1

Jurisdiction:
Lithuania

Risk category:
Competition

Severity:
Medium

Notes:
A single bid is not evidence of corruption by itself.
```

The important design choice is this:

**Deduplicate the indicator, not its references.**

One canonical indicator can have:

```text
1 canonical indicator
        ↓
5 source mappings
```

rather than:

```text
5 sources
        ↓
5 duplicate indicators
```

### But don't force everything into non-overlapping indicators

This is the nuance.

You want the catalogue to be **as non-duplicative as reasonably possible**, but some indicators genuinely overlap
without being identical.

For example:

```text
LT-R010 — Single bidder
LT-R011 — Low number of bidders
LT-R012 — Repeated single-bidder awards
LT-R013 — Buyer has unusually high single-bidder rate
```

These are related but measure different things.

Another example:

```text
LT-R020 — Contract awarded just below threshold
LT-R021 — Repeated contracts just below threshold
LT-R022 — Suspected contract splitting
```

They overlap conceptually, but they are not the same detection rule.

So I would model relationships explicitly:

```text
LT-R020
  related_to: LT-R021
  possible_signal_for: LT-R022
```

rather than merging them into one vague "threshold risk" indicator.

### I would use three layers

A clean architecture would be:

```text
SOURCE INDICATORS
      ↓
CANONICAL RISK INDICATORS
      ↓
EXECUTABLE DETECTION RULES
```

For example:

```text
OCP-17 ─────────┐
OpenTender-04 ──┼──> LT-R001 Single bidder
OLAF-RF-12 ─────┤
STT-FINDING-XX ─┘
                       ↓
                rule: valid_bid_count == 1
```

This separation is useful because the **concept** and the **implementation** are not always identical.

Suppose OCP says:

```text
submission period unusually short
```

OpenTender might define it statistically:

```text
submission_days < expected value for procedure
```

while Lithuanian VPĮ may define a legally relevant minimum deadline.

Your canonical indicator could therefore be:

```text
LT-R031 — Unusually short submission period
```

with several detection rules:

```text
R031-A — Below statutory minimum
R031-B — Shorter than 95% of comparable tenders
R031-C — Significantly shorter than buyer's historical norm
```

The first is potentially a **compliance violation**.

The other two are **risk signals**.

That distinction is very important.

### References should be many-to-many

I would definitely preserve references for overlapping indicators.

Your model might look approximately like:

```text
Indicator
---------
id
name
description
risk_category
jurisdiction
severity
interpretation

Source
------
id
organization
document
version
url
publication_date

IndicatorSourceMapping
----------------------
indicator_id
source_id
source_indicator_id
source_indicator_name
mapping_type
source_page
notes
```

Where `mapping_type` might be:

```text
EXACT
EQUIVALENT
PARTIAL
RELATED
DERIVED
LEGAL_BASIS
LOCAL_EVIDENCE
```

For example:

```text
LT-R001 Single bidder

OCP-023             EXACT
OpenTender-I4       EQUIVALENT
OLAF-RF-07          PARTIAL
STT-2024-XYZ        LOCAL_EVIDENCE
VPĮ Article XX      LEGAL_BASIS
```

This is better than just storing a list of URLs, because later you can explain **why each reference exists**.

### Also distinguish five kinds of sources

I would not treat OCP, OLAF, VPĮ and STT as equivalent authorities.

A useful classification is:

| Type                | Example                     | Meaning                              |
|---------------------|-----------------------------|--------------------------------------|
| `LEGAL`             | VPĮ, EU Directive           | Law / regulatory requirement         |
| `OFFICIAL_GUIDANCE` | EC, OLAF, VPT               | Official interpretation/guidance     |
| `RISK_METHODOLOGY`  | OCP, OpenTender             | Analytical methodology               |
| `LOCAL_EVIDENCE`    | STT investigations/analyses | Evidence of Lithuanian risk patterns |
| `RESEARCH`          | OECD, academic papers       | Supporting research                  |

That lets your system eventually produce explanations such as:

> **LT-R031: Short submission period**
>
> Risk score: 72/100
> Triggered because submission period was 6 days.
>
> Supported by:
>
> * OpenTender competition-risk methodology
> * OCP red-flag methodology
> * STT Lithuanian corruption-risk analysis
>
> Legal assessment:
>
> * No VPĮ deadline violation detected.

That last sentence matters a lot. A procurement can be **risky without being illegal**.

### So the end result should look like this

Not:

```text
OCP indicators       73
OLAF indicators      40
OpenTender           11
STT indicators       20
VPT indicators       15
-----------------------
Total                159
```

because there may be heavy duplication.

Instead:

```text
Canonical Lithuanian catalogue
--------------------------------
Competition             18
Procedure design         14
Supplier relationship    12
Pricing                   9
Award                     8
Contract execution       13
Conflict of interest      7
Transparency              9
Other                     6
--------------------------------
~96 canonical indicators
```

Those numbers are just illustrative.

Each one might reference several external indicators.

Then you have something much more defensible:

```text
LT-R042
  Canonical indicator:
    Repeated awards to the same supplier

  References:
    OCP: ...
    OpenTender: ...
    OLAF: ...
    STT: ...
    VPT: ...

  Lithuanian applicability:
    Applicable

  VPĮ relevance:
    Article ...

  Detection rules:
    R042-A
    R042-B
    R042-C
```

So yes: **create a normalized/non-duplicative catalogue, but retain full provenance for every overlapping source.** I
would actually make that provenance a first-class part of the data model rather than something placed only in
documentation.

That gives you traceability from:

**risk result → rule → Lithuanian canonical indicator → OCP/OLAF/OpenTender/STT/VPT/VPĮ source**

which is exactly what you would want if someone later asks, *“Why does your system consider this procurement risky?”*

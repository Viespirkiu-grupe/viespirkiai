# MCP Risk Intelligence Tool — Investigator Questions

For LLM see: [mcp-investigator-prompt.md](mcp-investigator-prompt.md)

Each question is phrased as a real investigator tip — the kind of sentence typed into the chat. Use these to verify
that the MCP agentic loop produces correct, useful, non-hallucinated answers against the live database.

All SQL in this document has been validated via `EXPLAIN` against the live `viespirkiai` database.

---

## MCP Tool Quick Reference

> **For the LLM agent:** Always call `get_schema` first if you are unsure about column names. Use
> `execute_query` for any analytical or aggregate query. Use the named lookup tools
> (`get_juridinis`, `get_sutartis`, etc.) for single-entity deep-dives. Each theme section below
> lists the specific tools recommended for that investigation path.

### Available tools

| Tool                          | What it returns                                                                                                                          |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `get_schema`                  | Schema of all views and raw tables with column names — call this first when unsure                                                       |
| `get_juridinis`               | Full company profile: Sodra headcount/wages, recent contracts, PINREG declarations, court cases, VDI violations, domains, ES investments |
| `search_juridiniai`           | Search companies by name or code                                                                                                         |
| `search_sutartys`             | Search contracts by buyer code, supplier code, value range, date range, CPV prefix, contract type                                        |
| `get_sutartis`                | Full single-contract record with documents JSONB and ES project links                                                                    |
| `search_viesieji_pirkimai`    | Search procurement announcements by buyer, procedure type (`pirkimoBudas`), status, date, value, CPV                                     |
| `get_viesasis_pirkimas`       | Full single-procurement record with technical specification files                                                                        |
| `get_pinreg_jar`              | PINREG private-interest declarations for a company (directors, shareholders, spouses)                                                    |
| `get_pinreg_asmuo`            | PINREG declarations for a named individual across all their employer and company links                                                   |
| `search_failai`               | Search uploaded procurement documents by filename or procurement ID                                                                      |
| `get_failas`                  | Fetch file metadata by numeric ID or MD5 hash                                                                                            |
| `get_failas_tekstas`          | Read OCR-extracted full text of a procurement document                                                                                   |
| `execute_query` | Run a validated read-only SQL SELECT against the database — analytical backbone for **all themes**                                       |

### Views available inside `execute_query`

Prefer views over raw tables. Call `get_schema` to confirm column names.

| View             | Wraps                                                                                        | Key added columns                                                                                                                                                     | Themes                     |
|------------------|----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------|
| `v_company`      | `jarCsv` + `sodra` (LATERAL) + compliance EXISTS flags                                       | `draustieji`, `vidutinasDarboUzmokestis`, `melagingiTiekejai`, `nepatikimiTiekejai`, `vdiPazeidimaiFlag`, `bylosKiekis`, `domenaiKiekis`, `neskelbiamosDerybosKiekis` | 1, 5–7, 9–12               |
| `v_sutartys`     | `sutartys` + `jarCsv` ×2                                                                     | `pirkejas`, `tiekejas`, `pirkejoKodas`, `tiekejoKodas` (names resolved)                                                                                               | 1–3, 5–8, 13, 15–16, 18–20 |
| `v_pirkimas`     | `viesiejiPirkimai` + `viesiejiPirkimaiVykdytojai`                                            | `vykdytojoPavadinimas`, `savivaldybe`, `shortCode`, `verteEur`                                                                                                        | 5–7, 20                    |
| `v_person_links` | `pinregJuridiniaiRysiai` + `jarCsv`                                                          | `imonesVardas`, `registruotaLietuvoje`, `yraJuridinisAsmuo`                                                                                                           | 4, 10–11, 13, 19           |
| `v_dalyviai`     | `atn1ataskaitos` + `atn1dalyviai` + `atn1pasiulymuEile` + `atn1atmestiPasiulymai` + `jarCsv` | `pasiulymoKaina` (cast to numeric), `eileNumeris`, `atmetimoPriezastis`, `tiekejas`                                                                                   | 2–3, 14, 17                |
| `v_bylos`        | `bylosDalyviai` + `bylos` + `jarCsv`                                                         | `bylosRusis`, `teismas`, `bylojeKaip`, `pavadinimas`                                                                                                                  | 9                          |

**Raw tables used directly** (no view wrapper exists or view would be counterproductive):
`pinregJuridiniaiRysiai` — themes 13, 19 (revolving-door date-range CTEs need raw access) ·
`jarCsv` — theme 16 (address self-join; `v_company` LATERAL sodra join would be extremely expensive here) ·
`domenai` — themes 11, 16 (domain pair self-join) ·
`cpvaProjektuSutartys` — theme 12 (CPVA subcontractor data) ·
`neskelbiamosDerybos` — theme 20 (audit findings, single-table lookup)

---

## Supported investigator questions

These themes are fully answerable with current data. All queries run without errors and hit appropriate indexes.

---

### 1. Shell company / capacity mismatch

> *"This company keeps winning large road contracts but they only have a handful of employees."*

**Recommended MCP calls:**

- `get_juridinis` — single call returns Sodra headcount, average salary, social tax, VDI violations, and recent
  contracts; increase `sutartysLimit` to see the full award history
- `execute_query` — query `v_company` for aggregate capacity metrics (headcount vs. total contract value
  ratio); query `v_sutartys` to sum contract values by year for the supplier
- `search_sutartys` — list all contracts for a supplier code filtered by date and value range as a quick first pass

- How many employees does this supplier have, and how does that compare to their total contract value this year?
- When was the company registered? Did it start winning contracts within months of registration?
- What is the ratio of declared Sodra wages to total contract revenue? Could they actually deliver this work?
- Does the company's registered address appear on many other companies?
- Has the company ever declared any fixed assets or significant revenue in financial reports?

---

### 2. Bid rigging — cover bidding and bid suppression

> *"I have a feeling the same companies keep showing up as losers in every tender this supplier wins."*

**Recommended MCP calls:**

- `execute_query` — primary tool; query `v_dalyviai` to get all bid participations, amounts (
  `pasiulymoKaina`), and rank (`eileNumeris`) for a company or procurement; calculate win rate, co-bidder frequency, and
  bid-price clustering
- `search_sutartys` — find the contracts a supplier won to seed the procurement numbers before writing aggregate
  `v_dalyviai` queries

- What is this company's win rate across all procurements they participated in?
- Who are the most frequent co-bidders, and how often do they bid higher than the winner?
- Do the losing bids cluster just above the winning bid, or are they spread randomly?
- Are there procurements where only one or two companies ever participate?
- Is the average number of bidders in this company's procurements lower than the national average for the same CPV
  category?

---

### 3. Bid rotation / carousel

> *"I think these three companies take turns winning — each one wins for a while, then steps back."*

**Recommended MCP calls:**

- `execute_query` — query `v_dalyviai` grouped by `"tiekejoKodas"` and year to detect alternating win
  windows within a CPV category; query `v_sutartys` to aggregate total contract value per company per period
- `search_sutartys` — identify the set of contracts and CPV codes to investigate before writing aggregate queries

- Over the past five years, how is the total contract value split between these companies within the same CPV
  category?
- Is there a pattern where company A wins in one period and company B wins in another, with minimal overlap?
- Do these companies ever bid against each other, or do they consistently appear in separate tenders?
- When company A is the winner, do companies B and C appear as cover bidders, and vice versa?

---

### 4. Conflict of interest — shared people between buyer and seller

> *"The procurement officer and the winning supplier's director might know each other."*

**Recommended MCP calls:**

- `get_pinreg_jar` — retrieve PINREG declarations for both the buyer organisation and the winning supplier (declared
  workplaces, shareholders, spouse workplaces)
- `get_pinreg_asmuo` — look up a named individual to trace their full employment and company-link history across all
  declarations
- `execute_query` — query `v_person_links` to find shared declared persons between any set of company JAR
  codes; filter `irasoTipas = 'SUTUOKTINIO_DARBOVIETE'` to surface spouse links

- Are any people declared in PINREG as working for the buying organisation also linked to the winning supplier?
- Do any directors or shareholders of the winning supplier have a spouse or family member employed by the buyer?
- Has the same individual appeared in interest declarations for both the contracting authority and a supplier that
  won contracts from that authority?
- Are there common persons in the ownership chains of companies that both bid and buy from each other?

---

### 5. Contract splitting to avoid thresholds

> *"This buyer keeps awarding lots of small contracts to the same supplier — I think they're avoiding the open
> tender threshold."*

**Recommended MCP calls:**

- `search_sutartys` — filter by `perkanciosiosOrganizacijosKodas` + `tiekejoKodas` + date range to list all contracts in
  a buyer–supplier pair; sort by `sudarymoData` to inspect temporal clustering
- `execute_query` — query `v_sutartys` to count and sum contracts by value bracket (< €30K, < €58K, <
  €145K) to detect threshold-hugging clusters; compute days between consecutive awards for the same supplier

- How many contracts has this buyer awarded to this supplier in the past 12 months, and what are their individual
  values?
- Are there clusters of contracts just below the simplified procurement threshold (€30K) or the open procedure
  threshold?
- What is the time gap between consecutive contracts to the same supplier? Are they awarded days apart?
- Does the same contract description (or CPV code) recur across many small awards?

---

### 6. Geographic monopoly / local capture

> *"Every road repair contract in this municipality goes to the same company, year after year."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` filtered by `"pirkejoKodas"` to calculate each supplier's share of
  total municipal procurement value; query `v_pirkimas` for the municipality's procedure distribution by `savivaldybe`
- `search_sutartys` — list contracts for a buyer municipality to identify dominant suppliers at a glance
- `get_juridinis` — profile the dominant supplier (headcount, registration date, address) and check whether competing
  suppliers in the same region are active

- What share of total procurement value in this municipality was awarded to this single supplier over the past
  three years?
- Are there other suppliers in the same region and CPV category who never win, or who stopped bidding?
- Is the contracting authority exclusively issuing contracts to locally registered companies?
- Do procurement officers at this authority have declared connections to local suppliers?

---

### 7. Procedure manipulation — unjustified direct award

> *"This authority almost never uses open tenders — everything goes through negotiated procedure without
> publication."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` grouped by `tipas` per buyer to compute open-vs-direct ratio; query
  raw `neskelbiamosDerybos` for audit findings on unjustified direct awards for that buyer
- `search_viesieji_pirkimai` — filter by `pvJarKodas` (buyer code) and `pirkimoBudas` (e.g., `DERYBOS_BE_PASKELBIMO`) to
  list direct-award announcements
- `get_viesasis_pirkimas` — open a specific procurement to read its stated justification text

- What fraction of this buyer's contracts by value were awarded via direct negotiation vs open competition?
- Has this buyer's use of negotiated-without-publication procedure increased over time?
- Are the stated justifications for non-competitive procedures consistent, or do they recycle boilerplate reasons?
- Which suppliers benefit most from this buyer's non-competitive awards?

---

### 8. Price anomalies — over-invoicing and scope creep

> *"The contract was signed for €200K but the final execution value was €900K."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` comparing `"faktineIvykdimoVerte"` to `verte`; sort by overrun
  ratio to find worst cases; group by supplier or buyer to detect systematic patterns
- `get_sutartis` — fetch the full contract record including `dokumentai` JSONB to see attached amendment document names
- `search_sutartys` — narrow down contracts before writing aggregate queries (filter by supplier, buyer, CPV prefix,
  date)

- For this supplier, what is the average ratio of `faktineIvykdimoVerte` to `verte` across all contracts?
- Are there contracts where the final value exceeded the original by more than 50%?
- Do price overruns correlate with specific buyers, CPV categories, or procurement methods?
- Is there a pattern of low initial bids followed by large amendments — a classic low-ball-then-escalate pattern?

---

### 9. Compliance and blacklist cross-check

> *"I want to know if this company or its related parties have ever been flagged."*

**Recommended MCP calls:**

- `get_juridinis` — single call returns `melagingiTiekejai` and `nepatikimiTiekejai` blacklist flags, VDI violation
  count, and court case summaries; increase `teismoNuosprendziaiLimit` to see more cases
- `execute_query` — query `v_company` to batch-check compliance flags across multiple company codes; query
  `v_bylos` for full court case details including `bylosRusis` (case type) and `bylojeKaip` (defendant/plaintiff role)

- Is this company currently on the unreliable suppliers list or the false-declaration debarment list?
- Has this company ever been debarred, even if that debarment has since expired?
- Are any of this company's directors or shareholders linked to other companies that are blacklisted?
- Does this company have outstanding VDI (Labour Inspectorate) violations?
- Are there court cases where this company appears as a party?

---

### 10. Network — second-degree connections and corporate webs

> *"I want to understand who really controls this company and what else they're involved in."*

**Recommended MCP calls:**

- `get_pinreg_jar` — retrieve all PINREG-declared persons for a company (directors, shareholders, and their spouses)
- `get_pinreg_asmuo` — given a person's name, find every company they are linked to; repeat for each discovered person
  to traverse the network
- `execute_query` — query `v_person_links` to map the corporate web programmatically; query `v_company`
  for contract counts and compliance flags for each discovered node
- `search_juridiniai` — look up companies by name when you have a name but not a JAR code
- `get_juridinis` — deep-dive a specific network node (shared address, domain registrations, court cases)

- Who are the current directors and shareholders of this company according to PINREG declarations?
- What other companies are those people connected to — as directors, shareholders, or via a spouse?
- Do any of those second-degree companies also hold government contracts?
- Is there a cluster of companies sharing the same address, phone, or domain that all bid in the same tenders?
- Has the ownership structure changed significantly in the period just before or after a large contract award?

---

### 11. UBO risk — beneficial ownership through holding layers

> *"These two companies bid against each other every time, but I suspect the same person controls both through a shell
holding company."*

**Recommended MCP calls:**

- `execute_query` — query `v_person_links` to find shared declared persons across a cluster of `jarKodas`
  values; filter `registruotaLietuvoje = false` to flag foreign entities that cannot be traced further; query raw
  `domenai` for shared domain registrants
- `get_pinreg_jar` — pull full PINREG declarations for each bidder to manually cross-reference directors and
  shareholders
- `get_juridinis` — check domain registrations and court case history for each company in the bidder cluster

**What the system can answer with current data:**

- Who is directly declared as director or shareholder of each bidder via PINREG?
- Do any of the same people appear in both companies — including via a spouse (`SUTUOKTINIO_DARBOVIETE`)?
- Do any of the co-bidders share a domain registrant, address, or court case history that suggests common ownership?

```sql
-- Shared declared persons across a set of competing bidders
WITH bidders AS (SELECT unnest(ARRAY['304567890','301234567','309876543']) AS jar)
SELECT p1."jarKodas"     AS company_a,
       p1."imonesVardas" AS company_a_name,
       p2."jarKodas"     AS company_b,
       p2."imonesVardas" AS company_b_name,
       p1.vardas,
       p1.pavarde,
       p1."irasoTipas"   AS role_a,
       p2."irasoTipas"   AS role_b,
       p1."rysioPradzia",
       p1."rysioPabaiga"
FROM v_person_links p1
         JOIN v_person_links p2
              ON p1.vardas = p2.vardas
                  AND p1.pavarde = p2.pavarde
                  AND p1."jarKodas" < p2."jarKodas"
WHERE p1."jarKodas" IN (SELECT jar FROM bidders)
  AND p2."jarKodas" IN (SELECT jar FROM bidders);
```

```sql
-- Shared domain registrant across the same company set
SELECT d1."savininkoKodas" AS company_a,
       j1.pavadinimas      AS company_a_name,
       d2."savininkoKodas" AS company_b,
       j2.pavadinimas      AS company_b_name,
       d1.domain
FROM domenai d1
         JOIN domenai d2
              ON d1.domain = d2.domain
                  AND d1."savininkoKodas" < d2."savininkoKodas"
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1."savininkoKodas"
JOIN "jarCsv" j2
ON j2."jarKodas":: text = d2."savininkoKodas"
WHERE d1."savininkoKodas" IN ('304567890', '301234567', '309876543');
```

**What is currently missing — the multi-layer ownership blind spot:**

The system only traverses **one hop**: declared person → company. A sophisticated actor routes control through an
intermediate holding company:

```
Jonas Jonaitis (person)
  └─► UAB HoldCo LT (intermediate, LT registered)
        ├─► UAB Greitas Statyba   (bidder A)  ← appears to be independent
        └─► UAB Kelių Draugai     (bidder B)  ← appears to be independent
```

If Jonas appears only in HoldCo's PINREG declaration and not at either bidder, the queries return **zero rows** — a
false negative.

**What would be needed to close this gap:**

| Requirement                                 | Status      | Notes                                                                                           |
|---------------------------------------------|-------------|-------------------------------------------------------------------------------------------------|
| Company-owns-company table with ownership % | ❌ Missing   | Would need JAR registry export or a commercial UBO database (OpenCorporates, Orbis)             |
| `WITH RECURSIVE` CTE traversal              | ✅ Available | Guardrail stack already allows it; max depth 5                                                  |
| 25% threshold filter (EU AML standard)      | ❌ No data   | Requires ownership share column, not just a link                                                |
| Foreign holding company resolution          | ❌ No data   | `registruotaLietuvoje = false` flag exists in `v_person_links` but the chain is not traversable |
| JAR historical ownership snapshots          | ❌ Missing   | Would catch structures created just before a tender and dissolved after award                   |

**Interim mitigation available today:**

When `registruotaLietuvoje = false` appears for a person-company link, flag it explicitly — it signals a foreign entity
in the chain that cannot be traced further. This is not a solution, but it surfaces the opacity for a human analyst to
escalate.

```sql
-- Flag any foreign or opaque links in the person-company graph for the bidder cluster
SELECT "jarKodas",
       "imonesVardas",
       vardas,
       pavarde,
       "irasoTipas",
       "registruotaLietuvoje",
       "yraJuridinisAsmuo"
FROM v_person_links
WHERE "jarKodas" IN ('304567890', '301234567', '309876543')
  AND ("registruotaLietuvoje" = false OR "yraJuridinisAsmuo" = true)
ORDER BY "jarKodas", pavarde;
```

---

### 12. EU Structural Funds abuse — fictitious subcontractors and inflated costs

> *"This company won a CPVA-funded project worth €2M but they have 4 employees and the subcontractor they declared has
zero Sodra payments."*

**Recommended MCP calls:**

- `execute_query` — query raw `cpvaProjektuSutartys` (no view wrapper exists) with LATERAL joins to
  `sodra` for headcount; group by contractor–subcontractor pair to detect recurring related-party arrangements
- `get_juridinis` — verify Sodra headcount and wage data for specific main contractors or subcontractors by JAR code
- `get_pinreg_jar` — check whether the main contractor and subcontractor share declared directors or shareholders

- Which CPVA-funded contracts name a subcontractor, and how many employees does that subcontractor actually have
  according to Sodra?
- Is the main contractor's Sodra headcount consistent with the contract scope, or are they clearly a pass-through?
- Does the subcontractor appear in other CPVA contracts with the same main contractor — suggesting a recurring
  related-party arrangement?
- Are both the winner and subcontractor linked via shared directors or shareholders in PINREG?

```sql
-- Subcontractor headcount cross-check on CPVA contracts
SELECT cs."projektoNr",
       cs."projektoPavadinimas",
       cs."tiekejoKodas",
       cs."tiekejoPavadinimasVardasIrPavardeGimimoData"    AS tiekejas,
       cs."pirkimoSutartiesSumaSusijusiSuProjektu"         AS suma,
       cs."subtiekejoKodas",
       cs."subtiekejoPavadinimasVardasIrPavardeGimimoData" AS subtiekejasVardas,
       s_main.draustieji                                   AS "tiekejoDarbuotojai",
       s_sub.draustieji                                    AS "subtiekejoDarbuotojai"
FROM "cpvaProjektuSutartys" cs
         LEFT JOIN LATERAL(
    SELECT draustieji FROM sodra
    WHERE "jarKodas" = cs."tiekejoKodas"
    ORDER BY data DESC NULLS LAST LIMIT 1
) s_main ON true
         LEFT JOIN LATERAL(
    SELECT draustieji FROM sodra
    WHERE "jarKodas" = cs."subtiekejoKodas"
    ORDER BY data DESC NULLS LAST LIMIT 1
) s_sub ON true
WHERE cs."subtiekejoKodas" IS NOT NULL
  AND cs."subtiekejoKodas" != ''
ORDER BY cs."pirkimoSutartiesSumaSusijusiSuProjektu" DESC
LIMIT 200;
```

```sql
-- Recurring main contractor + subcontractor pairs across multiple CPVA projects
SELECT cs."tiekejoKodas",
       cs."tiekejoPavadinimasVardasIrPavardeGimimoData"        AS tiekejas,
       cs."subtiekejoKodas",
       cs."subtiekejoPavadinimasVardasIrPavardeGimimoData"     AS subtiekejasVardas,
       COUNT(DISTINCT cs."projektoNr")                         AS projektu_sk,
       ROUND(SUM(cs."pirkimoSutartiesSumaSusijusiSuProjektu")) AS bendra_suma
FROM "cpvaProjektuSutartys" cs
WHERE cs."subtiekejoKodas" IS NOT NULL
  AND cs."subtiekejoKodas" != ''
GROUP BY cs."tiekejoKodas", cs."tiekejoPavadinimasVardasIrPavardeGimimoData",
         cs."subtiekejoKodas", cs."subtiekejoPavadinimasVardasIrPavardeGimimoData"
HAVING COUNT(DISTINCT cs."projektoNr") >= 2
ORDER BY projektu_sk DESC
LIMIT 200;
```

---

### 13. Revolving door — procurement officer joins winning supplier

> *"The head of procurement at this municipality left last year. I want to know if she now works for any company that
won contracts there while she was in charge."*

**Recommended MCP calls:**

- `execute_query` — query raw `pinregJuridiniaiRysiai` (use raw table, not `v_person_links` — the
  revolving-door date-range self-join pattern requires raw access) joined to `v_sutartys` to find people who left a
  buyer org and joined a supplier within 2 years; count post-transition contracts
- `get_pinreg_asmuo` — look up a specific named individual to trace their employment timeline across all organisations
- `get_pinreg_jar` — retrieve the full declared staff list for a buyer or supplier to identify transition candidates

- Which people held roles at a buying organisation and subsequently appear in PINREG at a supplier that won contracts
  from that same buyer?
- How quickly did they move — days, months?
- Did that supplier's win rate or contract value at the buyer change after the person joined?

```sql
-- People who left a buyer org and joined a supplier within 2 years
WITH buyer_staff AS (SELECT r.vardas,
                            r.pavarde,
                            r."jarKodas"     AS "pirkejoKodas",
                            r."rysioPabaiga" AS "isejoData"
                     FROM "pinregJuridiniaiRysiai" r
                     WHERE r."darbovietesTipas" = 'STANDARTINE'
                       AND r."irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
                       AND r."rysioPabaiga" IS NOT NULL
                       AND r."jarKodas" IN (SELECT DISTINCT "pirkejoKodas" FROM v_sutartys)),
     supplier_staff AS (SELECT r.vardas,
                               r.pavarde,
                               r."jarKodas"     AS "tiekejoKodas",
                               r."rysioPradzia" AS "atejoData"
                        FROM "pinregJuridiniaiRysiai" r
                        WHERE r."darbovietesTipas" = 'STANDARTINE'
                          AND r."irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
                          AND r."rysioPradzia" IS NOT NULL)
SELECT b.vardas,
       b.pavarde,
       b."pirkejoKodas",
       b."isejoData",
       s."tiekejoKodas",
       s."atejoData",
       (s."atejoData" - b."isejoData")         AS "dienuSkaicius",
       (SELECT COUNT(*)
        FROM v_sutartys
        WHERE "pirkejoKodas" = b."pirkejoKodas"
          AND "tiekejoKodas" = s."tiekejoKodas"
          AND "sudarymoData" >= b."isejoData") AS "sutartysPoPerejimo"
FROM buyer_staff b
         JOIN supplier_staff s
              ON s.vardas = b.vardas
                  AND s.pavarde = b.pavarde
                  AND s."atejoData" > b."isejoData"
                  AND (s."atejoData" - b."isejoData") < 730
                  AND b."pirkejoKodas" != s."tiekejoKodas"
ORDER BY "dienuSkaicius"
LIMIT 200;
```

---

### 14. Spec rigging — technical specifications written for one supplier

> *"Every tender this department publishes in this category ends up with only one bidder. I think the specs are written
to exclude everyone else."*

**Recommended MCP calls:**

- `execute_query` — primary tool; query `v_dalyviai` to calculate single-bidder rates per buyer per CPV
  vs. the national average; identify which suppliers dominate single-bidder awards
- `search_viesieji_pirkimai` — find specific procurement announcements for the suspect buyer and CPV category
- `get_viesasis_pirkimas` — open a procurement record to access its technical specification files
- `search_failai` — find specification documents uploaded to a procurement
- `get_failas_tekstas` — read OCR-extracted text of specification documents to detect supplier-specific or exclusionary
  wording

- What fraction of a buyer's tenders in a given CPV category receive only one bid, compared to the national average for
  that same CPV?
- Which suppliers consistently win those single-bidder tenders?
- Is the single-bidder rate significantly higher than peers buying in the same category?

```sql
-- Buyers whose single-bidder rate per CPV is more than 2× the national average (min 5 tenders)
WITH per_procurement AS (SELECT "pirkimoNumeris",
                                "pagrindinisKodasBvpz"         AS cpv,
                                "pirkejoKodas",
                                COUNT(DISTINCT "tiekejoKodas") AS dalyviu_sk
                         FROM v_dalyviai
                         WHERE "pagrindinisKodasBvpz" IS NOT NULL
                         GROUP BY "pirkimoNumeris", "pagrindinisKodasBvpz", "pirkejoKodas"),
     cpv_national AS (SELECT cpv,
                             COUNT(DISTINCT "pirkimoNumeris")                               AS total_pirkimai,
                             COUNT(DISTINCT "pirkimoNumeris") FILTER (WHERE dalyviu_sk = 1) AS single_bidder_cnt
                      FROM per_procurement
                      GROUP BY cpv),
     buyer_cpv AS (SELECT "pirkejoKodas",
                          cpv,
                          COUNT(DISTINCT "pirkimoNumeris")                               AS pirkimai,
                          COUNT(DISTINCT "pirkimoNumeris") FILTER (WHERE dalyviu_sk = 1) AS single_bidder
                   FROM per_procurement
                   GROUP BY "pirkejoKodas", cpv)
SELECT bc."pirkejoKodas",
       bc.cpv,
       bc.pirkimai,
       bc.single_bidder,
       ROUND(bc.single_bidder::numeric / NULLIF(bc.pirkimai, 0), 2)            AS "pirkejoVienbidiskumas",
       ROUND(cn.single_bidder_cnt ::numeric / NULLIF(cn.total_pirkimai, 0), 2) AS "cpvSaliesVidurkis"
FROM buyer_cpv bc
         JOIN cpv_national cn ON cn.cpv = bc.cpv
WHERE bc.pirkimai >= 5
  AND (bc.single_bidder::numeric / NULLIF(bc.pirkimai, 0))
    > (cn.single_bidder_cnt::numeric / NULLIF(cn.total_pirkimai, 0)) * 2
ORDER BY "pirkejoVienbidiskumas" DESC
LIMIT 200;
```

---

### 15. Framework agreement abuse — single-supplier call-offs

> *"This buyer set up a framework agreement three years ago and has been calling off contracts from it ever since, but
always to the same one company."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` filtered on `tipas = 'PPS'` grouped by `"pirkimoNumeris"` to count
  distinct suppliers and total value; a single-supplier framework with many call-offs is the key red flag
- `search_sutartys` — filter by `tipas = 'PPS'` and `perkanciosiosOrganizacijosKodas` to list call-off contracts for a
  buyer
- `get_sutartis` — inspect individual call-off contracts for procedure and document details

- How many distinct suppliers appear across all call-off contracts (`tipas = 'PPS'`) linked to a given framework
  procurement number?
- What is the total value channelled through the framework, and over how many years?
- Did the buyer run a competitive open tender to establish the framework in the first place, or was it a direct award?

```sql
-- Frameworks where 100% of call-offs went to a single supplier, ranked by total value
SELECT "pirkimoNumeris",
       COUNT(*)                       AS uzsakymuSkaicius,
       COUNT(DISTINCT "tiekejoKodas") AS tiekejuSkaicius,
       ROUND(SUM(verte))              AS bendra_verte,
       MIN("sudarymoData")            AS pirmas_uzsakymas,
       MAX("sudarymoData")            AS paskutinis_uzsakymas,
       MAX(tiekejas)                  AS tiekejas,
       MAX("pirkejoKodas")            AS "pirkejoKodas"
FROM v_sutartys
WHERE tipas = 'PPS'
  AND "pirkimoNumeris" IS NOT NULL
GROUP BY "pirkimoNumeris"
HAVING COUNT(DISTINCT "tiekejoKodas") = 1
   AND COUNT(*) >= 5
ORDER BY bendra_verte DESC
LIMIT 200;
```

---

### 16. Shared back-office — competing companies with the same address or domain

> *"I keep seeing the same two companies bidding against each other, but they're registered at exactly the same street
address."*

**Recommended MCP calls:**

- `execute_query` — query raw `jarCsv` self-joined on `adresas` (use raw table, not `v_company` — the
  LATERAL Sodra join in `v_company` makes a self-join prohibitively expensive); cross-reference with `v_sutartys` for
  contract counts; query raw `domenai` self-joined on `domain` for shared registrants
- `get_juridinis` — verify registered address and domain registrations for specific companies in the candidate pair
- `search_juridiniai` — find companies sharing an address fragment or operating in the same area

- Do any of the co-bidders in a cluster share a registered legal address in the company registry?
- Do any of them share a domain registrant in the WHOIS/`domenai` table?
- How many government contracts has each of those companies won, and do their contract timelines overlap in a way
  that suggests coordination?

```sql
-- Active companies sharing a registered address that have both won government contracts
WITH candidate_pairs AS (SELECT a."jarKodas"::text AS jar_a, b."jarKodas"::text AS jar_b, a.adresas
                         FROM "jarCsv" a
                                  JOIN "jarCsv" b
                                       ON b.adresas = a.adresas
                                           AND b."jarKodas" > a."jarKodas"
                         WHERE a.adresas IS NOT NULL
                           AND LENGTH(a.adresas) > 10
                           AND a."statusoKodas" = 1
                           AND b."statusoKodas" = 1)
SELECT cp.adresas,
       cp.jar_a,
       ja.pavadinimas                                                    AS pav_a,
       cp.jar_b,
       jb.pavadinimas                                                    AS pav_b,
       (SELECT COUNT(*) FROM v_sutartys WHERE "tiekejoKodas" = cp.jar_a) AS sutartys_a,
       (SELECT COUNT(*) FROM v_sutartys WHERE "tiekejoKodas" = cp.jar_b) AS sutartys_b
FROM candidate_pairs cp
         JOIN "jarCsv" ja ON ja."jarKodas"::text = cp.jar_a
JOIN "jarCsv" jb
ON jb."jarKodas":: text = cp.jar_b
WHERE EXISTS (SELECT 1 FROM v_sutartys WHERE "tiekejoKodas" = cp.jar_a)
  AND EXISTS (SELECT 1 FROM v_sutartys WHERE "tiekejoKodas" = cp.jar_b)
LIMIT 200;
```

```sql
-- Competing companies sharing a domain registrant
SELECT d1."savininkoKodas" AS jar_a,
       j1.pavadinimas      AS pav_a,
       d2."savininkoKodas" AS jar_b,
       j2.pavadinimas      AS pav_b,
       d1.domain
FROM domenai d1
         JOIN domenai d2
              ON d1.domain = d2.domain
                  AND d1."savininkoKodas" < d2."savininkoKodas"
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1."savininkoKodas"
JOIN "jarCsv" j2
ON j2."jarKodas":: text = d2."savininkoKodas"
WHERE EXISTS (SELECT 1 FROM v_sutartys WHERE "tiekejoKodas" = d1."savininkoKodas")
  AND EXISTS (SELECT 1 FROM v_sutartys WHERE "tiekejoKodas" = d2."savininkoKodas")
LIMIT 200;
```

---

### 17. Price cartel — suspiciously uniform bid prices across a CPV category

> *"All the bids in this sector feel like they came from the same spreadsheet — the prices are almost identical across
completely unrelated tenders."*

**Recommended MCP calls:**

- `execute_query` — sole analytical tool for this theme; query `v_dalyviai` to compute the coefficient of
  variation (STDDEV / AVG) of `pasiulymoKaina` per CPV category; `pasiulymoKaina` is already cast to numeric in the
  view — no regex needed; follow up by listing the specific suppliers in flagged low-variation categories

- In a given CPV category, is the coefficient of variation of submitted bid prices abnormally low, suggesting
  coordination?
- Which suppliers appear repeatedly in low-variation CPV categories?
- Do the same companies cluster together across multiple such categories?

```sql
-- CPV categories with suspiciously low price variation (coefficient of variation < 5%)
WITH cpv_bids AS (SELECT "pagrindinisKodasBvpz" AS cpv,
                         "pasiulymoKaina"       AS kaina,
                         "pirkimoNumeris",
                         "tiekejoKodas"
                  FROM v_dalyviai
                  WHERE "pagrindinisKodasBvpz" IS NOT NULL
                    AND "pasiulymoKaina" IS NOT NULL)
SELECT cpv,
       COUNT(*)                                              AS pasiulymu_sk,
       ROUND(AVG(kaina))                                     AS vidurkis,
       ROUND(STDDEV(kaina))                                  AS std,
       ROUND(STDDEV(kaina) / NULLIF(AVG(kaina), 0) * 100, 1) AS cv_proc
FROM cpv_bids
GROUP BY cpv
HAVING COUNT(*) >= 10
   AND STDDEV(kaina) / NULLIF(AVG(kaina), 0) < 0.05
ORDER BY cv_proc ASC
LIMIT 200;
```

---

## Not yet fully supported investigator questions

These themes have partial data support — useful queries exist but a data sourcing gap prevents complete answers.
Themes 21–22 have no data support at all.

---

### 18. Contract amendment escalation — low bid, then value inflated through amendments

> *"They won with a suspiciously low bid and then the contract value tripled through amendments. I want to see which
contracts had the biggest gap between the signed price and the final invoiced amount."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` filtering `"faktineIvykdimoVerte" IS NOT NULL AND verte > 0` sorted
  by overrun ratio; group by supplier or buyer to detect systematic patterns; the amendment trail itself is a data gap (
  see below)
- `get_sutartis` — fetch the full contract record including `dokumentai` JSONB to inspect names of attached amendment
  documents
- `search_failai` — find amendment documents attached to a specific contract
- `get_failas_tekstas` — read amendment document text for narrative context

- What is the ratio of `faktineIvykdimoVerte` (actual final value) to `verte` (originally signed value) across a
  supplier's contracts?
- Which buyers tolerate the highest amendment overruns?
- Are there patterns where a supplier consistently under-bids relative to what they ultimately collect?

```sql
-- Suppliers with highest median amendment overrun ratio (min 5 contracts, overrun > 50%)
SELECT "tiekejoKodas",
       MAX(tiekejas)                                            AS tiekejas,
       COUNT(*)                                                 AS sutarciu_sk,
       ROUND(AVG("faktineIvykdimoVerte" / NULLIF(verte, 0)), 2) AS vid_koef,
       ROUND(MAX("faktineIvykdimoVerte" / NULLIF(verte, 0)), 2) AS max_koef,
       ROUND(SUM("faktineIvykdimoVerte" - verte))               AS bendra_pervirsis
FROM v_sutartys
WHERE "faktineIvykdimoVerte" IS NOT NULL
  AND verte > 0
  AND istrinta IS NOT TRUE
GROUP BY "tiekejoKodas"
HAVING COUNT(*) >= 5
   AND AVG("faktineIvykdimoVerte" / NULLIF(verte, 0)) > 1.5
ORDER BY vid_koef DESC
LIMIT 200;
```

**What is currently missing:**

The system captures the **end result** (`faktineIvykdimoVerte` / `verte`) but not the amendment trail itself. The
`dokumentai` JSONB column contains attached document names but is not structured amendment history. To fully answer
this question the schema would need:

- A separate amendments table with: amendment date, amendment reason, value delta, approval authority
- Or structured parsing of the `dokumentai` JSONB to extract amendment documents and their dates

This is a data sourcing gap — the amendment sequence is published on the CVP IS portal but is not currently ingested.

---

### 19. Municipal company favoritism — buyer awards contracts to its own subsidiary

> *"This municipality keeps awarding contracts to a company that is effectively owned by the municipality itself,
bypassing competition."*

**Recommended MCP calls:**

- `execute_query` — query raw `pinregJuridiniaiRysiai` joined to `v_sutartys` to find buyer–supplier pairs
  sharing declared persons; this is the best available proxy for formal municipal ownership (see limitations below)
- `get_pinreg_jar` — retrieve PINREG declarations for both the municipality (buyer) and the suspected subsidiary (
  supplier) to compare named individuals
- `search_sutartys` — confirm contract volume between the buyer and supplier before running aggregate analysis

- What fraction of a municipality's contracts by value go to companies where the municipality is a declared shareholder
  or founder?
- Does that company win through competitive procedures, or mostly direct awards and framework call-offs?

```sql
-- Contracts where buyer and supplier share declared persons (proxy for municipal subsidiary link)
WITH buyer_persons AS (SELECT "jarKodas", vardas, pavarde
                       FROM "pinregJuridiniaiRysiai"
                       WHERE "darbovietesTipas" = 'STANDARTINE'
                         AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'),
     supplier_persons AS (SELECT "jarKodas", vardas, pavarde
                          FROM "pinregJuridiniaiRysiai"
                          WHERE "darbovietesTipas" = 'STANDARTINE'
                            AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE')
SELECT s."pirkejoKodas",
       s."tiekejoKodas",
       MAX(s.tiekejas)                              AS tiekejas,
       COUNT(DISTINCT s."sutartiesUnikalusId")      AS sutarciu_sk,
       ROUND(SUM(s.verte))                          AS bendra_verte,
       STRING_AGG(DISTINCT bp.vardas || ' ' || bp.pavarde, ', '
           ORDER BY bp.vardas || ' ' || bp.pavarde) AS bendri_asmenys
FROM v_sutartys s
         JOIN buyer_persons bp ON bp."jarKodas" = s."pirkejoKodas"
         JOIN supplier_persons sp ON sp."jarKodas" = s."tiekejoKodas"
    AND sp.vardas = bp.vardas AND sp.pavarde = bp.pavarde
WHERE s.istrinta IS NOT TRUE
GROUP BY s."pirkejoKodas", s."tiekejoKodas"
HAVING COUNT(DISTINCT s."sutartiesUnikalusId") >= 3
ORDER BY bendra_verte DESC
LIMIT 200;
```

**What is currently missing:**

The query detects shared *declared people* as a proxy — it catches cases where a municipal official sits on both the
buyer board and the supplier board. It does **not** detect formal ownership: a municipality holding a 51% stake does
not appear in PINREG unless an individual official made a personal declaration. True detection requires:

- A company-owns-company ownership table sourced from JAR registry (ownership share, owner type `SAVIVALDYBĖ`)
- Or a dedicated feed of municipal-owned enterprise registrations

---

### 20. Restricted procedure manipulation — buyer hand-picks the same invitees

> *"This buyer uses restricted tenders where they get to choose who receives an invitation, and I'm pretty sure the same
companies get invited every single time."*

**Recommended MCP calls:**

- `execute_query` — query `v_sutartys` grouped by `tipas` per buyer to compute procedure mix (open vs.
  restricted vs. direct); query raw `neskelbiamosDerybos` filtered by `"jarKodas"` to retrieve audit findings on
  unjustified direct awards
- `search_viesieji_pirkimai` — filter by `pvJarKodas` (buyer code) and `pirkimoBudas` (e.g., `RIBOTAS`,
  `DERYBOS_BE_PASKELBIMO`) to list restricted and negotiated announcements
- `get_viesasis_pirkimas` — open a specific procurement to read its stated justification for the non-competitive
  procedure

- How often does this buyer use restricted or negotiated procedures vs. open competition?
- What is the direct-award audit history from `neskelbiamosDerybos`?

```sql
-- Buyer's procedure mix: how much goes through restricted/negotiated vs. open
SELECT "pirkejoKodas",
       MAX(pirkejas)     AS pirkejas,
       tipas,
       COUNT(*)          AS sutarciu_sk,
       ROUND(SUM(verte)) AS bendra_verte
FROM v_sutartys
WHERE istrinta IS NOT TRUE
GROUP BY "pirkejoKodas", tipas
ORDER BY "pirkejoKodas", bendra_verte DESC
LIMIT 200;
```

```sql
-- Direct-award audit findings for a buyer (neskelbiamosDerybos)
SELECT nd."jarKodas",
       nd."jarPavadinimas",
       nd.data,
       nd.isvada,
       nd.aprasymas
FROM "neskelbiamosDerybos" nd
WHERE nd."jarKodas" = '123456789'
ORDER BY nd.data DESC
LIMIT 200;
```

**What is currently missing:**

`neskelbiamosDerybos` records audit findings about unjustified direct awards — useful signal. For restricted
procedures the system **cannot** identify which companies were invited but chose not to bid: `atn1dalyviai` only
records companies that submitted a bid, not the full invitation list. Detecting systematic exclusion of qualified
suppliers would require the invitation list data from CVP IS, which is not currently ingested.

---

### 21. Political connection favoritism — companies linked to party donors or politicians

> *"I have a hunch that this company's owners are close to the ruling party and that's why they keep winning."*

**MCP tool coverage:** ❌ No tools can answer this question — the database contains no political donation or party
membership data. This theme requires ingestion of a separate VRK (Central Electoral Commission) donor database.

**Not currently feasible.** The schema contains no political donation registry, no party membership data, and no
politician–company link table. Detection would require:

- Cross-referencing with the Central Electoral Commission (VRK) donor database
- Matching donor names to company directors/shareholders in PINREG by name + approximate date

This is a data sourcing gap. The VRK publishes donor data publicly; if ingested and name-matched against
`pinregJuridiniaiRysiai`, this theme becomes tractable.

---

### 22. Fictitious deliverables — contract marked complete but work never done

> *"The contract says it was executed in full, but the road they were paid to repair is in the same condition as before.
Is there any signal in the data?"*

**MCP tool coverage (limited signal only):**

- `get_juridinis` — check for VDI violations (`vdiPazeidimai`) during the contract execution period as an indirect
  signal of unavailable workforce
- `get_sutartis` — confirm `faktineIvykdimoVerte` is recorded (payment confirmed, but not proof of delivery); inspect
  `dokumentai` for acceptance documents
- `search_failai` + `get_failas_tekstas` — read delivery acceptance documents if attached to the contract

**Not currently feasible from structured data alone.** The `faktineIvykdimoVerte` field confirms payment was
recorded, not that delivery occurred. Detection would require:

- Field inspection records or satellite imagery analysis (e.g., road condition scoring)
- Invoice-level data from SABIS cross-referenced against delivery acceptance documents
- Complaint or audit trail data from STT or NKT

The closest available signal is a VDI labor violation (`vdiPazeidimai`) on the contractor during the contract
execution period — suggesting the workforce was unavailable — but this is weak and indirect.

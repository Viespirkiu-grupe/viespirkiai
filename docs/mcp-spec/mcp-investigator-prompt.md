# MCP Risk Intelligence Tool — Investigation Themes

## MCP Tool Quick Reference

### Available tools

Each section below references tools by ID only. Full descriptions:

- `get_schema`: Schema of all views and raw tables — call first when column names are uncertain
- `get_juridinis`: Full company profile (Sodra headcount/wages, contracts, PINREG, court cases, VDI, domains, ES
  investments)
- `search_juridiniai`: Search companies by name or code
- `search_sutartys`: Search contracts (buyer/supplier code, value, date range, CPV prefix, contract type)
- `get_sutartis`: Single-contract record with documents JSONB and ES project links
- `search_viesieji_pirkimai`: Procurement announcements (buyer, `pirkimoBudas`, status, date, value, CPV)
- `get_viesasis_pirkimas`: Single-procurement record with technical specification files
- `get_pinreg_jar`: PINREG declarations for a company (directors, shareholders, spouses)
- `get_pinreg_asmuo`: PINREG declarations for a named individual across all employer/company links
- `search_failai`: Search procurement documents by filename or procurement ID
- `get_failas`: File metadata by numeric ID or MD5 hash
- `get_failas_tekstas`: OCR-extracted full text of a procurement document
- `execute_investigation_query`: Read-only SQL SELECT — analytical backbone for **all themes**

### Views available inside `execute_investigation_query`

Prefer views to raw tables. Call `get_schema` to confirm column names.

- `v_company` [themes 1, 5–7, 9–12]: `jarCsv` + `sodra` (LATERAL) + compliance flags → `draustieji`,
  `vidutinasDarboUzmokestis`, `melagingiTiekejai`, `nepatikimiTiekejai`, `vdiPazeidimaiFlag`, `bylosKiekis`,
  `domenaiKiekis`, `neskelbiamosDerybosKiekis`
- `v_sutartys` [themes 1–3, 5–8, 13, 15–16, 18–20]: `sutartys` + `jarCsv` ×2 → `pirkejas`, `tiekejas`, `pirkejoKodas`,
  `tiekejoKodas` (names resolved)
- `v_pirkimas` [themes 5–7, 20]: `viesiejiPirkimai` + `viesiejiPirkimaiVykdytojai` → `vykdytojoPavadinimas`,
  `savivaldybe`, `shortCode`, `verteEur`
- `v_person_links` [themes 4, 10–11, 13, 19]: `pinregJuridiniaiRysiai` + `jarCsv` → `imonesVardas`,
  `registruotaLietuvoje`, `yraJuridinisAsmuo`
- `v_dalyviai` [themes 2–3, 14, 17]: `atn1ataskaitos` + `atn1dalyviai` + `atn1pasiulymuEile` + `atn1atmestiPasiulymai` +
  `jarCsv` → `pasiulymoKaina` (numeric), `eileNumeris`, `atmetimoPriezastis`, `tiekejas`
- `v_bylos` [theme 9]: `bylosDalyviai` + `bylos` + `jarCsv` → `bylosRusis`, `teismas`, `bylojeKaip`, `pavadinimas`

**Raw tables used directly** (no view wrapper exists or view would be counterproductive):
`pinregJuridiniaiRysiai` — themes 13, 19 (revolving-door date-range CTEs need raw access) ·
`jarCsv` — theme 16 (address self-join; `v_company` LATERAL sodra join would be extremely expensive here) ·
`domenai` — themes 11, 16 (domain pair self-join) ·
`cpvaProjektuSutartys` — theme 12 (CPVA subcontractor data) ·
`neskelbiamosDerybos` — theme 20 (audit findings, single-table lookup)

---

## Supported themes

### 1. Shell company / capacity mismatch

TOOLS: `get_juridinis`, `execute_investigation_query`, `search_sutartys`
GOAL: Detect capacity mismatch — supplier headcount/wages insufficient for contract scope
DETECT: headcount vs. total contract value · Sodra wages vs. revenue ratio · registration date vs. first win date ·
shared registered address count

### 2. Bid rigging — cover bidding and bid suppression

TOOLS: `execute_investigation_query`, `search_sutartys`
GOAL: Detect cover bidding — recurring losers always bidding just above winner
DETECT: win rate vs. participation count · top co-bidder frequency · losing bid clustering above winner · participation
count vs. CPV national average

### 3. Bid rotation / carousel

TOOLS: `execute_investigation_query`, `search_sutartys`
GOAL: Detect companies alternating wins in same CPV — never competing simultaneously
DETECT: win value share by period per CPV · mutual bidding absence · cross-appearance as cover bidders

### 4. Conflict of interest — shared people between buyer and seller

TOOLS: `get_pinreg_jar`, `get_pinreg_asmuo`, `execute_investigation_query`
GOAL: Find persons declared in both buyer and winning supplier PINREG records
DETECT: shared persons buyer↔supplier · spouse/family links · cross-declared interest declarations · ownership chain
overlap

### 5. Contract splitting to avoid thresholds

TOOLS: `search_sutartys`, `execute_investigation_query`
GOAL: Detect contract splitting below €30K or open-procedure threshold to avoid competition
DETECT: contract value clusters just below thresholds · same CPV recurring in small awards · short time gaps between
consecutive awards to same supplier

### 6. Geographic monopoly / local capture

TOOLS: `execute_investigation_query`, `search_sutartys`, `get_juridinis`
GOAL: Detect single-supplier dominance in one municipality or CPV category
DETECT: value share by supplier per municipality · competitors who stopped bidding · local registration bias ·
officer→supplier PINREG connections

### 7. Procedure manipulation — unjustified direct award

TOOLS: `execute_investigation_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`
GOAL: Detect overuse of negotiated-without-publication procedure
DETECT: direct-negotiation value share vs. open competition · trend over time · top beneficiary suppliers

### 8. Price anomalies — over-invoicing and scope creep

TOOLS: `execute_investigation_query`, `get_sutartis`, `search_sutartys`
GOAL: Detect contracts where faktineIvykdimoVerte significantly exceeds signed verte
DETECT: avg faktineIvykdimoVerte/verte ratio · overruns >50% · overrun correlation by buyer/CPV/procedure · low-bid then
inflate pattern

### 9. Compliance and blacklist cross-check

TOOLS: `get_juridinis`, `execute_investigation_query`
GOAL: Check all blacklists, sanctions, and violations for company and linked parties
DETECT: current/expired debarment (melagingiTiekejai, nepatikimiTiekejai) · VDI violations · court cases ·
linked-company blacklist status · supplier-as-claimant against former/current buyers (`bylojeKaip = 'IEŠKOVAS'`) —
signals litigation leverage to pressure buyers into continued contracting

### 10. Network — second-degree connections and corporate webs

TOOLS: `get_pinreg_jar`, `get_pinreg_asmuo`, `execute_investigation_query`, `search_juridiniai`, `get_juridinis`
GOAL: Map corporate control network beyond direct ownership
DETECT: directors/shareholders → second-degree companies → govt contracts · shared address/domain cluster · ownership
changes around contract award dates

### 11. UBO risk — beneficial ownership through holding layers

TOOLS: `execute_investigation_query`, `get_pinreg_jar`, `get_juridinis`
GOAL: Detect shared control of competing bidders through shared persons or back-office signals

ANSWERABLE NOW:

- Shared declared persons across bidder set (including spouse links via `SUTUOKTINIO_DARBOVIETE`)
- Shared domain registrant, address, or court history across co-bidders

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

GAP — multi-layer ownership:

One-hop only: person → company. Holding company intermediaries are invisible, e.g.:

```
Jonas Jonaitis (person)
  └─► UAB HoldCo LT (intermediate, LT registered)
        ├─► UAB Greitas Statyba   (bidder A)  ← appears to be independent
        └─► UAB Kelių Draugai     (bidder B)  ← appears to be independent
```

Returns zero rows — false negative.

- ❌ Company-owns-company table — needs JAR export or OpenCorporates/Orbis
- ✅ `WITH RECURSIVE` traversal (max depth 5, guardrail allows it)
- ❌ 25% threshold filter, foreign chain resolution, historical snapshots

MITIGATION: Flag `registruotaLietuvoje = false` — signals unresolvable foreign entity in chain.

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

### 12. EU Structural Funds abuse — fictitious subcontractors and inflated costs

TOOLS: `execute_investigation_query`, `get_juridinis`, `get_pinreg_jar`
GOAL: Detect fictitious subcontractors in CPVA-funded contracts
DETECT: subcontractor Sodra headcount · main contractor pass-through signal · recurring contractor+subcontractor pairs ·
shared PINREG persons between contractor and subcontractor

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

### 13. Revolving door — procurement officer joins winning supplier

TOOLS: `execute_investigation_query`, `get_pinreg_asmuo`, `get_pinreg_jar`
GOAL: Find buyer-side staff who moved to suppliers that won contracts from their former employer
DETECT: person left buyer org → joined supplier within 2 years · contracts awarded to that supplier after move

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

### 14. Spec rigging — technical specifications written for one supplier

TOOLS: `execute_investigation_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`, `search_failai`,
`get_failas_tekstas`
GOAL: Detect buyers with abnormally high single-bidder rate in a CPV category
DETECT: single-bidder rate vs. CPV national average · repeat winner in single-bidder tenders

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

### 15. Framework agreement abuse — single-supplier call-offs

TOOLS: `execute_investigation_query`, `search_sutartys`, `get_sutartis`
GOAL: Detect framework agreements where all call-offs (`tipas = 'PPS'`) go to one supplier
DETECT: distinct supplier count per framework · total value and duration · framework establishment procedure type

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

### 16. Shared back-office — competing companies with the same address or domain

TOOLS: `execute_investigation_query`, `get_juridinis`, `search_juridiniai`
GOAL: Detect co-bidders sharing registered address or domain registrant
DETECT: shared legal address in jarCsv · shared domain in domenai · overlapping contract timelines

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

### 17. Price cartel — suspiciously uniform bid prices across a CPV category

TOOLS: `execute_investigation_query`
GOAL: Detect CPV categories with abnormally low price variance (CV < 5%) across independent tenders
DETECT: coefficient of variation by CPV · repeat suppliers in low-variation categories · cross-category clustering

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

## Partially supported themes

Themes 18–20: partial data — queries exist but schema gaps limit completeness. Themes 21–23: no or limited data support.

### 18. Contract amendment escalation — low bid, then value inflated through amendments

TOOLS: `execute_investigation_query`, `get_sutartis`, `search_failai`, `get_failas_tekstas`
GOAL: Detect suppliers who systematically under-bid then inflate via amendments
DETECT: faktineIvykdimoVerte/verte ratio > 1.5 · buyers with highest overrun tolerance · consistent under-bid pattern by
supplier

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

GAP: End result only (`faktineIvykdimoVerte`/`verte`); no amendment trail. `dokumentai` JSONB is unstructured.
Needs: amendments table (date, reason, delta) or JSONB parsing. CVP IS publishes amendment sequence but it is not
ingested.

### 19. Municipal company favoritism — buyer awards contracts to its own subsidiary

TOOLS: `execute_investigation_query`, `get_pinreg_jar`, `search_sutartys`
GOAL: Detect municipality awarding contracts to its own subsidiary via shared-person proxy
DETECT: value share to companies with shared PINREG persons with buyer · procedure type distribution (direct vs.
competitive)

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

GAP: Shared-person proxy only — misses formal municipal ownership (51% stake). Needs: JAR ownership table with
`SAVIVALDYBĖ` type or municipal enterprise registry feed.

### 20. Restricted procedure manipulation — buyer hand-picks the same invitees

TOOLS: `execute_investigation_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`
GOAL: Detect restricted/negotiated procedure overuse and audit findings for direct awards
DETECT: procedure mix (restricted/negotiated vs. open) · `neskelbiamosDerybos` audit findings by buyer

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

GAP: `atn1dalyviai` records submitted bids only, not invitees — cannot detect excluded qualified suppliers. Needs:
CVP IS invitation list data.

### 21. Political connection favoritism — companies linked to party donors or politicians

TOOLS: none — ❌ No data — no political donation or party membership in schema.

GAP: Needs VRK (Central Electoral Commission) donor database, name-matched against `pinregJuridiniaiRysiai`.

### 22. Fictitious deliverables — contract marked complete but work never done

TOOLS: `get_juridinis`, `get_sutartis`, `search_failai`, `get_failas_tekstas` (limited signal only)

GAP: `faktineIvykdimoVerte` confirms payment, not delivery. Needs: field inspection records, SABIS invoice data,
STT/NKT audit trail.

Weak signal: VDI violation (`vdiPazeidimai`) during contract execution period suggests workforce unavailability.

### 23. Vendor lock-in — incumbent supplier structural monopoly

TOOLS: `execute_investigation_query`, `search_sutartys`, `get_juridinis`
GOAL: Detect suppliers whose relationship with a single buyer is self-reinforcing — system builder becomes sole
maintenance provider, all subsequent contracts awarded without competition
DETECT: single-buyer concentration > 70% of supplier's total value · all contracts to that buyer via
direct/negotiated procedure · escalating contract count over years · no other supplier winning same CPV from same
buyer · litigation against buyers who attempted to switch (`bylojeKaip = 'IEŠKOVAS'` vs buyer `jarKodas`)

```sql
-- Suppliers with >70% of total contract value from a single buyer (min €1M total, min 5 contracts)
WITH supplier_totals AS (SELECT "tiekejoKodas",
                                SUM(verte) AS total_verte
                         FROM v_sutartys
                         WHERE istrinta IS NOT TRUE
                         GROUP BY "tiekejoKodas"),
     buyer_concentration AS (SELECT s."tiekejoKodas",
                                    s."pirkejoKodas",
                                    MAX(s.tiekejas) AS tiekejas,
                                    MAX(s.pirkejas) AS pirkejas,
                                    COUNT(*)        AS sutarciu_sk,
                                    SUM(s.verte)    AS buyer_verte
                             FROM v_sutartys s
                             WHERE s.istrinta IS NOT TRUE
                             GROUP BY s."tiekejoKodas", s."pirkejoKodas")
SELECT bc."tiekejoKodas",
       bc.tiekejas,
       bc."pirkejoKodas",
       bc.pirkejas,
       bc.sutarciu_sk,
       ROUND(bc.buyer_verte)                                              AS pirkejo_verte,
       ROUND(bc.buyer_verte * 100.0 / NULLIF(t.total_verte, 0), 1)       AS koncentracija_proc
FROM buyer_concentration bc
         JOIN supplier_totals t ON t."tiekejoKodas" = bc."tiekejoKodas"
WHERE t.total_verte >= 1000000
  AND bc.sutarciu_sk >= 5
  AND bc.buyer_verte * 100.0 / NULLIF(t.total_verte, 0) >= 70
ORDER BY pirkejo_verte DESC
LIMIT 200;
```

```sql
-- Procedure type mix for a specific buyer→supplier pair (replace jarKodas values)
SELECT tipas,
       COUNT(*)          AS sutarciu_sk,
       ROUND(SUM(verte)) AS bendra_verte
FROM v_sutartys
WHERE "tiekejoKodas" = '302676496'
  AND "pirkejoKodas" = '191346299'
  AND istrinta IS NOT TRUE
GROUP BY tipas
ORDER BY bendra_verte DESC;
```

```sql
-- Year-over-year contract escalation between buyer and supplier
SELECT EXTRACT(YEAR FROM "sudarymoData")::int AS metai,
       COUNT(*)                               AS sutarciu_sk,
       ROUND(SUM(verte))                      AS bendra_verte
FROM v_sutartys
WHERE "tiekejoKodas" = '302676496'
  AND "pirkejoKodas" = '191346299'
  AND istrinta IS NOT TRUE
GROUP BY metai
ORDER BY metai;
```

GAP: Cannot determine if supplier built the original system — no system name→contract mapping. Lock-in
mechanism (code/IP ownership) is invisible; only the outcome (structural monopoly) is detectable. Combine with
theme 14 (spec rigging single-bidder rate) and theme 7 (direct award overuse) for a stronger composite signal.

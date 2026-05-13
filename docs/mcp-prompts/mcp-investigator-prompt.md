# MCP Risk Intelligence Tool — Enhanced Investigation Themes for Lithuanian Public Procurement

> For human investigator: this document is meant to be pasted as the LLM prompt (with or without the human-only notes).
> Human-only notes are clearly marked with blockquotes starting with `For human investigator:` and can be removed before
> giving the prompt to the MCP agent.
> Run `mcp-investigator-prompt-split.sh` to regenerate the derived files:
> `mcp-investigator-prompt-thin.md` (no SQL, no human notes) and `mcp-investigator-prompt-sql.md` (SQL cookbook).

**SQL cookbook**: all SQL examples from this document are collected in `mcp-investigator-prompt-sql.md`, organised by
section headings. When you need a query pattern, search that file first — it is faster than scanning the full prompt.

## MCP Tool Quick Reference

### Tool selection — start with search, not SQL

Use `execute_query` for **aggregations and pattern analysis** — not for finding things. For discovery, always prefer the
purpose-built search tools first. Check **Goal** → **Use first** mapping below:

- Find contracts by party, CPV, value, date → `search_sutartys`
- Find companies by name or code → `search_juridiniai`
- Find persons, emails, phones, IBANs in documents → `search_failai`
- Find procurement notices → `search_viesieji_pirkimai`
- Aggregate, count, compute ratios, join tables → `execute_query`

### Views available inside `execute_query`

Prefer views to raw tables. Call `get_schema` to confirm column names.

- `v_company` [themes 1, 5–7, 9–12, 19, 22–23]: `jarCsv` + `sodra` (LATERAL) + compliance flags → `draustieji`,
  `vidutinisAtlyginimas`, `melagingiTiekejai`, `nepatikimiTiekejai`, `vdiPazeidimaiFlag`, `bylosKiekis`,
  `domenaiKiekis`, `neskelbiamosDerybosKiekis`.
- `v_sutartys` [themes 1–3, 5–8, 13, 15–16, 18–20, 22–24]: `sutartys` + `jarCsv` ×2 → `pirkejas`, `tiekejas`,
  `pirkejoKodas`, `tiekejoKodas` (names resolved).
- `v_pirkimas` [themes 5–7, 14, 20, 24]: `viesiejiPirkimai` + `viesiejiPirkimaiVykdytojai` → `vykdytojoPavadinimas`,
  `savivaldybe`, `shortCode`, `verteEur`.
- `v_person_links` [themes 4, 10–11, 13, 19, 21]: `pinregJuridiniaiRysiai` + `jarCsv` → `imonesVardas`,
  `registruotaLietuvoje`, `yraJuridinisAsmuo`.
- `v_dalyviai` [themes 2–3, 14, 17]: `atn1ataskaitos` + `atn1dalyviai` + `atn1pasiulymuEile` + `atn1atmestiPasiulymai` +
  `jarCsv` → `pasiulymoKaina` (numeric), `eileNumeris`, `atmetimoPriezastis`, `tiekejas`.
- `v_bylos` [themes 9, 23–24]: `bylosDalyviai` + `bylos` + `jarCsv` → `bylosRusis`, `teismas`, `bylojeKaip`,
  `pavadinimas`.

**Raw tables used directly** (no view wrapper exists or view would be counterproductive):

- `pinregJuridiniaiRysiai` — themes 11, 13, 19, 21 (revolving-door and municipal ownership date-range CTEs need raw
  access).
- `jarCsv` — themes 1, 10, 16, 22 (address self-join; `v_company` LATERAL Sodra join would be extremely expensive here).
- `domenai` — themes 10–11, 16 (domain pair self-join).
- `cpvaProjektuSutartys` — theme 12 (CPVA subcontractor data).
- `neskelbiamosDerybos` — theme 20 (audit findings, single-table lookup).
- other specialized tables (e.g. accounts, invoices) when added — see `get_schema`.

> For human investigator: when adding new raw tables (e.g. new JAR ownership exports, VRK donor data, municipal
> enterprise registries), extend this list and reference themes where the table is actually used. This keeps the LLM
> focused on relevant sources and avoids spurious joins.

## Theme tagging for Lithuanian institutions and OSINT

For each theme below, the tag list indicates the primary institutional interest and whether OSINT is recommended:

- `[STT]` – Specialiųjų tyrimų tarnyba: corruption, abuse of office, conflict of interest, influence peddling.
- `[FNTT]` – Finansinių nusikaltimų tyrimo tarnyba: fraud, money laundering, EU funds abuse, tax-related crimes.
- `[VPT]` – Viešųjų pirkimų tarnyba: procurement law compliance, procedure correctness.
- `[VK]` – Valstybės kontrolė: systemic weaknesses, EU funds eligibility issues.
- `[KT]` – Konkurencijos taryba: cartels, bid rigging, anti-competitive agreements.
- `OSINT: yes/no/conditional` – whether the agent should consider structured web search and open-source intelligence (
  e.g. public company websites, media, OSINT registers).

These tags are **for the human investigator and LLM routing**, they do not change legal qualification of conduct.

## Supported themes (updated and extended)

### 1. Shell company / capacity mismatch

`[STT][FNTT][VPT]` – OSINT: **yes** (websites, LinkedIn, media)

TOOLS: `get_juridinis`, `execute_query`, `search_sutartys`

GOAL: Detect capacity mismatch — supplier headcount/wages insufficient for contract scope.

DETECT:

- Headcount vs. total contract value over rolling windows (e.g. annual Sodra vs. cumulative contract obligations).
- Sodra wages vs. revenue proxies (when revenue fields/tax data become available) and vs. sector medians.
- Registration date vs. first contract win date (sudden large wins soon after incorporation, especially in high-risk CPV
  areas).
- Shared registered address count (same address used by many suppliers or linked to buyers).
- Lack of visible operational footprint: no website, no employees on LinkedIn, no office in OSINT sources while handling
  large/complex contracts.

SQL EXAMPLES:

```sql
-- Shell company: high recent contract value vs. near-zero headcount (capacity mismatch)
SELECT j."jarKodas",
       j.pavadinimas,
       j."registravimoData",
       sod.draustieji,
       sod."vidutinisAtlyginimas",
       stats.totalVerte,
       stats.kiekis,
       ROUND(stats.totalVerte / NULLIF(sod.draustieji, 0)) AS verteVienamdarbVienam
FROM "jarCsv" j
         JOIN (SELECT "tiekejoKodas", SUM(verte) AS totalVerte, COUNT(*) AS kiekis
               FROM sutartys
               WHERE istrinta = false
                 AND "sudarymoData" >= CURRENT_DATE - INTERVAL '3 years'
               GROUP BY "tiekejoKodas"
               HAVING SUM(verte) > 300000) stats ON stats."tiekejoKodas" = j."jarKodas"::text
JOIN LATERAL (
    SELECT draustieji, "vidutinisAtlyginimas"
    FROM sodra WHERE "jarKodas" = j."jarKodas"::text ORDER BY data DESC LIMIT 1
) sod
ON true
WHERE sod.draustieji < 5
ORDER BY stats.totalVerte DESC
LIMIT 30;
```

```sql
-- New company winning large contracts shortly after incorporation
SELECT j."jarKodas",
       j.pavadinimas,
       j."registravimoData",
       MIN(s."sudarymoData")                          AS pirmasSutartisData,
       (MIN(s."sudarymoData") - j."registravimoData") AS dienosPoRegistracijos,
       SUM(s.verte)                                   AS totalVerte
FROM "jarCsv" j
         JOIN sutartys s ON s."tiekejoKodas" = j."jarKodas"::text AND s.istrinta = false
GROUP BY j."jarKodas", j.pavadinimas, j."registravimoData"
HAVING (MIN(s."sudarymoData") - j."registravimoData")
     < 365
   AND SUM(s.verte)
     > 200000
ORDER BY dienosPoRegistracijos ASC
LIMIT 30;
```

> For human investigator: STT typically sees capacity mismatch as part of sham competition, favouritism, or misuse of
> shell companies; FNTT will be interested when capacity mismatch is combined with suspicious financial flows (e.g.
> significant advances, cash withdrawals, or cross-border payments). When escalating to FNTT, attach summary tables of
> headcount vs. obligations and any OSINT on real operations.

### 2. Bid rigging — cover bidding

`[STT][KT]` – OSINT: **yes** (industry associations, local media)

TOOLS: `execute_query`, `search_sutartys`

GOAL: Detect cover bidding — recurring losers always bidding just above winner.

> **Note**: **Bid suppression** (potential bidders deliberately abstaining from a tender) cannot be detected from
> available data. `atn1dalyviai` records only submitted bids, not invited parties. Do not claim bid suppression
> detection; defer to Theme 20 for partial insight via invitation data gaps.

DETECT:

- Win rate vs. participation count per supplier per CPV category (use as initial screening only — low win rate alone
  does not confirm cover bidding; legitimate SMEs may participate in many tenders without winning).
- Top co-bidder frequency (same losing bidders repeatedly present when a given winner participates).
- Losing bid clustering above winning price (small margins, consistent structure).
- Participation count vs. CPV national average (few bidders where market structure suggests more).
- Persistent patterns where one supplier often wins, others rarely win except where the main supplier does not bid.

SQL EXAMPLES:

```sql
-- Win rate vs. participation count per supplier — preliminary screening; very low win rate with high frequency warrants further co-bidder analysis
SELECT d.kodas                                                                AS "tiekejoKodas",
       j.pavadinimas                                                          AS tiekejas,
       COUNT(DISTINCT d."ataskaitaId")                                        AS dalyvutaPirkimuose,
       COUNT(DISTINCT CASE WHEN e."eileNumeris" = 1 THEN d."ataskaitaId" END) AS laimetaPirkimuose,
       ROUND(100.0 * COUNT(DISTINCT CASE WHEN e."eileNumeris" = 1 THEN d."ataskaitaId" END)
                 / COUNT(DISTINCT d."ataskaitaId"), 1)                        AS laimedamuProc
FROM "atn1dalyviai" d
         JOIN "jarCsv" j ON j."jarKodas"::text = d.kodas
LEFT JOIN "atn1pasiulymuEile" e
ON e."ataskaitaId" = d."ataskaitaId" AND e."dalyvioKodas" = d.kodas
WHERE d.kodas IS NOT NULL AND d.kodas <> ''
GROUP BY d.kodas, j.pavadinimas
HAVING COUNT(DISTINCT d."ataskaitaId") >= 10
ORDER BY laimedamuProc ASC, dalyvutaPirkimuose DESC
LIMIT 50;
```

```sql
-- Most frequent co-bidder pairs (same two companies appearing together repeatedly)
SELECT d1.kodas                         AS kodas1,
       j1.pavadinimas                   AS pavadinimas1,
       d2.kodas                         AS kodas2,
       j2.pavadinimas                   AS pavadinimas2,
       COUNT(DISTINCT d1."ataskaitaId") AS buvoPoroje
FROM "atn1dalyviai" d1
         JOIN "atn1dalyviai" d2 ON d2."ataskaitaId" = d1."ataskaitaId" AND d2.kodas > d1.kodas
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1.kodas
JOIN "jarCsv" j2
ON j2."jarKodas":: text = d2.kodas
GROUP BY d1.kodas, j1.pavadinimas, d2.kodas, j2.pavadinimas
HAVING COUNT(DISTINCT d1."ataskaitaId") >= 15
ORDER BY buvoPoroje DESC
LIMIT 30;
```

### 3. Bid rotation / carousel

`[STT][KT]` – OSINT: **conditional** (sector analysis, competitor structure)

TOOLS: `execute_query`, `search_sutartys`

GOAL: Detect companies alternating wins in same CPV — never competing simultaneously.

DETECT:

- Win value share by period per CPV for a small cluster of suppliers.
- Mutual bidding absence (A wins when B does not participate and vice versa).
- Cross-appearance as cover bidders for each other in other buyers’ tenders.
- Rotation schemes aligned with calendar years, budget cycles, or EU funding phases.

SQL EXAMPLES:

```sql
-- Annual CPV group market share per supplier — detect alternating winner across years
WITH yearly AS (SELECT DATE_TRUNC('year', "sudarymoData")::date AS metai,
        LEFT("bvpzKodas", 3) AS cpvGrupe, "tiekejoKodas", SUM(verte) AS suma
                FROM sutartys
                WHERE istrinta = false AND "bvpzKodas" IS NOT NULL AND "sudarymoData" IS NOT NULL
                GROUP BY 1, 2, 3),
     grp AS (SELECT metai, cpvGrupe, SUM(suma) AS visoSuma
             FROM yearly
             GROUP BY 1, 2
             HAVING SUM(suma) > 500000)
SELECT y.metai,
       y.cpvGrupe,
       y."tiekejoKodas",
       j.pavadinimas                         AS tiekejas,
       y.suma,
       g.visoSuma,
       ROUND(100.0 * y.suma / g.visoSuma, 1) AS rinkosDalisProc
FROM yearly y
         JOIN grp g ON g.metai = y.metai AND g.cpvGrupe = y.cpvGrupe
         JOIN "jarCsv" j ON j."jarKodas"::text = y."tiekejoKodas"
ORDER BY y.cpvGrupe, y.metai, y.suma DESC
LIMIT 100;
```

> For human investigator: potential KT interest is high — bid rotation is classic cartel behaviour. STT may focus on
> cases where rotation is driven by public officials’ interference; KT focuses on competition law violations.

### 4. Conflict of interest — shared people between buyer and seller

`[STT][VPT]` – OSINT: **yes** (media, LinkedIn, board memberships)

TOOLS: `get_pinreg_jar`, `get_pinreg_asmuo`, `execute_query`

GOAL: Find persons declared in both buyer and winning supplier PINREG records **with an active or recent relationship
** (filter by `rysioPabaiga` to avoid flagging persons who left either entity years ago).

> **Important**: Always filter by relationship date. Without a date filter this query will match expired historical
> relationships and produce large numbers of false positives. Use `rysioPabaiga IS NULL` (currently active) or
> `rysioPabaiga >= CURRENT_DATE - INTERVAL '3 years'` (active within last 3 years).

DETECT:

- Shared persons buyer↔supplier (directors, board members, key staff).
- Spouse/family links (SUTUOKTINIO_DARBOVIETE and similar fields).
- Cross-declared interest declarations (same person declaring interests in both entities).
- Ownership chain overlap (person is owner/co-owner in supplier while participating in buyer decisions).
- Undeclared conflicts: persons visible in OSINT sources (boards, associations) but missing from PINREG.

SQL EXAMPLES:

```sql
-- Persons appearing in PINREG for both buyer and winning supplier (direct conflict of interest)
-- Filter to active/recent relationships to avoid false positives from stale historical links
SELECT pr_b.vardas,
       pr_b.pavarde,
       pr_b."jarKodas"                         AS pirkejoKodas,
       buyer.pavadinimas                       AS pirkejas,
       pr_s."jarKodas"                         AS "tiekejoKodas",
       supplier.pavadinimas                    AS tiekejas,
       COUNT(DISTINCT s."sutartiesUnikalusId") AS sutarciuKiekis,
       SUM(s.verte)                            AS totalVerte
FROM "pinregJuridiniaiRysiai" pr_b
         JOIN "pinregJuridiniaiRysiai" pr_s
              ON pr_s.vardas = pr_b.vardas AND pr_s.pavarde = pr_b.pavarde
                  AND pr_s."jarKodas" <> pr_b."jarKodas"
         JOIN sutartys s
              ON s."perkanciosiosOrganizacijosKodas" = pr_b."jarKodas"
                  AND s."tiekejoKodas" = pr_s."jarKodas" AND s.istrinta = false
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = pr_b."jarKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = pr_s."jarKodas"
WHERE (pr_b."rysioPabaiga" IS NULL
   OR pr_b."rysioPabaiga" >= CURRENT_DATE - INTERVAL '3 years')
  AND (pr_s."rysioPabaiga" IS NULL
   OR pr_s."rysioPabaiga" >= CURRENT_DATE - INTERVAL '3 years')
GROUP BY pr_b.vardas, pr_b.pavarde, pr_b."jarKodas", buyer.pavadinimas,
    pr_s."jarKodas", supplier.pavadinimas
HAVING SUM(s.verte) > 50000
ORDER BY totalVerte DESC
LIMIT 30;
```

### 5. Contract splitting to avoid thresholds

`[STT][VPT][VK]` – OSINT: **conditional** (local press about repetitive small contracts)

TOOLS: `search_sutartys`, `execute_query`

GOAL: Detect contract splitting to avoid competition thresholds. There are two distinct splitting risks:

1. **Below €30 000** (MVT threshold): avoids any competitive procedure for goods/services.
2. **Below EU open-procedure threshold** (~€140 000 for central-government services; ~€215 000 for sub-central; ~€5.38M
   for works as of 2024): avoids EU-level publication and full open competition.

Both risks are distinct. The SQL examples cover both; adjust thresholds to reflect current VPT/EU figures.

DETECT:

- Contract value clusters just below thresholds (e.g. repeated contracts at 29 900 EUR).
- Same CPV recurring in small awards over short time to same supplier or related suppliers.
- Short time gaps between consecutive awards to same supplier or same CPV by same buyer.
- Fragmentation of a clearly homogeneous need (e.g. IT system development) into many small contracts.

SQL EXAMPLES:

```sql
-- Repeated small contracts just below €30 000 MVT threshold (same buyer-supplier-CPV trio)
SELECT s."perkanciosiosOrganizacijosKodas" AS pirkejoKodas,
       buyer.pavadinimas                   AS pirkejas,
       s."tiekejoKodas",
       supplier.pavadinimas                AS tiekejas, LEFT (s."bvpzKodas", 3) AS cpvGrupe, COUNT(*) AS sutarciuKiekis, SUM(s.verte) AS totalVerte, MAX(s.verte) AS maxVerte
FROM sutartys s
    JOIN "jarCsv" buyer
ON buyer."jarKodas":: text = s."perkanciosiosOrganizacijosKodas"
    JOIN "jarCsv" supplier ON supplier."jarKodas":: text = s."tiekejoKodas"
WHERE s.verte BETWEEN 20000
  AND 29999
  AND s.istrinta = false
  AND s."sudarymoData" >= CURRENT_DATE - INTERVAL '3 years'
GROUP BY 1, 2, 3, 4, 5
HAVING COUNT(*) >= 3
ORDER BY sutarciuKiekis DESC, totalVerte DESC
LIMIT 50;
```

```sql
-- Repeated contracts just below EU sub-central threshold (€215 000) — below-EU-threshold splitting signal
SELECT s."perkanciosiosOrganizacijosKodas" AS pirkejoKodas,
       buyer.pavadinimas                   AS pirkejas,
       s."tiekejoKodas",
       supplier.pavadinimas                AS tiekejas, LEFT (s."bvpzKodas", 3) AS cpvGrupe, COUNT(*) AS sutarciuKiekis, SUM(s.verte) AS totalVerte, MAX(s.verte) AS maxVerte
FROM sutartys s
    JOIN "jarCsv" buyer
ON buyer."jarKodas":: text = s."perkanciosiosOrganizacijosKodas"
    JOIN "jarCsv" supplier ON supplier."jarKodas":: text = s."tiekejoKodas"
WHERE s.verte BETWEEN 150000
  AND 214999
  AND s.istrinta = false
  AND s."sudarymoData" >= CURRENT_DATE - INTERVAL '3 years'
GROUP BY 1, 2, 3, 4, 5
HAVING COUNT(*) >= 2
ORDER BY totalVerte DESC
LIMIT 50;
```

```sql
-- Consecutive awards to same supplier within 30 days (splitting gap signal)
SELECT s1."perkanciosiosOrganizacijosKodas" AS pirkejoKodas,
       j_b.pavadinimas                      AS pirkejas,
       s1."tiekejoKodas",
       j_s.pavadinimas                      AS tiekejas, LEFT (s1."bvpzKodas", 3) AS cpvGrupe, s1."sudarymoData" AS data1, s2."sudarymoData" AS data2, s1.verte AS verte1, s2.verte AS verte2, (s2."sudarymoData" - s1."sudarymoData") AS tarposDienos
FROM sutartys s1
    JOIN sutartys s2
ON s2."perkanciosiosOrganizacijosKodas" = s1."perkanciosiosOrganizacijosKodas"
    AND s2."tiekejoKodas" = s1."tiekejoKodas"
    AND LEFT (s2."bvpzKodas", 3) = LEFT (s1."bvpzKodas", 3)
    AND s2."sudarymoData" > s1."sudarymoData"
    AND (s2."sudarymoData" - s1."sudarymoData") <= INTERVAL '30 days'
    AND s2."sutartiesUnikalusId" <> s1."sutartiesUnikalusId"
    JOIN "jarCsv" j_b ON j_b."jarKodas":: text = s1."perkanciosiosOrganizacijosKodas"
    JOIN "jarCsv" j_s ON j_s."jarKodas":: text = s1."tiekejoKodas"
WHERE s1.istrinta = false
  AND s2.istrinta = false
  AND s1.verte
    < 30000
  AND s2.verte
    < 30000
ORDER BY tarposDienos ASC
LIMIT 50;
```

### 6. Geographic monopoly / local capture

`[STT][VK][VPT]` – OSINT: **yes** (local media, municipal council decisions)

TOOLS: `execute_query`, `search_sutartys`, `get_juridinis`

GOAL: Detect single-supplier dominance in one municipality or CPV category.

DETECT:

- Value share by supplier per municipality and CPV over multi-year periods.
- Competitors who stopped bidding or winning over time after one supplier begins to dominate.
- Local registration bias (buyer awarding mostly to locally registered companies despite national markets).
- Officer→supplier PINREG connections for local officials.

SQL EXAMPLES:

```sql
-- Supplier capturing >70% of a single buyer's total contract value (local dominance signal)
WITH buyer_totals AS (SELECT "perkanciosiosOrganizacijosKodas", SUM(verte) AS totalVerte
                      FROM sutartys
                      WHERE istrinta = false
                        AND "sudarymoData" >= CURRENT_DATE - INTERVAL '5 years'
                      GROUP BY 1
                      HAVING SUM(verte) > 500000),
     supplier_share AS (SELECT "perkanciosiosOrganizacijosKodas",
                               "tiekejoKodas",
                               SUM(verte) AS supplierVerte,
                               COUNT(*)   AS kiekis
                        FROM sutartys
                        WHERE istrinta = false
                          AND "sudarymoData" >= CURRENT_DATE - INTERVAL '5 years'
                        GROUP BY 1, 2)
SELECT ss."perkanciosiosOrganizacijosKodas"               AS pirkejoKodas,
       buyer.pavadinimas                                  AS pirkejas,
       ss."tiekejoKodas",
       supplier.pavadinimas                               AS tiekejas,
       bt.totalVerte,
       ss.supplierVerte,
       ss.kiekis,
       ROUND(100.0 * ss.supplierVerte / bt.totalVerte, 1) AS rinkosDalisProc
FROM supplier_share ss
         JOIN buyer_totals bt ON bt."perkanciosiosOrganizacijosKodas" = ss."perkanciosiosOrganizacijosKodas"
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = ss."perkanciosiosOrganizacijosKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = ss."tiekejoKodas"
WHERE ss.supplierVerte / bt.totalVerte > 0.70
ORDER BY ss.supplierVerte DESC
LIMIT 30;
```

### 7. Procedure manipulation — unjustified direct award

`[STT][VPT][VK]` – OSINT: **yes** (audit reports, media)

TOOLS: `execute_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`

GOAL: Detect overuse of negotiated-without-publication or restricted procedures, and possible misclassification of
urgency/exception conditions.

DETECT:

- Direct-negotiation value share vs. open competition by buyer and CPV over time.
- Trend over time, including spikes in specific years or budget periods.
- Top beneficiary suppliers, especially newly created entities or those with conflicts of interest.
- Justification text in procurement notices and documents indicating vague or repetitive reasons.

SQL EXAMPLES:

```sql
-- Procedure mix by buyer: count and value share of each "pirkimoBudas" type
SELECT vp."jarKodas"                                                                AS pirkejoKodas,
       j.pavadinimas                                                                AS pirkejas,
       vp."pirkimoBudas",
       COUNT(*)                                                                     AS pirkimuKiekis,
       ROUND(SUM(vp."numatomaVerteEUR"))                                            AS totalVerteEUR,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY vp."jarKodas"), 1) AS procentas
FROM "viesiejiPirkimai" vp
         JOIN "jarCsv" j ON j."jarKodas"::text = vp."jarKodas"
WHERE vp."paskelbimoData" >= CURRENT_DATE - INTERVAL '5 years'
GROUP BY vp."jarKodas", j.pavadinimas, vp."pirkimoBudas"
HAVING COUNT(*) >= 3
ORDER BY vp."jarKodas", totalVerteEUR DESC NULLS LAST
LIMIT 100;
```

### 8. Price anomalies — over-invoicing and scope creep

`[STT][FNTT][VK]` – OSINT: **conditional** (market price benchmarks)

TOOLS: `execute_query`, `get_sutartis`, `search_sutartys`

GOAL: Detect contracts where `faktineIvykdimoVerte` significantly exceeds signed `verte` or where unit prices appear
inflated.

DETECT:

- Average `faktineIvykdimoVerte/verte` ratio by supplier, buyer, CPV, and procedure type.
- Overruns >50% and clustering of high-overrun cases by supplier or buyer.
- Low-bid-then-inflate patterns where the same supplier frequently wins as the cheapest, then exhibits large amendments.
- For homogeneous goods, systematic per-unit price differences vs. national average.

SQL EXAMPLES:

```sql
-- Contracts where actual execution value exceeds signed value by >50% (overrun outliers)
SELECT s."sutartiesUnikalusId",
       s.pavadinimas,
       s."bvpzKodas",
       s."sudarymoData",
       s."perkanciosiosOrganizacijosKodas"                     AS pirkejoKodas,
       buyer.pavadinimas                                       AS pirkejas,
       s."tiekejoKodas",
       supplier.pavadinimas                                    AS tiekejas,
       s.verte,
       s."faktineIvykdimoVerte",
       ROUND(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0), 2) AS vertuSantykis
FROM sutartys s
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = s."tiekejoKodas"
WHERE s."faktineIvykdimoVerte"
    > s.verte * 1.5
  AND s.verte
    > 50000
  AND s.istrinta = false
ORDER BY vertuSantykis DESC
LIMIT 50;
```

### 9. Compliance and blacklist cross-check

`[STT][FNTT][VPT]` – OSINT: **conditional** (sanction lists, media on fraud)

TOOLS: `get_juridinis`, `execute_query`

GOAL: Check all blacklists, sanctions, and violations for company and linked parties.

DETECT:

- Current/expired debarment (melagingiTiekejai, nepatikimiTiekejai) and repeat non-compliance.
- VDI violations (vdiPazeidimai) during contract execution periods.
- Court cases where supplier is claimant against former or current buyers (`bylojeKaip = 'IEŠKOVAS'`).
- Linked-company blacklist status (group companies, same owners, same address/domain).

SQL EXAMPLES:

```sql
-- Contracts awarded to debarred suppliers (active during contract signing)
SELECT s."sutartiesUnikalusId",
       s."sudarymoData",
       s.verte,
       s."tiekejoKodas",
       j.pavadinimas                                                              AS tiekejas,
       s."perkanciosiosOrganizacijosKodas"                                        AS pirkejoKodas,
       buyer.pavadinimas                                                          AS pirkejas,
       CASE WHEN mt."tiekejoJarKodas" IS NOT NULL THEN '"melagingiTiekejai"' END  AS melagingasFlag,
       CASE WHEN nt."tiekejoJarKodas" IS NOT NULL THEN '"nepatikimiTiekejai"' END AS nepatikimasFlag
FROM sutartys s
         JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
JOIN "jarCsv" buyer
ON buyer."jarKodas":: text = s."perkanciosiosOrganizacijosKodas"
    LEFT JOIN "melagingiTiekejai" mt
    ON mt."tiekejoJarKodas" = s."tiekejoKodas"
    -- Check debarment was active at contract signing (start ≤ signing date ≤ end).
    -- Verify exact "start date" column name via get_schema ("itrauktasNuo" or similar).
    AND (mt."itrauktasIki" IS NULL OR mt."itrauktasIki" >= s."sudarymoData")
    LEFT JOIN "nepatikimiTiekejai" nt
    ON nt."tiekejoJarKodas" = s."tiekejoKodas"
    -- Same start-date caveat applies; verify column name in nepatikimiTiekejai via get_schema.
    AND (nt."itrauktaIki" IS NULL OR nt."itrauktaIki" >= s."sudarymoData")
WHERE (mt."tiekejoJarKodas" IS NOT NULL
   OR nt."tiekejoJarKodas" IS NOT NULL)
  AND s.istrinta = false
ORDER BY s."sudarymoData" DESC
LIMIT 50;
```

### 10. Network — second-degree connections and corporate webs

`[STT][FNTT]` – OSINT: **yes** (JAR extracts, foreign registers, company websites)

TOOLS: `get_pinreg_jar`, `get_pinreg_asmuo`, `execute_query`, `search_juridiniai`, `get_juridinis`

GOAL: Map corporate control network beyond direct ownership.

DETECT:

- Directors/shareholders → second-degree companies → public contracts.
- Shared address/domain clusters; offices shared among multiple bidders.
- Ownership changes around contract award dates (transfers before large tenders).
- Foreign beneficial ownership indicators (non-Lithuanian entities with unclear activity).

SQL EXAMPLES:

```sql
-- Persons linking 4+ companies via PINREG (network hub — second-degree connection risk)
SELECT pr.vardas,
       pr.pavarde,
       COUNT(DISTINCT pr."jarKodas")            AS susijusiuImoniu,
       BOOL_OR(NOT pr."registruotaLietuvoje")   AS yraUzsienioRysiu,
       STRING_AGG(DISTINCT j.pavadinimas, '; ') AS imones
FROM "pinregJuridiniaiRysiai" pr
         JOIN "jarCsv" j ON j."jarKodas"::text = pr."jarKodas"
GROUP BY pr.vardas, pr.pavarde
HAVING COUNT(DISTINCT pr."jarKodas") >= 4
ORDER BY susijusiuImoniu DESC
LIMIT 30;
```

```sql
-- Companies sharing the same registered address (shared back-office cluster)
SELECT j.adresas,
       COUNT(DISTINCT j."jarKodas")                           AS imoniu,
       STRING_AGG(j.pavadinimas, '; ' ORDER BY j.pavadinimas) AS imones
FROM "jarCsv" j
WHERE j.adresas IS NOT NULL
  AND LENGTH(j.adresas) > 10
GROUP BY j.adresas
HAVING COUNT(DISTINCT j."jarKodas") >= 5
ORDER BY imoniu DESC
LIMIT 30;
```

> For human investigator: networks that cross into high-risk sectors (construction, IT, healthcare, EU-funded projects)
> are particularly relevant for STT; when capital flows, cross-border payments, or complex chains with offshore entities
> are visible, FNTT interest increases.

### 11. UBO risk — beneficial ownership through holding layers

`[STT][FNTT]` – OSINT: **yes** (foreign company registers, OpenCorporates)

TOOLS: `execute_query`, `get_pinreg_jar`, `get_juridinis`

GOAL: Detect shared control of competing bidders or buyer–supplier pairs through holding companies and back-office
signals.

> **False-positive risk**: `yraJuridinisAsmuo = true` alone matches all companies that have any corporate shareholder,
> including entirely normal Lithuanian holding structures. Filter specifically for **foreign-registered** legal entities
> (`registruotaLietuvoje = false AND yraJuridinisAsmuo = true`) to focus on high-risk offshore chains. Domestic parent
> companies are not inherently suspicious.

ANSWERABLE NOW:

- Shared declared persons across bidder set (including spouse links via `SUTUOKTINIO_DARBOVIETE`).
- Shared domain registrant, address, or court history across co-bidders.

SQL EXAMPLES:

```sql
-- Persons declared in PINREG for two companies that bid in the same tender (UBO co-control)
SELECT d1."ataskaitaId" AS pirkimasId,
       a."pirkimoNumeris",
       d1.kodas         AS kodas1,
       j1.pavadinimas   AS pavadinimas1,
       d2.kodas         AS kodas2,
       j2.pavadinimas   AS pavadinimas2,
       pr.vardas,
       pr.pavarde
FROM "atn1dalyviai" d1
         JOIN "atn1dalyviai" d2
              ON d2."ataskaitaId" = d1."ataskaitaId" AND d2.kodas > d1.kodas
         JOIN "atn1ataskaitos" a ON a.id = d1."ataskaitaId"
         JOIN "pinregJuridiniaiRysiai" pr ON pr."jarKodas" = d1.kodas
         JOIN "pinregJuridiniaiRysiai" pr2
              ON pr2."jarKodas" = d2.kodas AND pr2.vardas = pr.vardas AND pr2.pavarde = pr.pavarde
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1.kodas
JOIN "jarCsv" j2
ON j2."jarKodas":: text = d2.kodas
ORDER BY a."pirkimoNumeris"
LIMIT 50;
```

```sql
-- PINREG links to foreign-registered or legal-entity holders (high UBO risk indicators)
SELECT pr.vardas,
       pr.pavarde,
       pr.pareigos,
       pr."jarKodas",
       j.pavadinimas AS imone,
       pr."registruotaLietuvoje",
       pr."yraJuridinisAsmuo",
       pr."rysioPradzia",
       pr."rysioPabaiga"
FROM "pinregJuridiniaiRysiai" pr
         JOIN "jarCsv" j ON j."jarKodas"::text = pr."jarKodas"
WHERE pr."registruotaLietuvoje" = false
   OR (pr."yraJuridinisAsmuo" = true
  AND pr."registruotaLietuvoje" = false)
ORDER BY j.pavadinimas
LIMIT 100;
```

GAP (DATA):

- Only one-hop person→company links; no explicit company→company ownership table.
- Foreign ownership chains often opaque.

MITIGATION:

- Flag `registruotaLietuvoje = false` or `yraJuridinisAsmuo = true` in `v_person_links` as high-risk chain elements.
- Use OSINT to identify foreign holdings and beneficial owners.

### 12. EU Structural Funds abuse — fictitious subcontractors and inflated costs

`[FNTT][VK][STT]` – OSINT: **yes** (EU project registers, agency reports)

TOOLS: `execute_query`, `get_juridinis`, `get_pinreg_jar`

GOAL: Detect fictitious subcontractors and pass-through schemes in CPVA-funded contracts.

DETECT:

- Subcontractor Sodra headcount vs. project obligations.
- Main contractor pass-through signal (low margins, fees mostly passed to subcontractor, or vice versa).
- Recurring contractor+subcontractor pairs across projects with similar scope.
- Shared PINREG persons between contractor and subcontractor.
- Mismatches between declared procurement procedures and EU rules in audit reports.

SQL EXAMPLES:

```sql
-- CPVA-funded contracts with very low supplier headcount (fictitious capacity signal)
SELECT cs."projektoNr",
       cs."pirkimoNrCvpis",
       cs."tiekejoKodas",
       j.pavadinimas                               AS tiekejas,
       j."registravimoData",
       cs."pirkimoSutartiesSumaSusijusiSuProjektu" AS sutartisSuma,
       sod.draustieji,
       sod."vidutinisAtlyginimas"
FROM "cpvaProjektuSutartys" cs
         JOIN "jarCsv" j ON j."jarKodas"::text = cs."tiekejoKodas"
JOIN LATERAL (
    SELECT draustieji, "vidutinisAtlyginimas"
    FROM sodra WHERE "jarKodas" = cs."tiekejoKodas" ORDER BY data DESC LIMIT 1
) sod
ON true
WHERE sod.draustieji
    < 5
  AND cs."pirkimoSutartiesSumaSusijusiSuProjektu"
    > 100000
ORDER BY cs."pirkimoSutartiesSumaSusijusiSuProjektu" DESC
LIMIT 30;
```

```sql
-- Recurring contractor + subcontractor pairs across multiple EU-funded projects
SELECT cs1."tiekejoKodas"                                AS pagrindinisKodas,
       j1.pavadinimas                                    AS pagrindinisRangovas,
       cs2."tiekejoKodas"                                AS papildomasKodas,
       j2.pavadinimas                                    AS papildomasRangovas,
       COUNT(DISTINCT cs1."projektoNr")                  AS projektaiKartu,
       SUM(cs1."pirkimoSutartiesSumaSusijusiSuProjektu") AS bendraPagrindinoVerte
FROM "cpvaProjektuSutartys" cs1
         JOIN "cpvaProjektuSutartys" cs2
              ON cs2."projektoNr" = cs1."projektoNr" AND cs2."tiekejoKodas" <> cs1."tiekejoKodas"
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = cs1."tiekejoKodas"
JOIN "jarCsv" j2
ON j2."jarKodas":: text = cs2."tiekejoKodas"
GROUP BY cs1."tiekejoKodas", j1.pavadinimas, cs2."tiekejoKodas", j2.pavadinimas
HAVING COUNT(DISTINCT cs1."projektoNr") >= 3
ORDER BY projektaiKartu DESC
LIMIT 30;
```

### 13. Revolving door — procurement officer joins winning supplier

`[STT]` – OSINT: **yes** (LinkedIn, public CVs)

TOOLS: `execute_query`, `get_pinreg_asmuo`, `get_pinreg_jar`

GOAL: Find buyer-side staff who moved to suppliers that won contracts from their former employer.

DETECT:

- Person left buyer organisation and joined supplier within a defined time window (e.g. 2 years).
- Contracts awarded to that supplier after move date by same buyer.
- Changes in procedure type and competition intensity before and after move.

SQL EXAMPLES:

```sql
-- Person left buyer PINREG and joined a supplier within 2 years; supplier then won contracts
SELECT pr_b.vardas,
       pr_b.pavarde,
       pr_b."jarKodas"                             AS pirkejoKodas,
       buyer.pavadinimas                           AS pirkejas,
       pr_b."rysioPabaiga"                         AS isejimoData,
       pr_s."jarKodas"                             AS "tiekejoKodas",
       supplier.pavadinimas                        AS tiekejas,
       pr_s."rysioPradzia"                         AS prisijungimoData,
       (pr_s."rysioPradzia" - pr_b."rysioPabaiga") AS perejimoDienos,
       COUNT(s."sutartiesUnikalusId")              AS sutarciuPoPerejimo,
       COALESCE(SUM(s.verte), 0)                   AS vertePoPerejimo
FROM "pinregJuridiniaiRysiai" pr_b
         JOIN "pinregJuridiniaiRysiai" pr_s
              ON pr_s.vardas = pr_b.vardas AND pr_s.pavarde = pr_b.pavarde
                  AND pr_s."jarKodas" <> pr_b."jarKodas"
                  AND pr_b."rysioPabaiga" IS NOT NULL AND pr_s."rysioPradzia" IS NOT NULL
                  AND pr_s."rysioPradzia" > pr_b."rysioPabaiga"
                  -- 730 days is an investigation parameter, not a legal cooling-off period — adjust for seniority.
                  AND (pr_s."rysioPradzia" - pr_b."rysioPabaiga") < 730
         LEFT JOIN sutartys s
                   ON s."perkanciosiosOrganizacijosKodas" = pr_b."jarKodas"
                       AND s."tiekejoKodas" = pr_s."jarKodas"
                       AND s."sudarymoData" >= pr_s."rysioPradzia" AND s.istrinta = false
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = pr_b."jarKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = pr_s."jarKodas"
GROUP BY pr_b.vardas, pr_b.pavarde, pr_b."jarKodas", buyer.pavadinimas, pr_b."rysioPabaiga",
    pr_s."jarKodas", supplier.pavadinimas, pr_s."rysioPradzia"
-- HAVING removes cases with zero post-move contracts; remove this filter to also surface
-- pre-positioned relationships (supplier had prior contracts before the person moved).
HAVING COALESCE(SUM(s.verte), 0) > 0
ORDER BY vertePoPerejimo DESC
LIMIT 30;
```

### 14. Spec rigging — technical specifications written for one supplier

`[STT][KT][VPT]` – OSINT: **yes** (technical standards, competing products, prior tenders)

TOOLS: `execute_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`, `search_failai`, `get_failas_tekstas`

GOAL: Detect buyers with abnormally high single-bidder rate in a CPV category and specification patterns favouring one
supplier.

DETECT:

- Single-bidder rate vs. CPV national average.
- Repeat winner in single-bidder tenders.
- Technical specification language that matches one brand/model; repeated exclusionary requirements (e.g. specific
  patents, small deviations).
- Use of overly narrow CPV codes or contract splitting to keep competition away.

SQL EXAMPLES:

```sql
-- Buyers with highest single-bidder rate per CPV category (spec rigging signal)
SELECT a."perkanciosiosOrganizacijosKodas" AS pirkejoKodas,
       j.pavadinimas                       AS pirkejas, LEFT (vp."bvpzKodai"[1], 3) AS cpvGrupe, COUNT(DISTINCT a.id) AS pirkimuKiekis, COUNT(DISTINCT CASE WHEN dalyviu.cnt = 1 THEN a.id END) AS vienasdalyvys, ROUND(100.0 * COUNT(DISTINCT CASE WHEN dalyviu.cnt = 1 THEN a.id END)
    / COUNT(DISTINCT a.id), 1) AS vienoDalyvioProcent
FROM "atn1ataskaitos" a
    JOIN "viesiejiPirkimai" vp
ON vp."pirkimoId" = a."pirkimoNumeris"
    JOIN "jarCsv" j ON j."jarKodas":: text = a."perkanciosiosOrganizacijosKodas"
    JOIN (
    SELECT "ataskaitaId", COUNT(*) AS cnt FROM "atn1dalyviai" GROUP BY "ataskaitaId"
    ) dalyviu ON dalyviu."ataskaitaId" = a.id
GROUP BY a."perkanciosiosOrganizacijosKodas", j.pavadinimas, LEFT (vp."bvpzKodai"[1], 3)
HAVING COUNT(DISTINCT a.id) >= 5
ORDER BY vienoDalyvioProcent DESC
LIMIT 30;
```

### 15. Framework agreement abuse — single-supplier call-offs

`[STT][VPT]` – OSINT: **conditional** (framework establishment documentation)

TOOLS: `execute_query`, `search_sutartys`, `get_sutartis`

GOAL: Detect framework agreements where all call-offs (`tipas = 'PPS'`) go to one supplier.

> **Important caveat**: A single-supplier framework established through an open competitive procedure is legal under
> Lithuanian and EU procurement law. This query flags all single-supplier frameworks regardless of how they were
> established. Always verify the procurement procedure used to set up the framework (`pirkimoBudas`) before treating
> single-supplier call-offs as suspicious.

DETECT:

- Distinct supplier count per framework vs. expected.
- Total value and duration of framework vs. call-off distribution.
- Framework establishment procedure type and competition level.
- Cross-check with single-bidder signals and direct awards.

SQL EXAMPLES:

```sql
-- Framework call-offs (tipas = 'PPS') concentrated to a single supplier per framework
SELECT s."pirkimoNumeris",
       s."perkanciosiosOrganizacijosKodas"             AS pirkejoKodas,
       buyer.pavadinimas                               AS pirkejas,
       COUNT(DISTINCT s."tiekejoKodas")                AS tiekejuKiekis,
       COUNT(*)                                        AS ppsKiekis,
       SUM(s.verte)                                    AS ppsVerte,
       STRING_AGG(DISTINCT supplier.pavadinimas, '; ') AS tiekejaiPav
FROM sutartys s
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = s."tiekejoKodas"
WHERE s.tipas = 'PPS' AND s.istrinta = false AND s."pirkimoNumeris" IS NOT NULL
GROUP BY s."pirkimoNumeris", s."perkanciosiosOrganizacijosKodas", buyer.pavadinimas
HAVING COUNT(DISTINCT s."tiekejoKodas") = 1 AND COUNT(*) >= 3
ORDER BY ppsVerte DESC
LIMIT 30;
```

### 16. Shared back-office — competing companies with the same address or domain

`[STT][KT][FNTT]` – OSINT: **yes** (physical site checks, business registries)

TOOLS: `execute_query`, `get_juridinis`, `search_juridiniai`

GOAL: Detect co-bidders sharing registered address or domain registrant.

DETECT:

- Shared legal address in `jarCsv` among active bidders with wins.
- Shared domain in `domenai` among suppliers.
- Overlapping contract timelines and CPV categories.
- Cross-link with PINREG persons to strengthen suspicion.

SQL EXAMPLES:

```sql
-- Supplier pairs sharing the same registered address and appearing as co-bidders
SELECT j1.adresas,
       j1."jarKodas"                    AS kodas1,
       j1.pavadinimas                   AS pavadinimas1,
       j2."jarKodas"                    AS kodas2,
       j2.pavadinimas                   AS pavadinimas2,
       COUNT(DISTINCT d1."ataskaitaId") AS bendruPirkimuKiekis
FROM "jarCsv" j1
         JOIN "jarCsv" j2 ON j2.adresas = j1.adresas AND j2."jarKodas" > j1."jarKodas"
         JOIN "atn1dalyviai" d1 ON d1.kodas = j1."jarKodas"::text
JOIN "atn1dalyviai" d2
ON d2."ataskaitaId" = d1."ataskaitaId" AND d2.kodas = j2."jarKodas":: text
WHERE j1.adresas IS NOT NULL AND LENGTH(j1.adresas) > 10
GROUP BY j1.adresas, j1."jarKodas", j1.pavadinimas, j2."jarKodas", j2.pavadinimas
HAVING COUNT(DISTINCT d1."ataskaitaId") >= 2
ORDER BY bendruPirkimuKiekis DESC
LIMIT 30;
```

```sql
-- Competing suppliers sharing the same internet domain registrant (shared online infrastructure)
-- NOTE: this does NOT verify the companies co-bid; filter further to pairs that appeared as co-bidders.
SELECT d1."savininkoKodas"                AS registrantoKodas1,
       d1.savininkas,
       d1.domain                          AS domenas,
       j1."jarKodas"                      AS kodas1,
       j1.pavadinimas                     AS pavadinimas1,
       j2."jarKodas"                      AS kodas2,
       j2.pavadinimas                     AS pavadinimas2,
       COUNT(DISTINCT dal1."ataskaitaId") AS bendruPirkimuKiekis
FROM domenai d1
         JOIN domenai d2
              ON d2.domain = d1.domain AND d2."savininkoKodas" <> d1."savininkoKodas"
                  AND d2."savininkoKodas" > d1."savininkoKodas"
         JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1."savininkoKodas"
JOIN "jarCsv" j2
ON j2."jarKodas":: text = d2."savininkoKodas"
-- Restrict to pairs that actually co-bid to eliminate noise
    JOIN "atn1dalyviai" dal1 ON dal1.kodas = j1."jarKodas":: text
    JOIN "atn1dalyviai" dal2
    ON dal2."ataskaitaId" = dal1."ataskaitaId" AND dal2.kodas = j2."jarKodas":: text
GROUP BY d1."savininkoKodas", d1.savininkas, d1.domain,
    j1."jarKodas", j1.pavadinimas, j2."jarKodas", j2.pavadinimas
HAVING COUNT(DISTINCT dal1."ataskaitaId") >= 2
ORDER BY bendruPirkimuKiekis DESC
LIMIT 50;
```

### 17. Price cartel — suspiciously uniform bid prices across a CPV category

`[KT][STT]` – OSINT: **conditional** (sector cost structures)

TOOLS: `execute_query`

GOAL: Detect tenders with abnormally low price variation among independent bidders — a primary cartel signal. Also
screen
CPV categories nationally for uniformity as a secondary filter to identify categories warranting deeper per-tender
analysis.

> **Methodology note**: The correct unit of analysis for price cartel detection is the **individual tender** (comparing
> bids submitted by different suppliers within the same procurement). Computing CV across all tenders in a CPV group
> nationally conflates different buyers, specifications, years, and scales — the resulting CV tells you almost nothing
> about cartel behaviour. Use the per-tender query (first SQL below) as the primary detection method. The cross-tender
> national-average query (second SQL) is a coarse screening tool only; low national CV in commodity categories may be
> entirely normal.

DETECT:

- Coefficient of variation of bid prices **within individual tenders** (CV < 5% with ≥ 3 bidders is a strong signal).
- Repeat suppliers in tenders with suspiciously uniform prices.
- Clustering of low-variation tenders in certain buyers or regions.

SQL EXAMPLES:

```sql
-- PRIMARY: Per-tender CV of bid prices — low within-tender variation among ≥3 bidders is a cartel signal
SELECT e."ataskaitaId" AS pirkimasId,
       a."pirkimoNumeris", LEFT (vp."bvpzKodai"[1], 3) AS cpvGrupe, COUNT(e.id) AS pasiulymuKiekis, ROUND(AVG(e.kaina:: numeric), 0) AS vidutineKaina, ROUND(MIN(e.kaina:: numeric), 0) AS minKaina, ROUND(MAX(e.kaina:: numeric), 0) AS maxKaina, ROUND(STDDEV(e.kaina:: numeric) / NULLIF(AVG(e.kaina:: numeric), 0) * 100, 1) AS variacijosKoefProc
FROM "atn1pasiulymuEile" e
    JOIN "atn1ataskaitos" a
ON a.id = e."ataskaitaId"
    JOIN "viesiejiPirkimai" vp ON vp."pirkimoId" = a."pirkimoNumeris"
WHERE e.kaina ~ '^\d+(\.\d+)?$' AND vp."bvpzKodai" IS NOT NULL
GROUP BY e."ataskaitaId", a."pirkimoNumeris", LEFT (vp."bvpzKodai"[1], 3)
HAVING COUNT(e.id) >= 3
   AND STDDEV(e.kaina:: numeric) / NULLIF(AVG(e.kaina:: numeric)
     , 0) * 100
     < 5
ORDER BY variacijosKoefProc ASC
LIMIT 50;
```

```sql
-- SECONDARY SCREENING ONLY: Cross-tender CV by CPV group nationally (commodity-like categories
-- may show naturally low CV — always investigate individual tenders before drawing conclusions)
SELECT LEFT (vp."bvpzKodai"[1], 3) AS cpvGrupe, COUNT(DISTINCT e."ataskaitaId") AS pirkimuKiekis, COUNT(e.id) AS pasiulymuKiekis, ROUND(AVG(e.kaina:: numeric), 0) AS vidutineKaina, ROUND(STDDEV(e.kaina:: numeric) / NULLIF(AVG(e.kaina:: numeric), 0) * 100, 1) AS variacijosKoefProc
FROM "atn1pasiulymuEile" e
    JOIN "atn1ataskaitos" a
ON a.id = e."ataskaitaId"
    JOIN "viesiejiPirkimai" vp ON vp."pirkimoId" = a."pirkimoNumeris"
WHERE e.kaina ~ '^\d+(\.\d+)?$' AND vp."bvpzKodai" IS NOT NULL
GROUP BY LEFT (vp."bvpzKodai"[1], 3)
HAVING COUNT(DISTINCT e."ataskaitaId") >= 10 AND AVG(e.kaina:: numeric) > 0
ORDER BY variacijosKoefProc ASC
LIMIT 30;
```

## Partially supported and extended themes

### 18. Contract amendment escalation — low bid, then value inflated through amendments

`[STT][FNTT][VK]` – OSINT: **yes** (audit reports, media on overruns)

TOOLS: `execute_query`, `get_sutartis`, `search_failai`, `get_failas_tekstas`

GOAL: Detect suppliers who systematically under-bid then inflate via amendments.

DETECT:

- `faktineIvykdimoVerte/verte` ratio >1.5 by supplier and buyer.
- Buyers with highest tolerance for overruns (systemic behaviour).
- Consistent under-bid pattern by supplier (often cheapest winner) followed by high amendment ratios.

SQL EXAMPLES:

```sql
-- Suppliers systematically winning cheap then inflating via amendments (low-bid-then-inflate)
SELECT s."tiekejoKodas",
       j.pavadinimas                                                        AS tiekejas,
       COUNT(*)                                                             AS sutarciuKiekis,
       SUM(s.verte)                                                         AS totalVerte,
       ROUND(AVG(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0)), 2)         AS vidutinisSantykis,
       COUNT(CASE WHEN s."faktineIvykdimoVerte" > s.verte * 1.5 THEN 1 END) AS stipriuVirsijimuKiekis
FROM sutartys s
         JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
WHERE s."faktineIvykdimoVerte" IS NOT NULL AND s.verte > 0 AND s.istrinta = false
GROUP BY s."tiekejoKodas", j.pavadinimas
HAVING COUNT(*) >= 5 AND AVG(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0)) > 1.3
ORDER BY stipriuVirsijimuKiekis DESC
LIMIT 30;
```

GAP (DATA):

- `dokumentai` JSONB unstructured; CVPIS amendment sequence not fully ingested.

### 19. Municipal company favoritism — buyer awards contracts to its own subsidiary

`[STT][VK][VPT]` – OSINT: **yes** (municipal decisions, press)

TOOLS: `execute_query`, `get_pinreg_jar`, `search_sutartys`

GOAL: Detect municipality awarding contracts to its own subsidiary via shared-person or ownership proxies.

DETECT:

- Value share to companies with shared PINREG persons with buyer.
- Procedure type distribution (direct vs. competitive) for such pairs.
- Structural patterns where one municipal company or group company receives majority of local contracts.

SQL EXAMPLES:

```sql
-- Buyer awarding disproportionate value to companies sharing PINREG persons with the buyer
SELECT pr_b."jarKodas"                                    AS pirkejoKodas,
       buyer.pavadinimas                                  AS pirkejas,
       pr_s."jarKodas"                                    AS "tiekejoKodas",
       supplier.pavadinimas                               AS tiekejas,
       COUNT(DISTINCT pr_b.vardas || ' ' || pr_b.pavarde) AS bendruAsmenuKiekis,
       COUNT(DISTINCT s."sutartiesUnikalusId")            AS sutarciuKiekis,
       SUM(s.verte)                                       AS totalVerte,
       STRING_AGG(DISTINCT s.tipas, ', ')                 AS procedurosTipai
FROM "pinregJuridiniaiRysiai" pr_b
         JOIN "pinregJuridiniaiRysiai" pr_s
              ON pr_s.vardas = pr_b.vardas AND pr_s.pavarde = pr_b.pavarde
                  AND pr_s."jarKodas" <> pr_b."jarKodas"
         JOIN sutartys s
              ON s."perkanciosiosOrganizacijosKodas" = pr_b."jarKodas"
                  AND s."tiekejoKodas" = pr_s."jarKodas" AND s.istrinta = false
         JOIN "jarCsv" buyer ON buyer."jarKodas"::text = pr_b."jarKodas"
JOIN "jarCsv" supplier
ON supplier."jarKodas":: text = pr_s."jarKodas"
GROUP BY pr_b."jarKodas", buyer.pavadinimas, pr_s."jarKodas", supplier.pavadinimas
HAVING SUM(s.verte) > 100000
ORDER BY totalVerte DESC
LIMIT 30;
```

GAP (DATA): (e.g. JAR "SAVIVALDYBĖ" participation data) — proxy via shared persons and
addresses.

### 20. Restricted procedure manipulation — buyer hand-picks the same invitees

`[STT][KT][VPT]` – OSINT: **yes** (invitation letters, internal rules)

TOOLS: `execute_query`, `search_viesieji_pirkimai`, `get_viesasis_pirkimas`

GOAL: Detect restricted/negotiated procedure overuse and audit findings for direct awards.

DETECT:

- Procedure mix (restricted/negotiated vs. open) by buyer and CPV.
- `neskelbiamosDerybos` audit findings by buyer.
- Recurring small circle of invitees (if/when invitation data is available in future).

SQL EXAMPLES:

```sql
-- Non-public negotiation audit findings ("neskelbiamosDerybos") grouped by buyer
SELECT nd."jarKodas"                                 AS pirkejoKodas,
       nd."jarPavadinimas"                           AS pirkejas,
       COUNT(*)                                      AS radininiuKiekis,
       STRING_AGG(nd.isvada, ' | ' ORDER BY nd.data) AS isvados,
       MIN(nd.data)                                  AS pirmasis,
       MAX(nd.data)                                  AS paskutinis
FROM "neskelbiamosDerybos" nd
GROUP BY nd."jarKodas", nd."jarPavadinimas"
ORDER BY radininiuKiekis DESC
LIMIT 30;
```

GAP (DATA):

- `atn1dalyviai` records submitted bids only, not invitees — cannot detect excluded qualified suppliers yet.

### 21. Political connection favoritism — companies linked to party donors or politicians

`[STT][FNTT]` – OSINT: **yes** (VRK donor lists, political office data)

TOOLS: (future) VRK donors dataset, `execute_query`, `get_pinreg_jar`

GOAL: Detect companies linked to party donors or elected officials receiving disproportionate contract value.

DETECT:

- Overlap between company beneficial owners or directors and political donors/party officials.
- Contract value share for politically connected companies vs. peers.

> **Note**: No VRK donor or political office data in current schema. Use OSINT and cross-reference names found via
> `get_pinreg_jar` against public VRK donor lists manually.

SQL EXAMPLES:

```sql
-- Companies with very high total contract value and persons linked to many organisations (proxy for political exposure)
SELECT pr.vardas,
       pr.pavarde,
       COUNT(DISTINCT pr."jarKodas") AS rysiuKiekis,
       SUM(stats.totalVerte)         AS visoSutarciuVerte
FROM "pinregJuridiniaiRysiai" pr
         JOIN (SELECT "tiekejoKodas", SUM(verte) AS totalVerte
               FROM sutartys
               WHERE istrinta = false
               GROUP BY "tiekejoKodas") stats ON stats."tiekejoKodas" = pr."jarKodas"
GROUP BY pr.vardas, pr.pavarde
HAVING COUNT(DISTINCT pr."jarKodas") >= 3
ORDER BY visoSutarciuVerte DESC
LIMIT 30;
```

GAP (DATA):

- Needs VRK donor database and politician office/mandate register.

> For human investigator: when considering escalation to STT on political favouritism, combine MCP signals with OSINT
> from VRK, Seimas and savivaldybių tarybų registers, and media investigations. FNTT becomes relevant when donations
> correlate with suspicious financial flows or EU funds cases.

### 22. Fictitious deliverables — contract marked complete but work never done

`[STT][FNTT][VK]` – OSINT: **yes** (on-site inspections, beneficiary reports, media)

TOOLS: `get_juridinis`, `get_sutartis`, `search_failai`, `get_failas_tekstas`

GOAL: Detect contracts where payment is confirmed but delivery is doubtful.

DETECT:

- `faktineIvykdimoVerte` paid in full despite weak or missing acceptance documentation.
- VDI violations (`vdiPazeidimai`) during execution suggesting lack of workforce capacity.
- For works contracts, repeated complaints or negative findings in oversight reports (OSINT).

SQL EXAMPLES:

```sql
-- Fully paid contracts to suppliers with VDI labour violations during the contract execution period
SELECT s."sutartiesUnikalusId",
       s.pavadinimas,
       s."sudarymoData",
       s."galiojimoData",
       s."tiekejoKodas",
       j.pavadinimas          AS tiekejas,
       s.verte,
       s."faktineIvykdimoVerte",
       COUNT(DISTINCT vdi.id) AS vdiPazeidimuKiekis
FROM sutartys s
         JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
JOIN "vdiPazeidimai" vdi
ON vdi."jarKodas" = s."tiekejoKodas"
-- Only violations that occurred during contract execution; verify date column name via get_schema.
-- AND vdi."pažeidimoDatas" BETWEEN s."sudarymoData" AND COALESCE(s."galiojimoData", s."sudarymoData" + INTERVAL '2 years')
WHERE s."faktineIvykdimoVerte" IS NOT NULL
  AND s."faktineIvykdimoVerte" >= s.verte * 0.95
  AND s.istrinta = false
GROUP BY s."sutartiesUnikalusId", s.pavadinimas, s."sudarymoData", s."galiojimoData",
    s."tiekejoKodas", j.pavadinimas, s.verte, s."faktineIvykdimoVerte"
HAVING COUNT(DISTINCT vdi.id) > 0
ORDER BY s.verte DESC
LIMIT 30;
```

GAP (DATA):

- No SABIS invoice-level data or detailed STT/NKT audit trails in schema.

### 23. Vendor lock-in — incumbent supplier structural monopoly

`[STT][KT][VK]` – OSINT: **conditional** (system ownership, IP clauses)

TOOLS: `execute_query`, `search_sutartys`, `get_juridinis`

GOAL: Detect suppliers whose relationship with a single buyer is self-reinforcing — system builder becomes sole
maintenance provider and captures future related contracts.

DETECT:

- Single-buyer concentration >70% of supplier's total contract value (min total and contract count thresholds).
- All or most contracts to that buyer via direct/negotiated procedures.
- Escalating contract count and value over years.
- No other supplier winning same CPV from same buyer.
- Litigation (`bylojeKaip = 'IEŠKOVAS'`) against buyers who attempt to switch suppliers.

SQL EXAMPLES:

```sql
-- Suppliers with >70% of total revenue from a single buyer (structural lock-in signal)
WITH supplier_totals AS (SELECT "tiekejoKodas", SUM(verte) AS totalVerte, COUNT(*) AS kiekis
                         FROM sutartys
                         WHERE istrinta = false
                           AND "sudarymoData" >= CURRENT_DATE - INTERVAL '5 years'
                         GROUP BY "tiekejoKodas"
                         HAVING SUM(verte) > 500000 AND COUNT(*) >= 5),
     buyer_share AS (SELECT "perkanciosiosOrganizacijosKodas", "tiekejoKodas", SUM(verte) AS verteUzPirkejo
                     FROM sutartys
                     WHERE istrinta = false
                       AND "sudarymoData" >= CURRENT_DATE - INTERVAL '5 years'
                     GROUP BY 1, 2)
SELECT bs."tiekejoKodas",
       j_s.pavadinimas                                     AS tiekejas,
       bs."perkanciosiosOrganizacijosKodas"                AS pirkejoKodas,
       j_b.pavadinimas                                     AS pirkejas,
       st.totalVerte                                       AS tiekejoVisoVerte,
       bs.verteUzPirkejo,
       ROUND(100.0 * bs.verteUzPirkejo / st.totalVerte, 1) AS koncentracijaProc
FROM buyer_share bs
         JOIN supplier_totals st ON st."tiekejoKodas" = bs."tiekejoKodas"
         JOIN "jarCsv" j_s ON j_s."jarKodas"::text = bs."tiekejoKodas"
JOIN "jarCsv" j_b
ON j_b."jarKodas":: text = bs."perkanciosiosOrganizacijosKodas"
WHERE bs.verteUzPirkejo / st.totalVerte > 0.70
ORDER BY bs.verteUzPirkejo DESC
LIMIT 30;
```

GAP (DATA):

- No contract clause data or IP ownership information available in structured form; lock-in mechanism (e.g. proprietary
  code, restrictive SLA clauses) only visible in contract texts.

## New / clarified themes for Lithuanian context

### 24. EU funds irregularities and cross-border fraud patterns

`[FNTT][VK][STT]` – OSINT: **yes** (EU OLAF/EPPO cases, cross-border company data)

TOOLS: `execute_query`, `get_juridinis`, `search_sutartys`, `get_sutartis`

GOAL: Detect patterns in EU-funded procurements and projects that resemble known EU funds fraud schemes (overpricing,
fictitious suppliers, self-dealing across borders).

DETECT:

- Concentration of irregularities in specific operational programmes or measures (CPVA-based flags, when available).
- Clusters of projects where expenditure is later found ineligible in VK audits (once data integrated).
- Cross-border supplier networks where Lithuanian beneficiary works with the same small set of foreign suppliers.
- Early termination of contracts, repeated project modifications, or high rate of budget reallocations.

SQL EXAMPLES:

```sql
-- EU-funded contracts ("esFinansavimas"=true) with high cost overruns, joined to CPVA project data
SELECT s."sutartiesUnikalusId",
       s.pavadinimas,
       s."perkanciosiosOrganizacijosKodas"                     AS pirkejoKodas,
       jb.pavadinimas                                          AS pirkejas,
       s."tiekejoKodas",
       js.pavadinimas                                          AS tiekejas,
       s.verte,
       s."faktineIvykdimoVerte",
       ROUND(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0), 2) AS santykis,
       cp."projektoNr",
       cp."pirkimoSutartiesSumaSusijusiSuProjektu"             AS cpvaVerte
FROM sutartys s
         JOIN "jarCsv" jb ON jb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
JOIN "jarCsv" js
ON js."jarKodas":: text = s."tiekejoKodas"
    LEFT JOIN "cpvaProjektuSutartys" cp ON cp."pirkimoSutartiesNr" = s."sutartiesUnikalusId":: text
    JOIN "viesiejiPirkimai" vp ON vp."pirkimoId" = s."pirkimoNumeris"
WHERE vp."esFinansavimas" = true
  AND s."faktineIvykdimoVerte" IS NOT NULL
  AND s.verte
    > 0
  AND s."faktineIvykdimoVerte"
    > s.verte * 1.3
  AND s.istrinta = false
ORDER BY santykis DESC
LIMIT 30;
```

> For human investigator: EPPO and OLAF are key external partners on EU funds fraud; FNTT leads financial crime
> investigation domestically, VK provides systemic audit findings. When OSINT or VK reports show high irregularity rates
> in a specific programme, use this theme to prioritise procurement-level analysis.

### 25. Money-laundering indicators around procurement flows

`[FNTT][STT]` – OSINT: **yes** (beneficiary/SAR mentions in FNTT releases)

TOOLS: `execute_query`, future accounting/payment tables, `get_juridinis`

GOAL: Flag procurement cases where contract payment flows show money-laundering typologies (layering, use of high-risk
sectors, circular flows).

> **Important caveat**: CPV diversification alone (working across 5+ CPV divisions) is a very weak and
> high-false-positive
> indicator. Large companies, construction firms, and technology integrators naturally span many CPV divisions. Do not
> treat this query as a standalone money-laundering signal. Use it only as a filtering step to identify companies with
> an unusually broad scope **combined with** other risk indicators (shell company signals, conflict of interest,
> offshore
> UBO structures).

DETECT (requires future integration with financial transaction data):

- Payments quickly transferred to other jurisdictions or high-risk entities.
- Use of multiple small contracts to channel funds through the same intermediaries.
- Mismatches between contract scope and supplier’s usual business or risk profile (e.g. sudden expansion into unrelated
  sectors).

SQL EXAMPLES:

```sql
-- Suppliers diversifying into many unrelated CPV divisions (>=5 divisions) with high total value (layering signal)
SELECT s."tiekejoKodas",
       j.pavadinimas                               AS tiekejas,
       COUNT(DISTINCT LEFT (vp."bvpzKodai"[1], 2)) AS skirtinguCpvDivizijuKiekis,
       COUNT(DISTINCT s."sutartiesUnikalusId")     AS sutarciuKiekis,
       SUM(s.verte)                                AS totalVerte
FROM sutartys s
         JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
JOIN "viesiejiPirkimai" vp
ON vp."pirkimoId" = s."pirkimoNumeris"
WHERE s.istrinta = false AND vp."bvpzKodai" IS NOT NULL
GROUP BY s."tiekejoKodas", j.pavadinimas
HAVING COUNT(DISTINCT LEFT (vp."bvpzKodai"[1], 2)) >= 5 AND SUM(s.verte) > 200000
ORDER BY skirtinguCpvDivizijuKiekis DESC
LIMIT 30;
```

GAP (DATA):

- Current schema focuses on procurement and registries, not bank transaction data.
- Money-laundering analysis largely requires FNTT data and STR reports.

### 26. Systemic internal control weaknesses in buyers

`[VK][STT][VPT]` – OSINT: **yes** (VK, VPT, internal audit reports)

TOOLS: `execute_query`, `search_sutartys`

GOAL: Identify buyers whose internal control weaknesses make them high-risk for corruption and fraud.

DETECT:

- High share of non-competitive procedures across all CPVs.
- Frequent corrections or cancellations of procurements.
- High rate of contracts with significant overruns or repeated amendments.
- Repeated audit findings about conflict-of-interest management, planning, or contract management weaknesses.

SQL EXAMPLES:

```sql
-- Buyers ranked by systemic weakness indicators: overruns + high non-competitive procedure share
SELECT s."perkanciosiosOrganizacijosKodas"                                  AS pirkejoKodas,
       jb.pavadinimas                                                       AS pirkejas,
       COUNT(*)                                                             AS sutarciuKiekis,
       COUNT(CASE WHEN s."faktineIvykdimoVerte" > s.verte * 1.3 THEN 1 END) AS virsijimukiekis,
       ROUND(100.0 * COUNT(CASE WHEN s."faktineIvykdimoVerte" > s.verte * 1.3 THEN 1 END) / COUNT(*),
             1)                                                             AS virsijimoProcent,
       COUNT(CASE WHEN vp.statusas IS NOT NULL AND vp."pirkimoBudas" NOT ILIKE '%atvir%' THEN 1
             END)                                                           AS nekonkurenciniai,
       ROUND(100.0 * COUNT(CASE WHEN vp.statusas IS NOT NULL AND vp."pirkimoBudas" NOT ILIKE '%atvir%' THEN 1 END) /
             COUNT(*),
             1)                                                             AS nekonkurProcent
FROM sutartys s
         JOIN "jarCsv" jb ON jb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
LEFT JOIN "viesiejiPirkimai" vp
ON vp."pirkimoId" = s."pirkimoNumeris"
WHERE s.istrinta = false AND s."faktineIvykdimoVerte" IS NOT NULL AND s.verte > 0
GROUP BY s."perkanciosiosOrganizacijosKodas", jb.pavadinimas
HAVING COUNT(*) >= 10
ORDER BY virsijimoProcent DESC
LIMIT 30;
```

> For human investigator: VK and VPT audits highlight systemic weaknesses in internal control and risk management; use
> their findings as context for MCP analytical outputs about the same institutions.

### 27. Sector-specific red flags (healthcare, construction, IT)

`[STT][FNTT][VK]` – OSINT: **yes** (sector regulators, professional bodies)

TOOLS: `execute_query`, `search_sutartys`, `search_viesieji_pirkimai`, `get_sutartis`

GOAL: Tailor risk detection to sectors known in Lithuania to be high-risk for corruption and procurement violations (
e.g. healthcare, construction, IT).

DETECT:

- In healthcare: repeated purchases of branded medicines/devices with limited competition; unusual technical
  specifications in medical equipment tenders.
- In construction: repeated cost overruns, change orders, and low initial bids followed by many amendments.
- In IT: vendor lock-in patterns, proprietary standards, and recurrent single-supplier maintenance contracts.

SQL EXAMPLES:

```sql
-- Healthcare (CPV 33xxx): tenders with single bidder only — limited competition signal
SELECT vp."pirkimoId",
       vp.pavadinimas,
       a."pirkimoObjektoPavadinimas",
       vp."numatomaVerteEUR"   AS verteEur,
       COUNT(DISTINCT d.kodas) AS dalyviuKiekis
FROM "viesiejiPirkimai" vp
         JOIN "atn1ataskaitos" a ON a."pirkimoNumeris" = vp."pirkimoId"
         JOIN "atn1dalyviai" d ON d."ataskaitaId" = a.id
WHERE EXISTS (SELECT 1 FROM unnest(vp."bvpzKodai") c WHERE c LIKE '33%')
GROUP BY vp."pirkimoId", vp.pavadinimas, a."pirkimoObjektoPavadinimas", vp."numatomaVerteEUR"
HAVING COUNT(DISTINCT d.kodas) = 1
   AND vp."numatomaVerteEUR" > 30000
ORDER BY verteEur DESC
LIMIT 30;
```

```sql
-- IT sector (CPV 72xxx): same supplier winning repeatedly from same buyer across 5+ years (lock-in signal)
SELECT s."perkanciosiosOrganizacijosKodas"                                                 AS pirkejoKodas,
       jb.pavadinimas                                                                      AS pirkejas,
       s."tiekejoKodas",
       js.pavadinimas                                                                      AS tiekejas,
       COUNT(*)                                                                            AS sutarciuKiekis,
       SUM(s.verte)                                                                        AS totalVerte,
       MIN(EXTRACT(YEAR FROM s."sudarymoData"))                                            AS pirmiMetai,
       MAX(EXTRACT(YEAR FROM s."sudarymoData"))                                            AS paskutiMetai,
       MAX(EXTRACT(YEAR FROM s."sudarymoData")) - MIN(EXTRACT(YEAR FROM s."sudarymoData")) AS metaiAktyvus
FROM sutartys s
         JOIN "jarCsv" jb ON jb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
JOIN "jarCsv" js
ON js."jarKodas":: text = s."tiekejoKodas"
    JOIN "viesiejiPirkimai" vp ON vp."pirkimoId" = s."pirkimoNumeris"
WHERE EXISTS (SELECT 1 FROM unnest(vp."bvpzKodai") c WHERE c LIKE '72%') AND s.istrinta = false
GROUP BY s."perkanciosiosOrganizacijosKodas", jb.pavadinimas, s."tiekejoKodas", js.pavadinimas
HAVING COUNT(*) >= 5 AND MAX(EXTRACT(YEAR FROM s."sudarymoData")) - MIN(EXTRACT(YEAR FROM s."sudarymoData")) >= 5
ORDER BY totalVerte DESC
LIMIT 30;
```

> For human investigator: sector context matters. Combine MCP outputs with sector-specific supervisory authorities and
> professional standards bodies when assessing risk severity.
>
> **STT contact**: when MCP themes show strong patterns in bid rigging, conflict of interest, unjustified direct
> awards, municipal favouritism, or vendor lock-in, STT is a natural escalation partner. Attach: key MCP queries,
> summarised metrics (e.g. concentration measures), and any OSINT about involved officials.
>
> **FNTT contact**: when EU funds, inflated prices, shell companies, or money flows suggest fraud or money laundering,
> FNTT interest increases. Attach: contract lists with values and dates, beneficiary and supplier structures (UBO
> analysis), and any signs of cross-border flows.
>
> **VPT contact**: when issues are primarily procedural (threshold splitting, wrong procedure type, poor tender
> design) but not yet clearly criminal, VPT may be the first point of contact.
>
> **VK contact**: when patterns appear systemic in a specific sector or institution (e.g. repeated findings across
> years), VK’s audit mandate is key for structural remedies.
>
> **KT contact**: when cartels or bid-rigging patterns are strong (bid rotation, cover bidding, price cartels), KT has
> specialised enforcement tools and sanctions.
>
> In written referrals, clearly separate: (1) automated MCP analytical indicators, (2) corroborating evidence from OSINT
> and audits, and (3) open questions requiring investigative powers (e.g. bank data, internal correspondence). This
> alignment with institutional mandates will increase acceptance and effective follow-up.
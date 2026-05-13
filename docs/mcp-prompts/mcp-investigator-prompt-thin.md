# MCP Risk Intelligence Tool — Enhanced Investigation Themes for Lithuanian Public Procurement

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

### 3. Bid rotation / carousel

`[STT][KT]` – OSINT: **conditional** (sector analysis, competitor structure)

TOOLS: `execute_query`, `search_sutartys`

GOAL: Detect companies alternating wins in same CPV — never competing simultaneously.

DETECT:

- Win value share by period per CPV for a small cluster of suppliers.
- Mutual bidding absence (A wins when B does not participate and vice versa).
- Cross-appearance as cover bidders for each other in other buyers’ tenders.
- Rotation schemes aligned with calendar years, budget cycles, or EU funding phases.

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

### 6. Geographic monopoly / local capture

`[STT][VK][VPT]` – OSINT: **yes** (local media, municipal council decisions)

TOOLS: `execute_query`, `search_sutartys`, `get_juridinis`

GOAL: Detect single-supplier dominance in one municipality or CPV category.

DETECT:

- Value share by supplier per municipality and CPV over multi-year periods.
- Competitors who stopped bidding or winning over time after one supplier begins to dominate.
- Local registration bias (buyer awarding mostly to locally registered companies despite national markets).
- Officer→supplier PINREG connections for local officials.

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

### 9. Compliance and blacklist cross-check

`[STT][FNTT][VPT]` – OSINT: **conditional** (sanction lists, media on fraud)

TOOLS: `get_juridinis`, `execute_query`

GOAL: Check all blacklists, sanctions, and violations for company and linked parties.

DETECT:

- Current/expired debarment (melagingiTiekejai, nepatikimiTiekejai) and repeat non-compliance.
- VDI violations (vdiPazeidimai) during contract execution periods.
- Court cases where supplier is claimant against former or current buyers (`bylojeKaip = 'IEŠKOVAS'`).
- Linked-company blacklist status (group companies, same owners, same address/domain).

### 10. Network — second-degree connections and corporate webs

`[STT][FNTT]` – OSINT: **yes** (JAR extracts, foreign registers, company websites)

TOOLS: `get_pinreg_jar`, `get_pinreg_asmuo`, `execute_query`, `search_juridiniai`, `get_juridinis`

GOAL: Map corporate control network beyond direct ownership.

DETECT:

- Directors/shareholders → second-degree companies → public contracts.
- Shared address/domain clusters; offices shared among multiple bidders.
- Ownership changes around contract award dates (transfers before large tenders).
- Foreign beneficial ownership indicators (non-Lithuanian entities with unclear activity).

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

### 13. Revolving door — procurement officer joins winning supplier

`[STT]` – OSINT: **yes** (LinkedIn, public CVs)

TOOLS: `execute_query`, `get_pinreg_asmuo`, `get_pinreg_jar`

GOAL: Find buyer-side staff who moved to suppliers that won contracts from their former employer.

DETECT:

- Person left buyer organisation and joined supplier within a defined time window (e.g. 2 years).
- Contracts awarded to that supplier after move date by same buyer.
- Changes in procedure type and competition intensity before and after move.

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

### 16. Shared back-office — competing companies with the same address or domain

`[STT][KT][FNTT]` – OSINT: **yes** (physical site checks, business registries)

TOOLS: `execute_query`, `get_juridinis`, `search_juridiniai`

GOAL: Detect co-bidders sharing registered address or domain registrant.

DETECT:

- Shared legal address in `jarCsv` among active bidders with wins.
- Shared domain in `domenai` among suppliers.
- Overlapping contract timelines and CPV categories.
- Cross-link with PINREG persons to strengthen suspicion.

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

## Partially supported and extended themes

### 18. Contract amendment escalation — low bid, then value inflated through amendments

`[STT][FNTT][VK]` – OSINT: **yes** (audit reports, media on overruns)

TOOLS: `execute_query`, `get_sutartis`, `search_failai`, `get_failas_tekstas`

GOAL: Detect suppliers who systematically under-bid then inflate via amendments.

DETECT:

- `faktineIvykdimoVerte/verte` ratio >1.5 by supplier and buyer.
- Buyers with highest tolerance for overruns (systemic behaviour).
- Consistent under-bid pattern by supplier (often cheapest winner) followed by high amendment ratios.

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



GAP (DATA):

- Needs VRK donor database and politician office/mandate register.

### 22. Fictitious deliverables — contract marked complete but work never done

`[STT][FNTT][VK]` – OSINT: **yes** (on-site inspections, beneficiary reports, media)

TOOLS: `get_juridinis`, `get_sutartis`, `search_failai`, `get_failas_tekstas`

GOAL: Detect contracts where payment is confirmed but delivery is doubtful.

DETECT:

- `faktineIvykdimoVerte` paid in full despite weak or missing acceptance documentation.
- VDI violations (`vdiPazeidimai`) during execution suggesting lack of workforce capacity.
- For works contracts, repeated complaints or negative findings in oversight reports (OSINT).

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





# MCP Risk Intelligence Tool — Proposal

## The insight

A human says: *"This company feels off — they keep winning government contracts in my town and they only have 2
employees."*

The human is **not** a researcher. They won't write queries. They won't pick from a menu of pre-built risk patterns.
They have **intuition** and **context** that no database has.

The LLM already knows:

- What bid rigging looks like
- What shell company patterns look like
- What conflict-of-interest networks look like
- OECD red flag indicators, academic fraud typologies, Benford's law, etc.

What the LLM **lacks** is the ability to **look at the actual data** and run the investigation itself. It needs to form
hypotheses and test them against real records — iteratively, like an analyst would.

Pre-built materialized views kill this. They assume you know the questions in advance. The whole point is that you
don't. The human brings the smell, the LLM brings the methodology, and the data brings the truth.

Viespirkiai is a **data provider, not a fraud research lab**. Encoding every fraud pattern into SQL views is neither
sustainable nor scalable — that knowledge lives in the LLM and evolves with every model update. Patterns change, new
fraud typologies emerge, and LLMs get smarter. The tool must let the intelligence evolve without code changes.

---

## Approach: safe, general-purpose analytical query interface

One MCP tool that gives the LLM **read-only, constrained, audited SQL access** to the procurement database. Not a menu
of queries. Not a DSL. The LLM writes SQL, the tool validates and executes it safely.

### Why SQL is the right interface

- The LLM already writes excellent SQL. No training needed.
- SQL is the only language expressive enough to cover filtering, aggregation, window functions, graph traversal (
  recursive CTEs), and statistical analysis in one syntax.
- Any custom DSL (EBNF, predicate logic, rule engine) will be strictly less expressive than SQL, and takes months to
  build what PostgreSQL already does.
- Every BI/analytics platform (Metabase, Redash, Superset, Databricks) solved this same problem the same way:
  constrained SQL execution.

### What the LLM needs to do during an investigation

1. **Explore the schema** — "what columns does `sutartys` have?"
2. **Run analytical queries** — "aggregate contract values by supplier, joined with sodra employee counts"
3. **Traverse relationships** — "who are the people linked to this company, and what other companies are they linked
   to?"
4. **Iterate** — the answer to query 1 informs query 2 informs query 3

This is an **agentic investigation loop**, not a single tool call.

---

## The two MCP tools

### Tool 1: `get_schema`

Safe, simple, no risk. Returns table structure so the LLM can write correct SQL.

```
tool: get_schema
table: "sutartys" | "jarCsv" | "pinregJuridiniaiRysiai" | ...
```

Returns: column names, types, nullable, sample values (first 3 rows), row count. Data sourced from `information_schema`
filtered to the whitelist.

The LLM calls this at the start of an investigation to understand what data is available and how tables relate.

### Tool 2: `execute_investigation_query`

The analytical workhorse. Accepts a SQL SELECT, validates it through a multi-layer guardrail stack, executes it on a
sandboxed read-only connection, and returns results.

```
tool: execute_investigation_query
query: "SELECT ..."
purpose: "Testing hypothesis: supplier X has abnormally high win rate relative to competitors"
```

The `purpose` field is for **audit logging**, not validation — it creates a human-readable trail of why each query was
run.

---

## Guardrail stack

Six layers of defense. Each layer is independent — even if one fails, the others catch it.

```
+---------------------------------------+
|  1. SQL Parser (AST)                  |
|     node-sql-parser / pgsql-parser    |
|     - reject if not a single SELECT   |
|     - reject DDL, DML, COPY, etc.     |
|     - reject multiple statements      |
+---------------------------------------+
|  2. Table/column whitelist            |
|     - AST walk: every table reference |
|       must be in the allowed set      |
|     - block pg_catalog, information_  |
|       schema from direct access       |
|     - block sensitive columns if any  |
+---------------------------------------+
|  3. Function whitelist                |
|     Allow:                            |
|       COUNT, SUM, AVG, MAX, MIN,      |
|       RANK, ROW_NUMBER, DENSE_RANK,   |
|       NTILE, PERCENTILE_CONT,         |
|       LAG, LEAD, FIRST_VALUE,         |
|       COALESCE, NULLIF, GREATEST,     |
|       LEAST, CASE,                    |
|       DATE_TRUNC, EXTRACT, AGE,       |
|       NOW, CURRENT_DATE,              |
|       ROUND, ABS, CEIL, FLOOR, LN,   |
|       UPPER, LOWER, LENGTH, TRIM,     |
|       SUBSTRING, LEFT, RIGHT,         |
|       CONCAT, STRING_AGG,             |
|       ARRAY_AGG, JSONB_BUILD_OBJECT,  |
|       REGEXP_MATCH, REGEXP_REPLACE,   |
|       TO_CHAR, TO_DATE,               |
|       BOOL_AND, BOOL_OR,              |
|       GENERATE_SERIES                 |
|     Block:                            |
|       pg_read_file, pg_read_binary_   |
|       file, dblink, lo_import,        |
|       lo_export, pg_sleep,            |
|       set_config, current_setting,    |
|       pg_terminate_backend,           |
|       pg_cancel_backend, COPY,        |
|       any pg_* admin functions        |
+---------------------------------------+
|  4. Complexity limits                 |
|     - max JOIN count: 6               |
|     - max subquery depth: 3           |
|     - max CTE count: 8               |
|     - LIMIT enforced (cap at 200)     |
|     - WITH RECURSIVE: max depth 5     |
+---------------------------------------+
|  5. Execution sandbox                 |
|     - dedicated read-only PG role     |
|     - statement_timeout = 10s         |
|     - work_mem cap per query          |
|     - row limit enforced via wrapper: |
|       SELECT * FROM (...user SQL...)  |
|       AS q LIMIT 200                  |
+---------------------------------------+
|  6. Audit log                         |
|     - every query logged:             |
|       timestamp, purpose, SQL,        |
|       duration, row count, caller     |
|     - enables post-hoc review         |
+---------------------------------------+
```

### Dedicated read-only PostgreSQL role

The database-level last line of defense. Even if every application-layer guard fails, this role **cannot** modify data
or access system internals.

```sql
CREATE
ROLE mcp_analyst LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE viespirkiai TO mcp_analyst;
GRANT USAGE ON SCHEMA public TO mcp_analyst;

-- SELECT only on analytical tables
GRANT
SELECT
ON
    sutartys,
    "sutartysAtviriDuomenys",
    "sutartysAtviriDuomenysImp",
    "jarCsv",
    jar,
    "viesiejiPirkimai",
    "viesiejiPirkimaiVykdytojai",
    "pinregJuridiniaiRysiai",
    pinreg,
    failai,
    "sabisSutartys",
    "sabisSutarciuSalys",
    "sabisSaskaitos",
    "sabisSaskaituSalys",
    "cpvaProjektuSutartys",
    "cpvaProjektuSarasas",
    "cvppViesiejiPirkimai",
    "eiluciuSkaiciai",
    "bvpzKodai",
    "sodra",
    regitra,
    "nepatikimiTiekejai",
    "melagingiTiekejai",
    jadis,
    "rcInformaciniaiLeidiniaiPranesimai",
    "domenai",
    kotis,
    "balansoAtaskaitos",
    "pelnoNuostoliuAtaskaitos",
    "darboVieta",
    "istatinisKapitalas",
    -- required for bid rigging / carousel analysis (Themes 2, 3)
    "atn1ataskaitos",
    "atn1dalyviai",
    "atn1pasiulymuEile",
    -- required for procedure manipulation analysis (Theme 7)
    "neskelbiamosDerybos",
    -- required for compliance / VDI violations (Theme 9) — was used in v_company but not granted
    "vdiPazeidimai",
    -- required for court case analysis (Theme 9)
    "bylos",
    "bylosDalyviai",
    -- required for tax payment analysis (Theme 1)
    "mokesciai"
    TO mcp_analyst;

-- No INSERT, UPDATE, DELETE, CREATE, DROP — implicit by omission

-- Role-level resource limits
ALTER
ROLE mcp_analyst SET statement_timeout = '10s';
ALTER
ROLE mcp_analyst SET work_mem = '32MB';
```

---

## Subject-matter temporary views

Six `CREATE TEMP VIEW` statements executed at connection open time (session-scoped, no DDL privileges needed).
They solve the three recurring pain points across all investigation queries:

- `jarCsv.jarKodas` is `integer`; all FK columns are `text` — every join needs `::text` cast
- Latest Sodra snapshot requires `ORDER BY data DESC NULLS LAST LIMIT 1` per company
- Common multi-table joins are re-derived from scratch each investigation

The LLM uses views for simple lookups and profile queries; it writes directly against the raw tables for window
functions, CTEs, and recursive graph traversal where full expressiveness is needed.

**Coverage map against the 10 investigator themes:**

| View             | Themes covered    | Critical facts provided                                                    |
|------------------|-------------------|----------------------------------------------------------------------------|
| `v_company`      | 1, 5, 6, 7, 9, 10 | headcount, registration, compliance flags, domain/court/negotiation counts |
| `v_sutartys`     | 1, 2, 3, 5, 8     | contract value, overrun ratio, CPV, buyer/seller names                     |
| `v_pirkimas`     | 5, 6, 7           | procedure type, buyer municipality, estimated value                        |
| `v_person_links` | 4, 10             | person ↔ company edges, spouse links, role type                            |
| `v_dalyviai`     | **2, 3**          | full bidder list, bid amounts, rank — essential for bid rigging            |
| `v_bylos`        | **9**             | court cases per company — blind spot without this view                     |

### `v_company` — company profile with latest headcount and compliance status

```sql
CREATE TEMP VIEW v_company AS
SELECT j."jarKodas"::text,
       j.pavadinimas,
       j.adresas,
       j."registravimoData",
       j."statusoPavadinimas",
       j."statusasNuo",
       -- headcount: Theme 1 (capacity mismatch)
       s.data                                                              AS "sodraData", -- YYYYMM integer
       (COALESCE(s.draustieji, 0) + COALESCE(s.draustieji2, 0))           AS darbuotojai,
       s."vidutinisAtlyginimas",
       s."imokuSuma",                                                                     -- total social tax paid
       -- compliance flags: Theme 9
       EXISTS(SELECT 1
              FROM "melagingiTiekejai" m
              WHERE m."tiekejoJarKodas" = j."jarKodas"::text
                AND (m."itrauktasIki" IS NULL OR m."itrauktasIki" >= CURRENT_DATE)) AS "melagingisTiekejas",
       EXISTS(SELECT 1
              FROM "nepatikimiTiekejai" n
              WHERE n."tiekejoJarKodas" = j."jarKodas"::text
                AND (n."itrauktaIki" IS NULL OR n."itrauktaIki" >= CURRENT_DATE))   AS "nepatikimasTiekejas",
       (SELECT COUNT(*)
        FROM "vdiPazeidimai" v
        WHERE v."jarKodas" = j."jarKodas"::text)                          AS "vdiPazeidimuSkaicius",
       -- court exposure: Theme 9
       (SELECT COUNT(*)
        FROM "bylosDalyviai" bd
        WHERE bd.kodas = j."jarKodas"::text)                              AS "bylosSkaicius",
       -- web footprint: Theme 10 (shared domain / network signals)
       (SELECT COUNT(*)
        FROM domenai d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                    AS "domenaiSkaicius",
       -- procedure abuse signal: Theme 7
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                         AS "neskelbiamosDerybosSkaicius"
FROM "jarCsv" j
LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM sodra
    WHERE "jarKodas" = j."jarKodas"::text
    ORDER BY data DESC NULLS LAST
    LIMIT 1
) s ON true;
```

### `v_sutartys` — contracts with buyer and seller names resolved

```sql
CREATE TEMP VIEW v_sutartys AS
SELECT s."sutartiesUnikalusId",
       s."pirkimoNumeris",           -- nullable ~30-40% (direct procurement)
       s."sudarymoData",
       s."galiojimoData",
       s.verte,
       s."faktineIvykdimoVerte",
       s.pavadinimas,
       s."bvpzKodas",
       s.tipas,
       s.istrinta,
       s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       pb.pavadinimas                      AS pirkejas,
       s."tiekejoKodas",
       tb.pavadinimas                      AS tiekejas,
       s."papildomiTiekejaiKodai"
FROM sutartys s
LEFT JOIN "jarCsv" pb ON pb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
LEFT JOIN "jarCsv" tb ON tb."jarKodas"::text = s."tiekejoKodas";
```

### `v_pirkimas` — procurement notices with organizer details

```sql
CREATE TEMP VIEW v_pirkimas AS
SELECT p."pirkimoId",
       p.pavadinimas,
       p."jarKodas",
       o.pavadinimas              AS organizatorius,
       o.trumpinys,
       o.miestas,
       p."pirkimoBudas",
       p.statusas,
       p.zingsnis,
       p."pirkimoObjektoTipas",
       p."numatomaVerteEUR",
       p."paskelbimoData",
       p."pasiulymuPateikimoTerminas",
       p."esFinansavimas",
       p."bvpzKodai"
FROM "viesiejiPirkimai" p
LEFT JOIN "viesiejiPirkimaiVykdytojai" o ON o.id = p."pirkimoVykdytojasId";
```

### `v_person_links` — declared person-to-company relationships with company name

```sql
CREATE TEMP VIEW v_person_links AS
SELECT r.id,
       r.deklaracija,
       r.vardas,
       r.pavarde,
       r."susijusioAsmensVardas",
       r."susijusioAsmensPavarde",
       r."jarKodas",
       j.pavadinimas              AS "imonesVardas",
       r.pareigos,
       r."irasoTipas",            -- DEKLARUOJANCIO_DARBOVIETE | SUTUOKTINIO_DARBOVIETE | KITI_RYSIAI_SU_JA
       r."darbovietesTipas",
       r."rysioPobudzioPavadinimas",
       r."rysioPradzia",
       r."rysioPabaiga",
       r."yraJuridinisAsmuo",
       r."registruotaLietuvoje"
FROM "pinregJuridiniaiRysiai" r
LEFT JOIN "jarCsv" j ON j."jarKodas"::text = r."jarKodas";
```

### `v_dalyviai` — full bidder list per procurement with ranked bid amounts

The only source of **all participants** in a tender, not just the winner. Without this view, Themes 2 and 3
(cover bidding, bid rotation) are impossible — `sutartys` records winners only.

```sql
CREATE TEMP VIEW v_dalyviai AS
SELECT a."pirkimoNumeris",
       a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       a."pirkimoBudas",
       a."sukurtaAt"                       AS "ataskaitosData",
       d.kodas                             AS "tiekejoKodas",
       j.pavadinimas                       AS tiekejas,
       d."fizinisAsmuo",
       d.salis,
       e."eileNumeris",                    -- bid rank: 1 = lowest / winner
       e.kaina::numeric                    AS "pasiulymoKaina",
       ap.statusas                         AS "atmetimoPriezastis" -- non-null if proposal was rejected
FROM atn1ataskaitos a
JOIN atn1dalyviai d ON d."ataskaitaId" = a.id
LEFT JOIN "atn1pasiulymuEile" e
    ON e."ataskaitaId" = a.id AND e."dalyvioKodas" = d.kodas
LEFT JOIN "atn1atmestiPasiulymai" ap
    ON ap."ataskaitaId" = a.id AND ap."dalyvioKodas" = d.kodas
LEFT JOIN "jarCsv" j ON j."jarKodas"::text = d.kodas;
```

### `v_bylos` — court cases with company and person participants

```sql
CREATE TEMP VIEW v_bylos AS
SELECT b.id            AS "bylosId",
       b."bylosNumeris",
       b."bylosRusis",
       b.data          AS "bylosData",
       b.teismas,
       bd.kodas        AS "jarKodas",
       j.pavadinimas   AS "dalyvioPavadinimas",
       bd.pavadinimas  AS "dalyvioVardasIrPavarde", -- persons have no jarKodas, only pavadinimas
       bd."bylojeKaip"                              -- role: plaintiff, defendant, third party, etc.
FROM "bylosDalyviai" bd
JOIN bylos b ON b.id = bd."bylosId"
LEFT JOIN "jarCsv" j ON j."jarKodas"::text = bd.kodas;
```

### Connection lifecycle

The MCP server runs all six `CREATE TEMP VIEW` statements immediately after acquiring a connection from the pool,
before executing any user query. Because TEMP views are session-scoped they disappear automatically when the
connection closes — no cleanup needed.

---

## Investigation session example

A human says: *"UAB Greitas Statyba keeps winning road contracts in Kaunas. They seem tiny. Something feels off."*

The LLM agent receives this and begins an investigation loop:

### Step 1 — Identify the company

```
Tool: search_juridiniai
search: "Greitas Statyba"
→ jarKodas: 304567890, pavadinimas: UAB Greitas Statyba, registered: 2019-03-11, Kaunas
```

### Step 2 — Full risk profile in one shot (`v_company`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Capacity, compliance flags, court exposure, and domain footprint for the target company"

```sql
SELECT "jarKodas",
       pavadinimas,
       "registravimoData",
       "statusoPavadinimas",
       "sodraData",
       darbuotojai,
       "vidutinisAtlyginimas",
       "imokuSuma",
       "melagingisTiekejas",
       "nepatikimasTiekejas",
       "vdiPazeidimuSkaicius",
       "bylosSkaicius",
       "domenaiSkaicius",
       "neskelbiamosDerybosSkaicius"
FROM v_company
WHERE "jarKodas" = '304567890';
```

*→ 3 employees (Sodra 202412), avg salary €1,850, compliance: clean, court cases: 2, domains: 0, negotiated-without-publication appearances: 0*

*LLM notes: Company is 5 years old, 3 employees, no blacklist flags. Two court cases worth investigating. Capacity to deliver road construction at this scale is implausible.*

### Step 3 — Contract history by year with cost overrun ratio (`v_sutartys`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Contract volume trend and execution overruns — is the company growing or was it born ready?"

```sql
SELECT DATE_TRUNC('year', "sudarymoData")::date                                    AS metai,
       COUNT(*)                                                                     AS sutarciu_sk,
       ROUND(SUM(verte) / 1000)                                                    AS verte_tukst,
       ROUND(SUM("faktineIvykdimoVerte") / 1000)                                   AS faktine_tukst,
       ROUND(SUM("faktineIvykdimoVerte") / NULLIF(SUM(verte), 0), 2)               AS virsijimo_koef,
       pirkejas
FROM v_sutartys
WHERE "tiekejoKodas" = '304567890'
  AND istrinta IS NOT TRUE
GROUP BY metai, pirkejas
ORDER BY metai;
```

*→ 2020: 5 contracts €890K (×1.02, buyer: Kauno miesto savivaldybė)*  
*→ 2021: 11 contracts €2.1M (×1.28)*  
*→ 2022: 14 contracts €3.8M (×1.41)*  
*→ 2023: 17 contracts €5.5M (×1.52)*

*LLM notes: Contract volume grows 6× in four years; overrun ratio worsening each year — classic low-ball-then-escalate. Same buyer every time.*

### Step 4 — Does the buyer favour non-competitive procedures? (`v_pirkimas`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Procedure type breakdown for the contracting authority — how often do they bypass open tender?"

```sql
SELECT "pirkimoBudas",
       COUNT(*)                          AS pirkimu_sk,
       ROUND(SUM("numatomaVerteEUR"))    AS bendra_verte_eur
FROM v_pirkimas
WHERE "jarKodas" = (
    SELECT "pirkejoKodas" FROM v_sutartys
    WHERE "tiekejoKodas" = '304567890' LIMIT 1
)
GROUP BY "pirkimoBudas"
ORDER BY pirkimu_sk DESC;
```

*→ NESKELBIAMOS_DERYBOS: 31 procurements €4.9M (68%)*  
*→ ATVIRAS: 11 procurements €1.1M (24%)*  
*→ SUPAPRASTINTAS_ATVIRAS: 4 procurements €0.3M (9%)*

*LLM notes: Buyer runs 68% of procurements as negotiated-without-publication. That is the mechanism that eliminates competition before the bid even opens. Focus of Theme 7 confirmed.*

### Step 5 — Win rate and price suppression (`v_dalyviai`)

**Tool**: `execute_investigation_query`  
**Purpose**: "How often does this company win as lowest bidder vs all other participants in the same tenders"

```sql
WITH target AS (
    SELECT DISTINCT "pirkimoNumeris"
    FROM v_dalyviai
    WHERE "tiekejoKodas" = '304567890'
),
all_bids AS (
    SELECT d."pirkimoNumeris",
           d."tiekejoKodas",
           d."pasiulymoKaina",
           RANK() OVER (PARTITION BY d."pirkimoNumeris" ORDER BY d."pasiulymoKaina") AS rank,
           COUNT(*) OVER (PARTITION BY d."pirkimoNumeris")                            AS bidders
    FROM v_dalyviai d
    WHERE d."pirkimoNumeris" IN (SELECT "pirkimoNumeris" FROM target)
)
SELECT COUNT(DISTINCT "pirkimoNumeris")                                               AS procurements,
       COUNT(*) FILTER (WHERE "tiekejoKodas" = '304567890' AND rank = 1)             AS cheapest_wins,
       ROUND(AVG(bidders), 1)                                                         AS avg_competitors,
       ROUND(AVG(CASE WHEN "tiekejoKodas" = '304567890' THEN "pasiulymoKaina" END) /
             NULLIF(AVG("pasiulymoKaina"), 0), 3)                                    AS price_ratio
FROM all_bids;
```

*→ 47 procurements, 41 cheapest wins (87%), avg 2.3 competitors, price ratio 0.72*

*LLM notes: Wins 87% of the time as lowest bidder. Consistent underbidding at 72% of field average — statistically improbable without prior knowledge of competitors' prices.*

### Step 6 — Who co-bids and always loses? (`v_dalyviai`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Identify companies that repeatedly appear as cover bidders — always present, always higher"

```sql
WITH target_procurements AS (
    SELECT DISTINCT "pirkimoNumeris" FROM v_dalyviai WHERE "tiekejoKodas" = '304567890'
),
winner_kaina AS (
    SELECT "pirkimoNumeris", "pasiulymoKaina" FROM v_dalyviai WHERE "tiekejoKodas" = '304567890'
)
SELECT d."tiekejoKodas",
       d.tiekejas,
       COUNT(*)                                                              AS co_bids,
       COUNT(*) FILTER (WHERE d."pasiulymoKaina" > w."pasiulymoKaina")      AS times_bid_higher
FROM v_dalyviai d
JOIN winner_kaina w USING ("pirkimoNumeris")
WHERE d."pirkimoNumeris" IN (SELECT "pirkimoNumeris" FROM target_procurements)
  AND d."tiekejoKodas" != '304567890'
GROUP BY d."tiekejoKodas", d.tiekejas
ORDER BY co_bids DESC
LIMIT 10;
```

*→ UAB Kelių Draugai (301234567): 38 co-bids, 38 times higher*  
*→ UAB Asfaltas Pro (309876543): 29 co-bids, 27 times higher*

*LLM notes: Same two companies appear in nearly every tender and always bid above the winner. Cover bidding pattern confirmed.*

### Step 7 — Are the three companies linked through people? (`v_person_links`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Graph traversal: shared directors, shareholders, or spouses across the three co-bidding companies"

```sql
WITH target_companies AS (
    SELECT unnest(ARRAY['304567890', '301234567', '309876543']) AS jar
)
SELECT p1."jarKodas"     AS company_a,
       p1."imonesVardas" AS company_a_name,
       p2."jarKodas"     AS company_b,
       p2."imonesVardas" AS company_b_name,
       p1.vardas,
       p1.pavarde,
       p1."irasoTipas"   AS role_a,
       p2."irasoTipas"   AS role_b
FROM v_person_links p1
JOIN v_person_links p2
    ON p1.vardas = p2.vardas AND p1.pavarde = p2.pavarde
WHERE p1."jarKodas" IN (SELECT jar FROM target_companies)
  AND p2."jarKodas" IN (SELECT jar FROM target_companies)
  AND p1."jarKodas" < p2."jarKodas";
```

*→ Jonas Jonaitis: DEKLARUOJANCIO_DARBOVIETE at 304567890 (Greitas Statyba) + KITI_RYSIAI_SU_JA at 301234567 (Kelių Draugai)*  
*→ Petras Petraitis: DEKLARUOJANCIO_DARBOVIETE at 301234567 + SUTUOKTINIO_DARBOVIETE links to 309876543 (Asfaltas Pro)*

*LLM notes: Two people bridge all three companies. Shared ownership confirmed via PINREG declarations.*

### Step 8 — Court exposure of the cluster (`v_bylos`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Check whether any of the three companies appear as defendants in court cases"

```sql
SELECT "jarKodas",
       "dalyvioPavadinimas",
       "bylosRusis",
       "bylosData",
       teismas,
       "bylojeKaip"
FROM v_bylos
WHERE "jarKodas" IN ('304567890', '301234567', '309876543')
ORDER BY "bylosData" DESC
LIMIT 20;
```

*→ 304567890 — defendant in 2 labour-law cases (2022, 2024)*  
*→ 301234567 — defendant in 1 contract-dispute case (2023)*  
*→ 309876543 — no court cases*

*LLM notes: Two of three companies have been defendants. Labour-law cases at the winning company are consistent with undeclared subcontracting — another capacity-mismatch indicator.*

### Step 9 — LLM summarizes findings to the human

> Your intuition was right. UAB Greitas Statyba (3 employees, €12.3M in contracts since 2020) wins 87% of road tenders
> as the cheapest bidder, with costs overrunning by up to 52%. The same two companies — UAB Kelių Draugai and UAB
> Asfaltas Pro — appear as competitors in nearly every tender and consistently bid above the winner. The contracting
> authority runs 68% of its procurements as negotiated-without-publication, eliminating open competition before bids
> are submitted. These three companies share people: Jonas Jonaitis is linked to both Greitas Statyba and Kelių Draugai;
> Petras Petraitis directs Kelių Draugai while his spouse is linked to Asfaltas Pro. Two of the three companies have
> been defendants in court cases. The overall pattern is consistent with a coordinated bid-rigging ring (cover bidding +
> procedure manipulation) operating under a single contracting authority.

---

## Why this works

| Property               | Outcome                                                                                           |
|------------------------|---------------------------------------------------------------------------------------------------|
| Human brings intuition | The investigation starts from a gut feeling, not a query                                          |
| LLM brings methodology | Fraud detection patterns, statistical tests, investigation sequencing — no pre-built views needed |
| Data brings truth      | Every hypothesis is tested against real records                                                   |
| Tool brings safety     | Six guardrail layers, read-only role, audit trail                                                 |
| No maintenance burden  | New fraud patterns emerge from LLM updates, not code changes                                      |
| Iterative by nature    | Each query result shapes the next question — agentic loop                                         |

## What to build

| Component                                 | Effort | Notes                                                          |
|-------------------------------------------|--------|----------------------------------------------------------------|
| `get_schema` MCP tool                     | Small  | Query `information_schema`, filter to whitelist                |
| `execute_investigation_query` MCP tool    | Medium | SQL parser + guardrail stack + execution                       |
| Read-only PG role (`mcp_analyst`)         | Small  | One-time DDL                                                   |
| SQL AST validation module                 | Medium | `node-sql-parser`, table/function whitelist, complexity checks |
| Audit logging                             | Small  | Insert to a `query_audit_log` table                            |
| MCP tool description / prompt engineering | Small  | Tell the LLM what tables exist and how they relate             |

### Recommended npm packages

- **`node-sql-parser`** — parses SQL into AST, supports PostgreSQL dialect, can validate table/column references against
  a whitelist. Well-maintained, 2M+ weekly downloads.
- No custom grammar, no EBNF, no rule engine needed.

---

## Risks and mitigations

| Risk                                 | Mitigation                                                                        |
|--------------------------------------|-----------------------------------------------------------------------------------|
| SQL injection via crafted query      | AST parsing rejects non-SELECT; read-only role as defense-in-depth                |
| Expensive queries (full table scans) | `statement_timeout = 10s`, `work_mem` cap, LIMIT enforcement                      |
| Data exfiltration                    | Table whitelist controls what's visible; sensitive columns can be excluded        |
| LLM writes wrong SQL                 | LLM can see errors, retry, self-correct — this is normal agentic behavior         |
| Prompt injection via data content    | MCP tool returns raw data; LLM must treat it as untrusted (standard MCP practice) |

---

## Future extensions

- **Materialized risk scores**: Once common investigation patterns stabilize, materialize them as views for faster
  access — but as optimization, not as the primary interface.
- **Graph-aware schema hints**: Provide the LLM with a relationship map (entity A connects to entity B via table C on
  column D) to improve JOIN accuracy.
- **Investigation templates**: Optional starting-point prompts ("investigate this company for bid rigging") that the LLM
  can deviate from — guidance, not constraints.
- **Cross-investigation memory**: Let the LLM reference findings from previous investigations to detect patterns across
  multiple tips.

---

## Classic investigator questions for MCP debugging

Organised by interrogation theme. Each question is phrased as a real investigator tip — the kind of sentence typed
into the chat. Use these to verify that the MCP agentic loop produces correct, useful, non-hallucinated answers
against the live database.

---

### 1. Shell company / capacity mismatch

> *"This company keeps winning large road contracts but they only have a handful of employees."*

- How many employees does this supplier have, and how does that compare to their total contract value this year?
- When was the company registered? Did it start winning contracts within months of registration?
- What is the ratio of declared Sodra wages to total contract revenue? Could they actually deliver this work?
- Does the company's registered address appear on many other companies?
- Has the company ever declared any fixed assets or significant revenue in financial reports?

---

### 2. Bid rigging — cover bidding and bid suppression

> *"I have a feeling the same companies keep showing up as losers in every tender this supplier wins."*

- What is this company's win rate across all procurements they participated in?
- Who are the most frequent co-bidders, and how often do they bid higher than the winner?
- Do the losing bids cluster just above the winning bid, or are they spread randomly?
- Are there procurements where only one or two companies ever participate?
- Is the average number of bidders in this company's procurements lower than the national average for the same CPV
  category?

---

### 3. Bid rotation / carousel

> *"I think these three companies take turns winning — each one wins for a while, then steps back."*

- Over the past five years, how is the total contract value split between these companies within the same CPV
  category?
- Is there a pattern where company A wins in one period and company B wins in another, with minimal overlap?
- Do these companies ever bid against each other, or do they consistently appear in separate tenders?
- When company A is the winner, do companies B and C appear as cover bidders, and vice versa?

---

### 4. Conflict of interest — shared people between buyer and seller

> *"The procurement officer and the winning supplier's director might know each other."*

- Are any people declared in PINREG as working for the buying organisation also linked to the winning supplier?
- Do any directors or shareholders of the winning supplier have a spouse or family member employed by the buyer?
- Has the same individual appeared in interest declarations for both the contracting authority and a supplier that
  won contracts from that authority?
- Are there common persons in the ownership chains of companies that both bid and buy from each other?

---

### 5. Contract splitting to avoid thresholds

> *"This buyer keeps awarding lots of small contracts to the same supplier — I think they're avoiding the open
> tender threshold."*

- How many contracts has this buyer awarded to this supplier in the past 12 months, and what are their individual
  values?
- Are there clusters of contracts just below the simplified procurement threshold (€30K) or the open procedure
  threshold?
- What is the time gap between consecutive contracts to the same supplier? Are they awarded days apart?
- Does the same contract description (or CPV code) recur across many small awards?

---

### 6. Geographic monopoly / local capture

> *"Every road repair contract in this municipality goes to the same company, year after year."*

- What share of total procurement value in this municipality was awarded to this single supplier over the past
  three years?
- Are there other suppliers in the same region and CPV category who never win, or who stopped bidding?
- Is the contracting authority exclusively issuing contracts to locally registered companies?
- Do procurement officers at this authority have declared connections to local suppliers?

---

### 7. Procedure manipulation — unjustified direct award

> *"This authority almost never uses open tenders — everything goes through negotiated procedure without
> publication."*

- What fraction of this buyer's contracts by value were awarded via direct negotiation vs open competition?
- Has this buyer's use of negotiated-without-publication procedure increased over time?
- Are the stated justifications for non-competitive procedures consistent, or do they recycle boilerplate reasons?
- Which suppliers benefit most from this buyer's non-competitive awards?

---

### 8. Price anomalies — over-invoicing and scope creep

> *"The contract was signed for €200K but the final execution value was €900K."*

- For this supplier, what is the average ratio of `faktineIvykdimoVerte` to `verte` across all contracts?
- Are there contracts where the final value exceeded the original by more than 50%?
- Do price overruns correlate with specific buyers, CPV categories, or procurement methods?
- Is there a pattern of low initial bids followed by large amendments — a classic low-ball-then-escalate pattern?

---

### 9. Compliance and blacklist cross-check

> *"I want to know if this company or its related parties have ever been flagged."*

- Is this company currently on the unreliable suppliers list or the false-declaration debarment list?
- Has this company ever been debarred, even if that debarment has since expired?
- Are any of this company's directors or shareholders linked to other companies that are blacklisted?
- Does this company have outstanding VDI (Labour Inspectorate) violations?
- Are there court cases where this company appears as a party?

---

### 10. Network — second-degree connections and corporate webs

> *"I want to understand who really controls this company and what else they're involved in."*

- Who are the current directors and shareholders of this company according to PINREG declarations?
- What other companies are those people connected to — as directors, shareholders, or via a spouse?
- Do any of those second-degree companies also hold government contracts?
- Is there a cluster of companies sharing the same address, phone, or domain that all bid in the same tenders?
- Has the ownership structure changed significantly in the period just before or after a large contract award?

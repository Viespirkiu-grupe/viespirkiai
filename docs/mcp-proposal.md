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

**Coverage map against the 22 investigator themes:**

| View             | Themes covered              | Critical facts provided                                                    |
|------------------|-----------------------------|----------------------------------------------------------------------------|
| `v_company`      | 1, 5, 6, 7, 9, 10, 11, 12  | headcount, registration, compliance flags, domain/court/negotiation counts |
| `v_sutartys`     | 1, 2, 3, 5, 8, 15, 18      | contract value, overrun ratio, CPV, buyer/seller names, tipas              |
| `v_pirkimas`     | 5, 6, 7, 20                 | procedure type, buyer municipality, estimated value                        |
| `v_person_links` | 4, 10, 11, 13, 19           | person ↔ company edges, spouse links, role type, foreign-entity flag       |
| `v_dalyviai`     | **2, 3, 14, 17**            | full bidder list, bid amounts, rank — essential for bid rigging/spec rigging/cartel |
| `v_bylos`        | **9**                       | court cases per company — blind spot without this view                     |

Raw tables used directly (no view wrapper needed):

| Table                  | Themes | Why no view |
|------------------------|--------|-------------|
| `cpvaProjektuSutartys` | 12     | CPVA subcontractor data — join shape varies per query |
| `pinregJuridiniaiRysiai` | 13, 19 | Revolving door needs self-join on date ranges — view would fix too many columns |
| `domenai`              | 16     | Domain pair queries need flexible self-join |
| `neskelbiamosDerybos`  | 20     | Audit findings — single-table lookup, no join needed |

### `v_company` — company profile with latest headcount and compliance status

```sql
CREATE TEMP VIEW v_company AS
SELECT j."jarKodas"::text, j.pavadinimas,
       j.adresas,
       j."registravimoData",
       j."statusoPavadinimas",
       j."statusasNuo",
       -- headcount: Theme 1 (capacity mismatch)
       s.data                                                                  AS "sodraData", -- YYYYMM integer
       (COALESCE(s.draustieji, 0) + COALESCE(s.draustieji2, 0))                AS darbuotojai,
       s."vidutinisAtlyginimas",
       s."imokuSuma",                                                                          -- total social tax paid
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
        WHERE v."jarKodas" = j."jarKodas"::text)                               AS "vdiPazeidimuSkaicius",
       -- court exposure: Theme 9
       (SELECT COUNT(*)
        FROM "bylosDalyviai" bd
        WHERE bd.kodas = j."jarKodas"::text)                                   AS "bylosSkaicius",
       -- web footprint: Theme 10 (shared domain / network signals)
       (SELECT COUNT(*)
        FROM domenai d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                         AS "domenaiSkaicius",
       -- procedure abuse signal: Theme 7
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                              AS "neskelbiamosDerybosSkaicius"
FROM "jarCsv" j
         LEFT JOIN LATERAL(
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data FROM sodra
    WHERE "jarKodas" = j."jarKodas"::text
    ORDER BY data DESC NULLS LAST
    LIMIT 1
                   ) s ON true;
```

### `v_sutartys` — contracts with buyer and seller names resolved

```sql
CREATE TEMP VIEW v_sutartys AS
SELECT s."sutartiesUnikalusId",
       s."pirkimoNumeris", -- nullable ~30-40% (direct procurement)
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
       o.pavadinimas AS organizatorius,
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
       j.pavadinimas AS "imonesVardas",
       r.pareigos,
       r."irasoTipas", -- DEKLARUOJANCIO_DARBOVIETE | SUTUOKTINIO_DARBOVIETE | KITI_RYSIAI_SU_JA
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
       e."eileNumeris",                                                                             -- bid rank: 1 = lowest / winner
       e.kaina::numeric                    AS "pasiulymoKaina", ap.statusas AS "atmetimoPriezastis" -- non-null if proposal was rejected
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
SELECT b.id           AS "bylosId",
       b."bylosNumeris",
       b."bylosRusis",
       b.data         AS "bylosData",
       b.teismas,
       bd.kodas       AS "jarKodas",
       j.pavadinimas  AS "dalyvioPavadinimas",
       bd.pavadinimas AS "dalyvioVardasIrPavarde", -- persons have no jarKodas, only pavadinimas
       bd."bylojeKaip"                             -- role: plaintiff, defendant, third party, etc.
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

*→ 3 employees (Sodra 202412), avg salary €1,850, compliance: clean, court cases: 2, domains: 0,
negotiated-without-publication appearances: 0*

*LLM notes: Company is 5 years old, 3 employees, no blacklist flags. Two court cases worth investigating. Capacity to
deliver road construction at this scale is implausible.*

### Step 3 — Contract history by year with cost overrun ratio (`v_sutartys`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Contract volume trend and execution overruns — is the company growing or was it born ready?"

```sql
SELECT DATE_TRUNC('year', "sudarymoData")::date                                    AS metai, COUNT(*) AS sutarciu_sk,
       ROUND(SUM(verte) / 1000)                                      AS verte_tukst,
       ROUND(SUM("faktineIvykdimoVerte") / 1000)                     AS faktine_tukst,
       ROUND(SUM("faktineIvykdimoVerte") / NULLIF(SUM(verte), 0), 2) AS virsijimo_koef,
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

*LLM notes: Contract volume grows 6× in four years; overrun ratio worsening each year — classic low-ball-then-escalate.
Same buyer every time.*

### Step 4 — Does the buyer favour non-competitive procedures? (`v_pirkimas`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Procedure type breakdown for the contracting authority — how often do they bypass open tender?"

```sql
SELECT "pirkimoBudas",
       COUNT(*)                       AS pirkimu_sk,
       ROUND(SUM("numatomaVerteEUR")) AS bendra_verte_eur
FROM v_pirkimas
WHERE "jarKodas" = (SELECT "pirkejoKodas"
                    FROM v_sutartys
                    WHERE "tiekejoKodas" = '304567890'
                    LIMIT 1)
GROUP BY "pirkimoBudas"
ORDER BY pirkimu_sk DESC;
```

*→ NESKELBIAMOS_DERYBOS: 31 procurements €4.9M (68%)*  
*→ ATVIRAS: 11 procurements €1.1M (24%)*  
*→ SUPAPRASTINTAS_ATVIRAS: 4 procurements €0.3M (9%)*

*LLM notes: Buyer runs 68% of procurements as negotiated-without-publication. That is the mechanism that eliminates
competition before the bid even opens. Focus of Theme 7 confirmed.*

### Step 5 — Win rate and price suppression (`v_dalyviai`)

**Tool**: `execute_investigation_query`  
**Purpose**: "How often does this company win as lowest bidder vs all other participants in the same tenders"

```sql
WITH target AS (SELECT DISTINCT "pirkimoNumeris"
                FROM v_dalyviai
                WHERE "tiekejoKodas" = '304567890'),
     all_bids AS (SELECT d."pirkimoNumeris",
                         d."tiekejoKodas",
                         d."pasiulymoKaina",
                         RANK() OVER (PARTITION BY d."pirkimoNumeris" ORDER BY d."pasiulymoKaina") AS rank,
                         COUNT(*) OVER (PARTITION BY d."pirkimoNumeris")                           AS bidders
                  FROM v_dalyviai d
                  WHERE d."pirkimoNumeris" IN (SELECT "pirkimoNumeris" FROM target))
SELECT COUNT(DISTINCT "pirkimoNumeris")                                  AS procurements,
       COUNT(*) FILTER (WHERE "tiekejoKodas" = '304567890' AND rank = 1) AS cheapest_wins,
       ROUND(AVG(bidders), 1)                                            AS avg_competitors,
       ROUND(AVG(CASE WHEN "tiekejoKodas" = '304567890' THEN "pasiulymoKaina" END) /
             NULLIF(AVG("pasiulymoKaina"), 0), 3)                        AS price_ratio
FROM all_bids;
```

*→ 47 procurements, 41 cheapest wins (87%), avg 2.3 competitors, price ratio 0.72*

*LLM notes: Wins 87% of the time as lowest bidder. Consistent underbidding at 72% of field average — statistically
improbable without prior knowledge of competitors' prices.*

### Step 6 — Who co-bids and always loses? (`v_dalyviai`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Identify companies that repeatedly appear as cover bidders — always present, always higher"

```sql
WITH target_procurements AS (SELECT DISTINCT "pirkimoNumeris" FROM v_dalyviai WHERE "tiekejoKodas" = '304567890'),
     winner_kaina AS (SELECT "pirkimoNumeris", "pasiulymoKaina" FROM v_dalyviai WHERE "tiekejoKodas" = '304567890')
SELECT d."tiekejoKodas",
       d.tiekejas,
       COUNT(*)                                                        AS co_bids,
       COUNT(*) FILTER (WHERE d."pasiulymoKaina" > w."pasiulymoKaina") AS times_bid_higher
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

*LLM notes: Same two companies appear in nearly every tender and always bid above the winner. Cover bidding pattern
confirmed.*

### Step 7 — Are the three companies linked through people? (`v_person_links`)

**Tool**: `execute_investigation_query`  
**Purpose**: "Graph traversal: shared directors, shareholders, or spouses across the three co-bidding companies"

```sql
WITH target_companies AS (SELECT unnest(ARRAY['304567890', '301234567', '309876543']) AS jar)
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

*→ Jonas Jonaitis: DEKLARUOJANCIO_DARBOVIETE at 304567890 (Greitas Statyba) + KITI_RYSIAI_SU_JA at 301234567 (Kelių
Draugai)*  
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

*LLM notes: Two of three companies have been defendants. Labour-law cases at the winning company are consistent with
undeclared subcontracting — another capacity-mismatch indicator.*

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

## Classic investigator questions

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

---

### 11. UBO risk — beneficial ownership through holding layers

> *"These two companies bid against each other every time, but I suspect the same person controls both through a shell
holding company."*

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
       d1.domenas
FROM domenai d1
         JOIN domenai d2 ON d1.domenas = d2.domenas AND d1."savininkoKodas" < d2."savininkoKodas"
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

If Jonas appears only in HoldCo's PINREG declaration and not at either bidder, the Step 7 / Theme 11 queries return *
*zero rows** — a false negative.

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

> *"This company won a CPVA-funded project worth €2M but they have 4 employees and the subcontractor they declared has zero Sodra payments."*

- Which CPVA-funded contracts name a subcontractor, and how many employees does that subcontractor actually have according to Sodra?
- Is the main contractor's Sodra headcount consistent with the contract scope, or are they clearly a pass-through?
- Does the subcontractor appear in other CPVA contracts with the same main contractor — suggesting a recurring related-party arrangement?
- Are both the winner and subcontractor linked via shared directors or shareholders in PINREG?

```sql
-- Subcontractor headcount cross-check on CPVA contracts
SELECT cs."projektoNr",
       cs."projektoPavadinimas",
       cs."tiekejoKodas",
       cs."tiekejoPavadinimasVardasIrPavardeGimimoData" AS tiekejas,
       cs."pirkimoSutartiesSumaSusijusiSuProjektu"     AS suma,
       cs."subtiekejoKodas",
       cs."subtiekejoPavadinimasVardasIrPavardeGimimoData" AS subtiekejasVardas,
       s_main.draustieji   AS "tiekejoDarbuotojai",
       s_sub.draustieji    AS "subtiekejoDarbuotojai"
FROM "cpvaProjektuSutartys" cs
LEFT JOIN LATERAL (
    SELECT draustieji FROM sodra
    WHERE "jarKodas" = cs."tiekejoKodas"
    ORDER BY data DESC NULLS LAST LIMIT 1
) s_main ON true
LEFT JOIN LATERAL (
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
SELECT cs."tiekejoKodas", cs."tiekejoPavadinimasVardasIrPavardeGimimoData" AS tiekejas,
       cs."subtiekejoKodas", cs."subtiekejoPavadinimasVardasIrPavardeGimimoData" AS subtiekejasVardas,
       COUNT(DISTINCT cs."projektoNr") AS projektu_sk,
       ROUND(SUM(cs."pirkimoSutartiesSumaSusijusiSuProjektu")) AS bendra_suma
FROM "cpvaProjektuSutartys" cs
WHERE cs."subtiekejoKodas" IS NOT NULL AND cs."subtiekejoKodas" != ''
GROUP BY cs."tiekejoKodas", cs."tiekejoPavadinimasVardasIrPavardeGimimoData",
         cs."subtiekejoKodas", cs."subtiekejoPavadinimasVardasIrPavardeGimimoData"
HAVING COUNT(DISTINCT cs."projektoNr") >= 2
ORDER BY projektu_sk DESC
LIMIT 200;
```

---

### 13. Revolving door — procurement officer joins winning supplier

> *"The head of procurement at this municipality left last year. I want to know if she now works for any company that won contracts there while she was in charge."*

- Which people held roles at a buying organisation and subsequently appear in PINREG at a supplier that won contracts from that same buyer?
- How quickly did they move — days, months?
- Did that supplier's win rate or contract value at the buyer change after the person joined?

```sql
-- People who left a buyer org and joined a supplier within 2 years
WITH buyer_staff AS (
    SELECT r.vardas, r.pavarde,
           r."jarKodas"  AS "pirkejoKodas",
           r."rysioPabaiga" AS "isejoData"
    FROM "pinregJuridiniaiRysiai" r
    WHERE r."darbovietesTipas" = 'STANDARTINE'
      AND r."irasoTipas"       = 'DEKLARUOJANCIO_DARBOVIETE'
      AND r."rysioPabaiga"     IS NOT NULL
      AND r."jarKodas" IN (SELECT DISTINCT "perkanciosiosOrganizacijosKodas" FROM sutartys)
),
supplier_staff AS (
    SELECT r.vardas, r.pavarde,
           r."jarKodas"   AS "tiekejoKodas",
           r."rysioPradzia" AS "atejoData"
    FROM "pinregJuridiniaiRysiai" r
    WHERE r."darbovietesTipas" = 'STANDARTINE'
      AND r."irasoTipas"       = 'DEKLARUOJANCIO_DARBOVIETE'
      AND r."rysioPradzia"     IS NOT NULL
)
SELECT b.vardas, b.pavarde,
       b."pirkejoKodas", b."isejoData",
       s."tiekejoKodas", s."atejoData",
       (s."atejoData" - b."isejoData") AS "dienuSkaicius",
       (SELECT COUNT(*) FROM sutartys
        WHERE "perkanciosiosOrganizacijosKodas" = b."pirkejoKodas"
          AND "tiekejoKodas" = s."tiekejoKodas"
          AND "sudarymoData" >= b."isejoData") AS "sutartysPoPerejimo"
FROM buyer_staff b
JOIN supplier_staff s
  ON s.vardas   = b.vardas
 AND s.pavarde  = b.pavarde
 AND s."atejoData" > b."isejoData"
 AND (s."atejoData" - b."isejoData") < 730
 AND b."pirkejoKodas" != s."tiekejoKodas"
ORDER BY "dienuSkaicius"
LIMIT 200;
```

---

### 14. Spec rigging — technical specifications written for one supplier

> *"Every tender this department publishes in this category ends up with only one bidder. I think the specs are written to exclude everyone else."*

- What fraction of a buyer's tenders in a given CPV category receive only one bid, compared to the national average for that same CPV?
- Which suppliers consistently win those single-bidder tenders?
- Is the single-bidder rate significantly higher than peers buying in the same category?

```sql
-- Buyers whose single-bidder rate per CPV is more than 2× the national average (min 5 tenders)
WITH cpv_national AS (
    SELECT a."pagrindinisKodasBvpz" AS cpv,
           COUNT(DISTINCT a."pirkimoNumeris") AS total_pirkimai,
           COUNT(DISTINCT a."pirkimoNumeris") FILTER (
               WHERE (SELECT COUNT(*) FROM atn1dalyviai WHERE "ataskaitaId" = a.id) = 1
           ) AS single_bidder_cnt
    FROM atn1ataskaitos a
    WHERE a."pagrindinisKodasBvpz" IS NOT NULL
    GROUP BY a."pagrindinisKodasBvpz"
),
buyer_cpv AS (
    SELECT a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
           a."pagrindinisKodasBvpz"            AS cpv,
           COUNT(DISTINCT a."pirkimoNumeris")  AS pirkimai,
           COUNT(DISTINCT a."pirkimoNumeris") FILTER (
               WHERE (SELECT COUNT(*) FROM atn1dalyviai WHERE "ataskaitaId" = a.id) = 1
           ) AS single_bidder
    FROM atn1ataskaitos a
    WHERE a."pagrindinisKodasBvpz" IS NOT NULL
    GROUP BY a."perkanciosiosOrganizacijosKodas", a."pagrindinisKodasBvpz"
)
SELECT bc."pirkejoKodas", bc.cpv,
       bc.pirkimai, bc.single_bidder,
       ROUND(bc.single_bidder::numeric / NULLIF(bc.pirkimai, 0), 2)            AS "pirkejoVienbidiskumas",
       ROUND(cn.single_bidder_cnt::numeric / NULLIF(cn.total_pirkimai, 0), 2)  AS "cpvSaliesVidurkis"
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

> *"This buyer set up a framework agreement three years ago and has been calling off contracts from it ever since, but always to the same one company."*

- How many distinct suppliers appear across all call-off contracts (`tipas = 'PPS'`) linked to a given framework procurement number?
- What is the total value channelled through the framework, and over how many years?
- Did the buyer run a competitive open tender to establish the framework in the first place, or was it a direct award?

```sql
-- Frameworks where 100% of call-offs went to a single supplier, ranked by total value
SELECT s."pirkimoNumeris",
       COUNT(*)                          AS uzsakymuSkaicius,
       COUNT(DISTINCT s."tiekejoKodas") AS tiekejuSkaicius,
       ROUND(SUM(s.verte))              AS bendra_verte,
       MIN(s."sudarymoData")            AS pirmas_uzsakymas,
       MAX(s."sudarymoData")            AS paskutinis_uzsakymas,
       MAX(j.pavadinimas)              AS tiekejas,
       MAX(s."perkanciosiosOrganizacijosKodas") AS "pirkejoKodas"
FROM sutartys s
LEFT JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
WHERE s.tipas = 'PPS'
  AND s."pirkimoNumeris" IS NOT NULL
GROUP BY s."pirkimoNumeris"
HAVING COUNT(DISTINCT s."tiekejoKodas") = 1
   AND COUNT(*) >= 5
ORDER BY bendra_verte DESC
LIMIT 200;
```

---

### 16. Shared back-office — competing companies with the same address or domain

> *"I keep seeing the same two companies bidding against each other, but they're registered at exactly the same street address."*

- Do any of the co-bidders in a cluster share a registered legal address in the company registry?
- Do any of them share a domain registrant in the WHOIS/`domenai` table?
- How many government contracts has each of those companies won, and do their contract timelines overlap in a way that suggests coordination?

```sql
-- Active companies sharing a registered address that have both won government contracts
WITH candidate_pairs AS (
    SELECT a."jarKodas"::text AS jar_a,
           b."jarKodas"::text AS jar_b,
           a.adresas
    FROM "jarCsv" a
    JOIN "jarCsv" b ON b.adresas = a.adresas AND b."jarKodas" > a."jarKodas"
    WHERE a.adresas IS NOT NULL
      AND LENGTH(a.adresas) > 10
      AND a."statusoKodas" = 1
      AND b."statusoKodas" = 1
)
SELECT cp.adresas,
       cp.jar_a, ja.pavadinimas AS pav_a,
       cp.jar_b, jb.pavadinimas AS pav_b,
       (SELECT COUNT(*) FROM sutartys WHERE "tiekejoKodas" = cp.jar_a) AS sutartys_a,
       (SELECT COUNT(*) FROM sutartys WHERE "tiekejoKodas" = cp.jar_b) AS sutartys_b
FROM candidate_pairs cp
JOIN "jarCsv" ja ON ja."jarKodas"::text = cp.jar_a
JOIN "jarCsv" jb ON jb."jarKodas"::text = cp.jar_b
WHERE EXISTS (SELECT 1 FROM sutartys WHERE "tiekejoKodas" = cp.jar_a)
  AND EXISTS (SELECT 1 FROM sutartys WHERE "tiekejoKodas" = cp.jar_b)
LIMIT 200;
```

```sql
-- Competing companies sharing a domain registrant
SELECT d1."savininkoKodas"  AS jar_a,
       j1.pavadinimas       AS pav_a,
       d2."savininkoKodas"  AS jar_b,
       j2.pavadinimas       AS pav_b,
       d1.domenas
FROM domenai d1
JOIN domenai d2
  ON d1.domenas = d2.domenas
 AND d1."savininkoKodas" < d2."savininkoKodas"
JOIN "jarCsv" j1 ON j1."jarKodas"::text = d1."savininkoKodas"
JOIN "jarCsv" j2 ON j2."jarKodas"::text = d2."savininkoKodas"
WHERE EXISTS (SELECT 1 FROM sutartys WHERE "tiekejoKodas" = d1."savininkoKodas")
  AND EXISTS (SELECT 1 FROM sutartys WHERE "tiekejoKodas" = d2."savininkoKodas")
LIMIT 200;
```

---

### 17. Price cartel — suspiciously uniform bid prices across a CPV category

> *"All the bids in this sector feel like they came from the same spreadsheet — the prices are almost identical across completely unrelated tenders."*

- In a given CPV category, is the coefficient of variation of submitted bid prices abnormally low, suggesting coordination?
- Which suppliers appear repeatedly in low-variation CPV categories?
- Do the same companies cluster together across multiple such categories?

```sql
-- CPV categories with suspiciously low price variation (coefficient of variation < 5%)
WITH cpv_bids AS (SELECT a."pagrindinisKodasBvpz" AS cpv,
                         e.kaina::numeric         AS kaina, a."pirkimoNumeris",
                         d.kodas                  AS "tiekejoKodas"
                  FROM atn1ataskaitos a
                           JOIN atn1dalyviai d ON d."ataskaitaId" = a.id
                           JOIN "atn1pasiulymuEile" e ON e."ataskaitaId" = a.id AND e."dalyvioKodas" = d.kodas
                  WHERE a."pagrindinisKodasBvpz" IS NOT NULL
                    AND e.kaina ~ '^\d+(\.\d+)?$')
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

### 18. Contract amendment escalation — low bid, then value inflated through amendments

> *"They won with a suspiciously low bid and then the contract value tripled through amendments. I want to see which contracts had the biggest gap between the signed price and the final invoiced amount."*

- What is the ratio of `faktineIvykdimoVerte` (actual final value) to `verte` (originally signed value) across a supplier's contracts?
- Which buyers tolerate the highest amendment overruns?
- Are there patterns where a supplier consistently under-bids relative to what they ultimately collect?

```sql
-- Suppliers with highest median amendment overrun ratio (min 5 contracts, overrun > 50%)
SELECT s."tiekejoKodas",
       MAX(j.pavadinimas)                                        AS tiekejas,
       COUNT(*)                                                  AS sutarciu_sk,
       ROUND(AVG(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0)), 2)    AS vid_koef,
       ROUND(MAX(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0)), 2)    AS max_koef,
       ROUND(SUM(s."faktineIvykdimoVerte" - s.verte))            AS bendra_pervirsis
FROM sutartys s
JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
WHERE s."faktineIvykdimoVerte" IS NOT NULL
  AND s.verte > 0
  AND s.istrinta IS NOT TRUE
GROUP BY s."tiekejoKodas"
HAVING COUNT(*) >= 5
   AND AVG(s."faktineIvykdimoVerte" / NULLIF(s.verte, 0)) > 1.5
ORDER BY vid_koef DESC
LIMIT 200;
```

**What is currently missing:**

The system captures the **end result** (final invoiced vs. originally signed value via `faktineIvykdimoVerte` / `verte`) but not the amendment trail itself. The `dokumentai` JSONB column contains attached document names but is not structured amendment history. To fully answer this question the schema would need:

- A separate amendments table with: amendment date, amendment reason, value delta, approval authority
- Or structured parsing of the `dokumentai` JSONB to extract amendment documents and their dates

This is a data sourcing gap — the amendment sequence is published on the CVP IS portal but is not currently ingested.

---

### 19. Municipal company favoritism — buyer awards contracts to its own subsidiary

> *"This municipality keeps awarding contracts to a company that is effectively owned by the municipality itself, bypassing competition."*

- What fraction of a municipality's contracts by value go to companies where the municipality is a declared shareholder or founder?
- Does that company win through competitive procedures, or mostly direct awards and framework call-offs?

```sql
-- Contracts where buyer and supplier share declared persons (proxy for municipal subsidiary link)
WITH buyer_persons AS (
    SELECT "jarKodas", vardas, pavarde
    FROM "pinregJuridiniaiRysiai"
    WHERE "darbovietesTipas" = 'STANDARTINE'
      AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
),
supplier_persons AS (
    SELECT "jarKodas", vardas, pavarde
    FROM "pinregJuridiniaiRysiai"
    WHERE "darbovietesTipas" = 'STANDARTINE'
      AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
)
SELECT s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       s."tiekejoKodas",
       MAX(j.pavadinimas) AS tiekejas,
       COUNT(DISTINCT s."sutartiesUnikalusId") AS sutarciu_sk,
       ROUND(SUM(s.verte)) AS bendra_verte,
       STRING_AGG(DISTINCT bp.vardas || ' ' || bp.pavarde, ', ' ORDER BY bp.vardas || ' ' || bp.pavarde) AS bendri_asmenys
FROM sutartys s
JOIN "jarCsv" j ON j."jarKodas"::text = s."tiekejoKodas"
JOIN buyer_persons bp  ON bp."jarKodas" = s."perkanciosiosOrganizacijosKodas"
JOIN supplier_persons sp ON sp."jarKodas" = s."tiekejoKodas"
                         AND sp.vardas = bp.vardas AND sp.pavarde = bp.pavarde
WHERE s.istrinta IS NOT TRUE
GROUP BY s."perkanciosiosOrganizacijosKodas", s."tiekejoKodas"
HAVING COUNT(DISTINCT s."sutartiesUnikalusId") >= 3
ORDER BY bendra_verte DESC
LIMIT 200;
```

**What is currently missing:**

The query above detects shared *declared people* as a proxy — it catches cases where a municipal official sits on both the buyer board and the supplier board. However, it does **not** detect formal ownership: a municipality holding a 51% stake in a company does not appear in PINREG at all unless an individual official made a personal declaration. True detection requires:

- A company-owns-company ownership table sourced from JAR registry (ownership share, owner type `SAVIVALDYBĖ`)
- Or a dedicated feed of municipal-owned enterprise registrations

---

### 20. Restricted procedure manipulation — buyer hand-picks the same invitees

> *"This buyer uses restricted tenders where they get to choose who receives an invitation, and I'm pretty sure the same companies get invited every single time."*

- How often does this buyer use restricted or negotiated procedures (`pirkimoBudas` = `Ribotas konkursas`, `Skelbiamos derybos`) vs. open competition?
- What is the direct-award audit history from `neskelbiamosDerybos`?

```sql
-- Buyer's procedure mix: how much goes through restricted/negotiated vs. open
SELECT s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       MAX(j.pavadinimas) AS pirkejas,
       s.tipas,
       COUNT(*)           AS sutarciu_sk,
       ROUND(SUM(s.verte)) AS bendra_verte
FROM sutartys s
JOIN "jarCsv" j ON j."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
WHERE s.istrinta IS NOT TRUE
GROUP BY s."perkanciosiosOrganizacijosKodas", s.tipas
ORDER BY "pirkejoKodas", bendra_verte DESC
LIMIT 200;
```

```sql
-- Direct-award audit findings for a buyer (neskelbiamosDerybos)
SELECT nd."jarKodas", nd."jarPavadinimas",
       nd.data, nd.isvada, nd.aprasymas
FROM "neskelbiamosDerybos" nd
WHERE nd."jarKodas" = '123456789'
ORDER BY nd.data DESC
LIMIT 200;
```

**What is currently missing:**

`neskelbiamosDerybos` records audit findings about unjustified direct awards — useful signal. However, for restricted procedures the system **cannot** identify which companies were invited but chose not to bid: the `atn1dalyviai` table only records companies that submitted a bid, not the full invitation list. Detecting systematic exclusion of qualified suppliers from invite lists would require the invitation list data from CVP IS, which is not currently ingested.

---

### 21. Political connection favoritism — companies linked to party donors or politicians

> *"I have a hunch that this company's owners are close to the ruling party and that's why they keep winning."*

**Not currently feasible.** The schema contains no political donation registry, no party membership data, and no politician–company link table. Detection would require:

- Cross-referencing with the Central Electoral Commission (VRK) donor database
- Matching donor names to company directors/shareholders in PINREG by name + approximate date

This is a data sourcing gap. The VRK publishes donor data publicly; if ingested and name-matched against `pinregJuridiniaiRysiai`, this theme becomes tractable.

---

### 22. Fictitious deliverables — contract marked complete but work never done

> *"The contract says it was executed in full, but the road they were paid to repair is in the same condition as before. Is there any signal in the data?"*

**Not currently feasible from structured data alone.** The `faktineIvykdimoVerte` field confirms payment was recorded, not that delivery occurred. Detection would require:

- Field inspection records or satellite imagery analysis (e.g., road condition scoring)
- Invoice-level data from SABIS cross-referenced against delivery acceptance documents
- Complaint or audit trail data from STT or NKT

The closest available signal is a VDI labor violation (`vdiPazeidimai`) on the contractor during the contract execution period — suggesting the workforce was unavailable — but this is weak and indirect.

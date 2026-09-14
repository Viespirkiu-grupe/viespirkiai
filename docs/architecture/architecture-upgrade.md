# Viešpirkiai — Target Architecture (Upgrade)

Notation follows `architecture-current.md`, with stereotypes for the target components:

| Notation         | Meaning                                                               |
|------------------|-----------------------------------------------------------------------|
| **Solid arrow**  | Dependency (A uses B)                                                 |
| **Dotted arrow** | Data flow (data moves from A to B)                                    |
| Circle           | Provided interface (lollipop)                                         |
| `«core»`         | Core Component: main functional component (solid blue)                |
| `«supporting»`   | Supporting Component: secondary functional component (dashed blue). A decomposed core component can own supporting components |
| `«missing»`      | Supporting Component that does not exist today (dashed red)           |
| `«database»`     | Data store (green cylinder)                                           |
| `«schema»`       | One PostgreSQL schema inside a database (green cylinder, bold name)   |
| `«schemas»`      | Group of PostgreSQL schemas of one kind (green cylinder, bold names)  |
| `«actor»`        | Person or external system that starts an interaction                  |
| `«external»`     | System outside this repository (dashed grey)                          |

## Terminology

The document uses these terms with one meaning each:

| Term                      | Meaning                                                                                                       | Code or section                                        |
|---------------------------|---------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| Functional component      | Unit of responsibility with owned data. It is not necessarily a separate process                             | §1, §3                                                 |
| Core component            | Functional component that delivers the main value of the system. Diagrams mark it `«core»`                   | §1                                                     |
| Supporting component      | Functional component that core components need. A core component can own supporting components when it is decomposed. Diagrams mark it `«supporting»` | §2.1, §3                                  |
| `S1`–`S10`, `I1`–`I9`     | Ids of the supporting components (§3) and of the sub-components of Extract and Normalize & Link (§2.4)        | —                                                      |
| Source schema             | PostgreSQL schema that mirrors one upstream source: a persistent staging area                                 | `vpmSutartys`, `eppsViesiejiPirkimai`, `rcJar`; §8.2   |
| `ods`                     | Operational Data Store: canonical entities, enrichment, link tables, derived tables and views                 | §8                                                     |
| Fact schemas              | The source schemas and `ods` together. Data Ingestion is their only writer                                    | §1.2, §2.3                                             |
| Extract                   | Supporting component of Data Ingestion. It collects data from upstream sources into the source schemas and document content | §2.1, §2.4                               |
| Normalize & Link          | Supporting component of Data Ingestion. It reads the source schemas and writes `ods`                         | §2.1, §2.4                                             |
| Document content          | Extracted text and OCR results of downloaded files                                                            | I4, `packages/storage`                                 |
| Enrichment                | Attributes from registries and classifiers that Normalize & Link adds to `ods` entities                       | §8.3                                                   |
| AI enrichment             | LLM descriptions and embeddings that S3 writes to the AI enrichment store                                     | S3                                                     |
| Control schemas           | `infra`, `auth` and `jobs`: runtime configuration, API keys and job state. They form the Control layer        | §3, §8.10                                              |
| Staging layer             | Source schemas, raw payloads and files. Extract writes it; only Normalize & Link and S7 read it               | §8.2                                                   |
| Integration & Serving layer | `ods`, document content, `risk`, search indexes and the AI enrichment store. The Query Service reads only this layer | §8.2                                          |
| Control layer             | The control schemas. It holds no domain data                                                                  | §8.2, §8.10                                            |
| Deliver stage             | S2 Search Indexing and S3 AI Enrichment: pipeline work that runs after Data Ingestion commits facts           | §3, §3.1                                               |
| Facts changed event       | Hint that Normalize & Link committed changes to `ods` entities in one ingestion run                           | `packages/events`, §2.2                                |
| Ingestion run             | One execution of an ingestion job. `ods` rows store its id in `ikelimoId`                                     | §8.4                                                   |
| Job                       | Unit of scheduled or queued work that S1 manages. The current code calls it a *task*                          | `packages/jobs`; `tasks/*.js`, `runner/`               |
| Organisation              | Party of a procurement: registered legal entity, foreign company or natural person. Buyer and supplier are roles | `ods."organizacijos"`; §9 Q3, Q11                   |
| Risk signal               | Result of one risk indicator for one subject                                                                  | `risk."signals"`                                       |
| Procurement risk decision | Current risk evaluation of one procurement. It groups the risk signals of that procurement                   | `risk."procurementDecisions"`                          |
| BVPŽ                      | Lithuanian name of the Common Procurement Vocabulary (CPV)                                                    | `bvpzKodai`                                            |
| `lempa`                   | Primary physical server. It runs the alpha and production environments                                        | §7                                                     |
| Environment               | `alpha` or `prod` on `lempa`: one data compose project and one business compose project                       | §7.6                                                   |
| Release                   | Image digests and the `infra/` directory of one published commit on `main`                                    | §7.3, §7.5                                             |
| Operator                  | Team member who issues ingestion commands and production deployments                                         | §2.2, §7                                               |

---

## 1. Core functional components

The system has **five core functional components** around **one shared database**:

| # | Component                    | Purpose (one sentence)                                                                                                                     | Primary actors                                                    |
|---|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| 1 | **Data Ingestion**           | Brings public data from upstream sources into the Viešpirkiai database as normalised, linked and versioned facts.                          | Upstream registries & portals, OCR workers, text extractors, operator |
| 2 | **Query Service**            | The single read path to Viešpirkiai data: entity lookups, search, relationships, documents and risk results behind stable query contracts. | Frontend, MCP, Procurement Risk Service, S3, S4                   |
| 3 | **Procurement Risk Service** | Evaluates procurements against risk indicators and records explainable risk decisions.                                                     | Analysts (through Frontend and MCP), operator                     |
| 4 | **Frontend**                 | Publishes the data as a searchable public website.                                                                                         | Citizens, journalists, researchers, NGOs                          |
| 5 | **MCP**                      | Gives LLM agents structured, read-only access to the data through tools.                                                                   | AI agents / MCP clients                                           |

### 1.1 Core functional component diagram

```mermaid
flowchart LR
    classDef actor fill: #ffffff, stroke: #222, stroke-width: 1.5px, color: #111
    classDef core fill: #dbe9fb, stroke: #1f5fa8, stroke-width: 2px, color: #0b2545
    classDef store fill: #eaf6ea, stroke: #2e7d32, color: #123d14
    classDef ext fill: #f4f4f4, stroke: #777, stroke-dasharray: 4 3, color: #333
    src["«external»<br/>Public registries & portals<br/>CVP IS · TED · data.gov.lt · RC ·<br/>LITEKO · e-TAR · Sodra …"]:::ext
    op(["«actor»<br/>Operator"]):::actor
    citizen(["«actor»<br/>Citizen / journalist /<br/>researcher"]):::actor
    agent(["«actor»<br/>AI agent<br/>(MCP client)"]):::actor
    ing["«core»<br/><b>Data Ingestion</b><br/>Extract · Normalize & Link"]:::core

    subgraph STG["Staging layer"]
        srcdb[("«schemas»<br/><b>Source schemas</b><br/>one per upstream source")]:::store
    end
    subgraph ISL["Integration & Serving layer"]
        ods[("«schema»<br/><b>ods</b><br/>procurements · contracts · organisations ·<br/>persons · documents · legal acts · court cases")]:::store
        riskdb[("«schema»<br/><b>risk</b><br/>procurement risk decisions · risk signals")]:::store
    end

    qs["«core»<br/><b>Query Service</b><br/>query contracts over ods & risk"]:::core
    risk["«core»<br/><b>Procurement Risk Service</b><br/>indicator evaluation · decisions"]:::core
    fe["«core»<br/><b>Frontend</b><br/>public search & entity pages"]:::core
    mcp["«core»<br/><b>MCP</b><br/>tools for LLM agents"]:::core
%% ── Actors ──
    op --> ing
    op --> risk
    citizen --> fe
    agent --> mcp
%% ── Ingestion ──
    ing --> src
    src -.->|" raw records & documents "| ing
    ing -.->|" source rows "| srcdb
    ing -.->|" entities · links · derived rows "| ods
%% ── Read path ──
    fe --> qs
    mcp --> qs
    risk --> qs
    qs -->|" reads "| ISL
%% ── Risk writes ──
    risk -.->|" writes decisions "| riskdb
```

### 1.2 Core components: use cases and data ownership

| Component                    | Key use cases                                                                                                                                                                                                                                                      | Depends on                                                            | Writes (owns)                                          | Current code                                                                                                                           |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| **Data Ingestion**           | Discover new records · import and refresh incrementally · backfill history · acquire and process documents (download, extract, OCR) · link entities and reference data · detect and version changes (contract edits, legislation editions, court decision updates) | Upstream sources, S1 Job Orchestration                                | **Fact schemas**: Extract writes the source schemas and document content; Normalize & Link writes `ods` (§2, §8) | `tasks/*`, `modules/<source>/*`, `modules/failai/`, `modules/documents/`, `runner/`                                                    |
| **Query Service**            | Look up an entity by identifier · search and facet (contracts, procurements, organisations, documents) · traverse relationships · read document content · read risk results · provide bulk analytical reads · run bounded ad-hoc SQL for analysts                  | `ods` and `risk` (read-only role), S2 search indexes, document content store, S3 AI enrichment store | **Nothing.** Read-only by definition.                  | Scattered: SQL in 21 pages under `src/pages`, `src/lib/*`, `modules/*/search*.js`, `modules/rysiai/`, `modules/mcp/tools/`, `modules/mcp/analyst/` |
| **Procurement Risk Service** | Run evaluation for all procurements or a subset · evaluate each deployed indicator · record explainable procurement risk decisions and risk signals · re-evaluate after "facts changed"                                                                                                              | **Query Service** (analytical reads), S1                              | **`risk` schema** only                                 | `services/procurement-risk/`, `modules/risk/`                                                                                          |
| **Frontend**                 | Search · entity pages (buyer, supplier, person, contract, procurement, legal act, court decision) · relationship graph · statistics · shareable pages (OpenGraph)                                                                                                  | **Query Service**                                                     | **Nothing.**                                           | `src/`                                                                                                                                 |
| **MCP**                      | List tools · search and fetch entities · read contract changes · read document and legal act text · describe schema · run analyst SQL (optional)                                                                                                                                                      | **Query Service**                                                     | **Nothing.** Tool-call audit goes to S6 Observability. | `modules/mcp/`, `src/pages/mcp.astro`, `src/lib/mcp.ts`                                                                                |

**Ownership rules (target)**

1. **One writer per schema.** Data Ingestion owns the source schemas and `ods`: its Extract component writes the source
   schemas, and its Normalize & Link component writes `ods`. The Risk Service owns `risk` (§8). S3
   owns the AI enrichment store. The writers of the control schemas are open (§9 Q6).
2. **One read path.** Frontend, MCP and the Risk Service never query the database directly. They go through the Query
   Service. This is the boundary that removes SQL from pages and tools (review P5).
3. Today both rules are broken:
    - SQL is spread across pages, MCP tools and risk indicators.
    - The Frontend writes OCR results and creates tables at runtime.
    - MCP writes tool-call logs.
    - Every process can import any module.

### 1.3 Query Service

The Query Service turns the database schema into a **published query contract**. Consumers depend on named queries with
typed results, never on table layouts. A schema change then touches one component instead of dozens of call sites.

| Query family                                                                                                       | Consumers                  | Notes                                                                        |
|--------------------------------------------------------------------------------------------------------------------|----------------------------|------------------------------------------------------------------------------|
| **Entity queries**: get procurement, contract, organisation, person, document, legal act, court case by identifier | Frontend, MCP              | Includes change history of the entity                                        |
| **Search & facets**: full-text and filtered search, suggestions, facet counts                                      | Frontend, MCP              | Uses S2 search indexes; PostgreSQL fallback lives here, not in consumers |
| **Relationship queries**: organisation–person–contract graph traversal                                             | Frontend, MCP, Risk Service | Graph *building* belongs to Normalize & Link; graph *reading* belongs here   |
| **Document content**: extracted text, OCR result, file reference                                                   | Frontend, MCP              | Replaces direct sidecar reads and the sidecar HTTP API                       |
| **Risk results**: procurement risk decisions and their risk signals                                  | Frontend, MCP              | Reads the `risk` schema                                                      |
| **Analytical reads**: set-based, streamed reads over large `ods` sets                                              | Risk Service, S4 Open Data | Reads `ods` tables and views (§8.3), not per-row calls, so batch jobs stay efficient |
| **Ad-hoc SQL** (bounded): read-only, time-limited, restricted to `ods`                                     | MCP                        | Enforcement by database role grants, not only by SQL parsing (review P3)  |

The Query Service reads only the Integration & Serving layer (§8.2). It is an in-process library, not a network service.
It holds a read-only connection pool over `ods` and `risk`, plus clients for the search indexes, the document content
store and the AI enrichment store. Its value is the contract and the
boundary, not the deployment.

---

## 2. Data Ingestion — the abstraction

### 2.1 Data Ingestion is one core component with two supporting components

The current code implements ingestion as **30+ source modules**. Each module re-implements its own discovery, fetching,
parsing, queues, reservation cleanup and persistence (review P5, P6).

From the rest of the system's point of view, all of it has **one responsibility and one output**: *keep the fact schemas
complete, correct and current*. Treating it as a single black box, with a stable external contract and freely
decomposable internals, gives:

- **Consumers** (Query Service, Risk, Search Indexing, AI Enrichment, Open Data) depend only on the *facts* and on *"facts changed"*
  notifications, never on how a source is scraped.
- **New sources** plug into a shared pipeline instead of copying a whole module.
- **Internal redesign** (queues, scheduler, document processing) doesn't ripple outside.

Data Ingestion owns two supporting components. They do not call each other; the source schemas are the boundary between
them.

| Component            | Responsibility                                                                            | Reads                                          | Writes                                          | Stages (§2.4) | Sub-components (§2.4) |
|----------------------|-------------------------------------------------------------------------------------------|------------------------------------------------|-------------------------------------------------|---------------|-----------------------|
| **Extract**          | Collect data from upstream sources on the internet: discover, fetch, retain, parse, stage | Upstream sources, text extractors, OCR workers | Source schemas, raw payloads, document content  | 1–5           | I1–I4                 |
| **Normalize & Link** | Populate `ods` from the source schemas: normalise, enrich, resolve entities, persist, notify | Source schemas                              | `ods`, facts changed events                     | 6–9           | I5–I8                 |

Ingestion Control (I9) belongs to Data Ingestion itself and schedules both components through S1. Normalize & Link never
calls an upstream source, so `ods` can be rebuilt from the source schemas without a new extraction (G9).

### 2.2 External contract (black-box view)

```mermaid
flowchart LR
    classDef actor fill: #ffffff, stroke: #222, stroke-width: 1.5px, color: #111
    classDef core fill: #dbe9fb, stroke: #1f5fa8, stroke-width: 2px, color: #0b2545
    classDef sup fill: #f5f9ff, stroke: #1f5fa8, stroke-dasharray: 3 2, color: #0b2545
    classDef store fill: #eaf6ea, stroke: #2e7d32, color: #123d14
    classDef ext fill: #f4f4f4, stroke: #777, stroke-dasharray: 4 3, color: #333
    classDef iface fill: #ffffff, stroke: #1f5fa8, color: #0b2545
    classDef missing fill: #fff4f4, stroke: #c62828, stroke-dasharray: 3 2, color: #5a1010
    src["«external»<br/>Public registries & portals"]:::ext
    extr["«external»<br/>Text extractors"]:::ext
    ocr(["«actor»<br/>OCR workers"]):::actor
    fpr(["«actor»<br/>goViesdezeProxyRewrite<br/>file gateway"]):::actor
    iCmd(("Ingestion<br/>commands")):::iface
    iWork(("OCR work<br/>distribution")):::iface
    iFile(("File<br/>lookup")):::iface
    iStatus(("Ingestion<br/>status")):::iface
    iEvt(("Facts changed<br/>events")):::iface
    ing["«core»<br/><b>Data Ingestion</b><br/>(black box)"]:::core
    srcdb[("«schemas»<br/><b>Source schemas</b>")]:::store
    ods[("«schema»<br/><b>ods</b>")]:::store
    docs[("Document content store")]:::store
    s1["«supporting» S1<br/>Job Orchestration"]:::sup
    s6["«supporting» S6<br/>Observability"]:::sup
    s9["«missing» S9<br/>Operations Console"]:::missing
    cons["«core / supporting»<br/>Risk · S2 Search Indexing ·<br/>S3 AI Enrichment · S4 Open Data"]:::sup
    iCmd --- ing
    iWork --- ing
    iFile --- ing
    iStatus --- ing
    iEvt --- ing
    s9 -->|" commands as S1 jobs "| iCmd
    ocr -->|" checkout · submit "| iWork
    fpr -->|" file id → storage box "| iFile
    s6 --> iStatus
    cons --> iEvt
    ing --> src
    ing -->|" POST /extract "| extr
    ing --> s1
    src -.->|" raw records & files "| ing
    ing -.->|" source rows "| srcdb
    ing -.->|" entities · links · derived rows "| ods
    ing -.->|" document content "| docs
```

The operator issues ingestion commands through S9.

| Interface                             | Direction         | Purpose                                                                                                                                                                                                                                    |
|---------------------------------------|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Writes facts**                      | Output → database | The only output that matters to consumers. Extract writes source rows and document content; Normalize & Link writes canonical, linked, versioned `ods` facts                                                                             |
| **Facts changed events**              | Provided          | "Entity X of type T changed in ingestion run R", emitted by Normalize & Link **after commit**. It is a hint: consumers re-read the entities through the Query Service, and S2 reads `ods` directly (§4). Replaces the `*.changed` NATS subjects of `utils/taskSignals.js`. The delivery guarantee is open (§9 Q2). |
| **Ingestion status**                  | Provided          | Per source: last successful sync, lag, error rate, backlog, record counts. Feeds S6 and `/statistika`.                                                                                                                                     |
| **Ingestion commands**                | Provided          | Run, backfill, re-process, pause or resume a source; requeue a record. S9 issues each command as an S1 job. Replaces ad-hoc `npm run` scripts.                                                                                             |
| **OCR work distribution**             | Provided          | Checkout and submit for external OCR workers, provided by Extract (I4). Moves out of the Frontend (`src/pages/failas/ocr/*`).                                                                                                                                        |
| **File lookup**                       | Provided          | Resolves a file to the storage box that holds it, for `goViesdezeProxyRewrite`; provided by Extract (I4). Moves out of the Frontend (`downloadProxyInformation`).                                                                                                    |
| Upstream sources, text extractors, S1 | Required          | Everything the black box needs from outside. Extract calls text extractors with `POST /extract`.                                                                                                                                           |

### 2.3 Contract guarantees

These invariants are what "writes facts" *means*. Every internal design decision must preserve them.

| #  | Guarantee                                                                                                                                                     | Why it matters                                                              | Today                                   |
|----|---------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|-----------------------------------------|
| G1 | **Single writer**: only Data Ingestion writes fact schemas. Extract writes the source schemas; Normalize & Link writes `ods`                                   | Clear ownership; safe schema evolution                                      | ❌ multiple writers                     |
| G2 | **Canonical model**: `ods` uses normalised entities (procurement, contract, organisation, person, document, legal act, court case). Only source schemas keep source-specific shapes (§8) | Consumers stay stable when a source changes format                          | ⚠️ only `v_*` analyst views (review P13) |
| G3 | **Provenance**: every `ods` row records its source, source record id and ingestion run (§8.4). The referenced source row records source URL and retrieval time | Transparency, auditability, debugging                                       | ⚠️ inconsistent                         |
| G4 | **Idempotency**: re-ingesting a source record never duplicates or corrupts facts                                                                              | Safe retries, backfills and re-processing                                   | ⚠️ per module                           |
| G5 | **Versioned changes**: changes in source records become recorded versions, not silent overwrites                                                              | Contract edits, legislation editions and court updates are product features | ⚠️ some sources                         |
| G6 | **Reprocessability**: raw payloads and files are retained, so parsing and normalisation can be re-run without re-scraping                                     | Sources disappear or block access; parsers improve                          | ⚠️ sidecars have no backup; the file archive has an S3 object storage backup |
| G7 | **Commit, then notify**: events and notifications are sent only after facts are committed                                                                     | No consumer reads uncommitted state                                         | ✅ documented NATS rule                 |
| G8 | **Observable freshness**: every source reports sync status and lag                                                                                            | Operators and users know how current the data is                            | ⚠️ partial                              |
| G9 | **Layered flow**: Normalize & Link reads only the source schemas and never calls an upstream source                                                          | A mapping or linking fix rebuilds `ods` without a new extraction            | ⚠️ per module                           |

### 2.4 Internal view

Every source goes through the same stages. Only the source-specific stages are implemented per source; the rest are
shared. Extract runs stages 1–5 and writes the source schema. Normalize & Link runs stages 6–9 and writes `ods`. The
Staging layer (§8.2) is the boundary between the two components.

```mermaid
flowchart LR
    classDef specific fill: #dbe9fb, stroke: #1f5fa8, color: #0b2545
    classDef shared fill: #f5f9ff, stroke: #1f5fa8, stroke-dasharray: 3 2, color: #0b2545
    subgraph extract["«supporting» Extract"]
        d["1 · Discover<br/>what is new or changed"]:::specific
        f["2 · Fetch<br/>via Source Gateway"]:::shared
        r["3 · Retain raw<br/>payload · file"]:::shared
        p["4 · Parse & extract<br/>structure · text · OCR"]:::specific
        s["5 · Stage<br/>upsert source schema rows"]:::specific
    end
    subgraph normalizeLink["«supporting» Normalize & Link"]
        n["6 · Normalise<br/>source rows to canonical model"]:::specific
        l["7 · Link & enrich<br/>reference data · entity resolution"]:::shared
        w["8 · Persist<br/>ods upsert · version · provenance"]:::shared
        e["9 · Notify<br/>facts changed"]:::shared
    end
    d -.->|" record references "| f
    f -.->|" payload · file "| r
    r -.->|" retained payload "| p
    p -.->|" parsed records · text "| s
    s -.->|" source schema rows "| n
    n -.->|" canonical entities "| l
    l -.->|" linked, enriched entities "| w
    w -.->|" committed changes "| e
```

Solid blue: source-specific stage, implemented once per source. Dashed: shared stage, implemented once.

**Source connector types.** Extract groups sources by *how* they are acquired, which keeps the number of connector
patterns small:

| Connector type                        | Examples today                                                                  |
|---------------------------------------|---------------------------------------------------------------------------------|
| Bulk dataset (CSV / XLSX / JSON dump) | JAR CSV, VPT XLSX reports, address register, Sodra, Regitra                     |
| Change feed                           | data.gov.lt ADP `:changes` datasets                                             |
| Crawler / scraper                     | CVP IS contracts and procurements, CVPP, LITEKO, KOTIS, PINREG, ES investicijos |
| API adapter                           | e-TAR, e-Seimas (stateless adapter), TED                                        |
| Document pipeline (source-agnostic)   | Any fact that references a file: download → store → extract → OCR               |

**Internal sub-components** (candidates for the detailed decomposition):

| #  | Component        | Sub-component                       | Responsibility                                                                                                     | Current code                                                                                                                                                                   |
|----|------------------|-------------------------------------|--------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| I1 | Extract          | **Source Connectors**               | Source-specific discovery, parsing and source schema rows, one per source (stages 1, 4, 5)                         | `modules/<source>/*`                                                                                                                                                           |
| I2 | Extract          | **Source Gateway**                  | Outbound access: proxies, Tor, per-source rate limits, request logging, adapters (stage 2)                         | `utils/scrapeFetch.js`, `modules/scrapeProxies/`, `modules/proxy/`, eTarSeimasScraper clients                                                                                  |
| I3 | Extract          | **Raw Payload Store**               | Retain raw API and HTML payloads for audit and re-processing (stage 3)                                             | sidecar SQLite (`eTar`, `eSeimas`, `liteko2`)                                                                                                                                  |
| I4 | Extract          | **File & Document Pipeline**        | Download, content-addressed storage, extraction, OCR work distribution, file lookup, document content              | `modules/failai/`, `modules/documents/`, `tasks/dokNuskaitytojai.js`, goViesdeze, OCR endpoints, sidecar SQLite (`failaiInfo`, `dokumentai`, `ocrRezultatai`)                  |
| I5 | Normalize & Link | **Canonical Model & Normalisation** | Shared entity definitions (`packages/domain`) and one source-to-canonical mapper per source; produces `ods` entity rows (stage 6) | `upsert*.js`, per-module mapping code                                                                                                                                          |
| I6 | Normalize & Link | **Reference Data**                  | CPV (BVPŽ), legal forms, addresses and geocoding, classifiers; produces enrichment (stage 7)                        | `modules/bvpz/`, `modules/geografija/`, `modules/liteko2/klasifikatoriai.js`                                                                                                   |
| I7 | Normalize & Link | **Entity Resolution**               | Match organisations, procurements and contracts across sources; produce link tables and relationship edges (stage 7) | `modules/juridiniai/`, `modules/rysiai/` (building), `modules/2014esinvesticijos/rastiPareiskejuKodus.js`, `src/lib/sutartisPirkimai.ts`, `loadPpaSutarciuAtitikmenys()` in `src/lib/ppa.ts` |
| I8 | Normalize & Link | **Fact Persistence & Versioning**   | Idempotent upserts, change detection and diffs, provenance, derived tables, notifications (stages 8, 9)            | `sutartys` change tracking, `modules/sutartys/upsertVpmSutartis.js`, `teisekura` editions, `utils/taskSignals.js`                                                              |
| I9 | Data Ingestion   | **Ingestion Control**               | Per-source schedules of Extract and Normalize & Link, backfills, commands, status and freshness                    | `tasks/*.js` definitions, `npm run` scripts                                                                                                                                    |

---

## 3. Supporting (secondary) functional components

These do not deliver end-user value on their own, but the core components can't function reliably without them.
Data Ingestion owns two further supporting components, Extract and Normalize & Link (§2.1). Source access and file and
document processing belong to Extract (I2, I4). Reference data and entity resolution belong to Normalize & Link (I6,
I7).

S2 Search Indexing and S3 AI Enrichment form the **Deliver stage** of the data pipeline. They run after Data Ingestion
commits facts and write derived stores in the Integration & Serving layer. They are not part of Data Ingestion: their
outputs are not facts, S3 output is not deterministic, and their failures must not delay fact writes (G1, G4, G9).

| #       | Component                      | Responsibility                                                                                                                                            | Serves                                  | Exists today?     | Current code / gap                                                                                                  |
|---------|--------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------|-------------------|---------------------------------------------------------------------------------------------------------------------|
| **S1**  | **Job Orchestration**          | Scheduling (cron and continuous), durable work queues, retries and back-off, reservation expiry, concurrency limits, wake-up signals                      | Data Ingestion, Risk, S2, S3, S4        | ✅ Home-grown     | `runner/`, `tasks/`, per-domain `SKIP LOCKED` queues, NATS                                                          |
| **S2**  | **Search Indexing**            | Build search indexes (Quickwit full-text, Typesense suggestions and organisations) from `ods` on "facts changed"; rebuild and drift detection | Query Service                           | ✅ Partial        | `quickwit/`, `modules/*/quickwitProcessIndexQueue.js`, `modules/juridiniai/typesense*`, `modules/searchSuggestion/` |
| **S3**  | **AI Enrichment**              | LLM-generated descriptions, embeddings; owns the AI enrichment store (does **not** write facts, §9 Q7); cost, rate, prompt and model versioning           | Query Service                           | ✅ Experimental   | `modules/openrouter/`, `modules/vector/`, `scripts/aprasyti*.js`; descriptions in `eppsViesiejiPirkimai."aprasymai"` |
| **S4**  | **Open Data Publishing**       | Publish curated datasets to the open-data API (Spinta / viesStalcius) and bulk exports; reads through the Query Service                                   | Open-data consumers                     | ✅ Scattered      | `modules/spinta/`, `modules/*/pushToSpinta.js`, `export:*` scripts, export WebSocket                                |
| **S5**  | **Identity & Access**          | API keys for machine clients, worker registry, MCP client identification, rate limiting and abuse protection, analyst role policy                         | Frontend, MCP, Data Ingestion (workers) | ⚠️ Partial        | `auth.raktai`, `modules/failai/auth.js`, `src/lib/botChallenge.ts`; **no rate limiting, no key rotation**           |
| **S6**  | **Observability & Statistics** | Metrics, logs (SQL, scrape, MCP tool calls), ingestion status, job health, alerting, public statistics                                                    | Operator, Frontend (`/statistika`)      | ⚠️ Partial        | `modules/statistika/`, `/metrics`, SQL and scrape log ingest; **no taskRunner health, no alerting**                 |
| **S7**  | **Schema & Data Governance**   | Versioned migrations, schema documentation, table ownership map, data-quality checks, reconciliation of derived stores                                    | All core components                     | ⚠️ Fragmented     | `migrations/` (incomplete), `postgres/dumpSchema.js`, schema scripts; **no migration runner**                       |
| **S8**  | **Backup & Recovery**          | PostgreSQL backups with point-in-time recovery, raw payload and document-store backups, file archive backup, **tested restore**                           | Whole system                            | ❌ Mostly missing | Only `modules/s3backup/` (file archive to S3 object storage)                                                                                |
| **S9**  | **Operations Console**         | Issue ingestion commands; manage runtime configuration kept as data (proxies, workers, storage boxes, API keys, info banner, job toggles)                 | Operator                                | ❌ Missing        | pgAdmin, raw SQL, `npm run` scripts                                                                                 |
| **S10** | **Configuration & Secrets**    | One source of truth for configuration, secret storage and rotation, per-environment settings                                                              | All components                          | ⚠️ Sprawl         | `config.js`, `.env`, `utils/config*.js`, `ENV.md`                                                                   |

### 3.1 Full functional component diagram

```mermaid
flowchart TB
    classDef actor fill: #ffffff, stroke: #222, stroke-width: 1.5px, color: #111
    classDef core fill: #dbe9fb, stroke: #1f5fa8, stroke-width: 2px, color: #0b2545
    classDef sup fill: #f5f9ff, stroke: #1f5fa8, stroke-dasharray: 3 2, color: #0b2545
    classDef missing fill: #fff4f4, stroke: #c62828, stroke-dasharray: 3 2, color: #5a1010
    classDef store fill: #eaf6ea, stroke: #2e7d32, color: #123d14
    classDef ext fill: #f4f4f4, stroke: #777, stroke-dasharray: 4 3, color: #333

    subgraph L1["Actors"]
        citizen(["«actor»<br/>Citizen / journalist"]):::actor
        agent(["«actor»<br/>AI agent"]):::actor
        odc(["«actor»<br/>Open-data consumer"]):::actor
        op(["«actor»<br/>Operator"]):::actor
    end

    subgraph L2["Consumers"]
        fe["«core»<br/><b>Frontend</b>"]:::core
        mcp["«core»<br/><b>MCP</b>"]:::core
        risk["«core»<br/><b>Procurement Risk Service</b>"]:::core
        s4["«supporting» S4<br/>Open Data Publishing"]:::sup
    end

    qs["«core»<br/><b>Query Service</b>"]:::core

    subgraph DATA["Viešpirkiai data"]
        subgraph STG["Staging layer"]
            srcdb[("«schemas»<br/><b>Source schemas</b>")]:::store
            raw[("Raw payload & file store")]:::store
        end
        subgraph ISL["Integration & Serving layer"]
            ods[("«schema»<br/><b>ods</b>")]:::store
            docs[("Document content store")]:::store
            riskdb[("«schema»<br/><b>risk</b>")]:::store
            search[("Search indexes<br/>Quickwit · Typesense")]:::store
            enrich[("AI enrichment store<br/>descriptions · embeddings")]:::store
        end
        subgraph CTL["Control layer"]
            ctrl[("«schemas»<br/><b>Control schemas</b><br/><b>infra</b> · <b>auth</b> · <b>jobs</b>")]:::store
        end
    end

    subgraph PIPE["Data pipeline"]
        subgraph ing["«core» <b>Data Ingestion</b>"]
            extract["«supporting»<br/>Extract"]:::sup
            nl["«supporting»<br/>Normalize & Link"]:::sup
        end
        subgraph DLV["Deliver stage"]
            s2["«supporting» S2<br/>Search Indexing"]:::sup
            s3["«supporting» S3<br/>AI Enrichment"]:::sup
        end
        s1["«supporting» S1<br/>Job Orchestration"]:::sup
    end
    class ing core

    subgraph L6["Platform & operations (cross-cutting)"]
        s9["«missing» S9<br/>Operations Console"]:::missing
        s5["«supporting» S5<br/>Identity & Access"]:::sup
        s6["«supporting» S6<br/>Observability & Statistics"]:::sup
        s7["«supporting» S7<br/>Schema & Data Governance"]:::sup
        s8["«missing» S8<br/>Backup & Recovery"]:::missing
        s10["«supporting» S10<br/>Configuration & Secrets"]:::sup
    end

    workers(["«actor»<br/>OCR workers"]):::actor
    src["«external»<br/>Public registries & portals"]:::ext
    llm["«external»<br/>LLM & embedding providers"]:::ext
%% ── Actors ──
    citizen --> fe
    agent --> mcp
    odc --> s4
    op --> s9
    workers -->|" OCR checkout · submit "| extract
%% ── Read path (dependencies) ──
    fe --> qs
    mcp --> qs
    risk --> qs
    s4 --> qs
    qs -->|" reads "| ISL
%% ── Data pipeline: Data Ingestion ──
    extract --> src
    nl -->|" reads source rows "| srcdb
    ing --> s1
    s9 --> ing
%% ── Data pipeline: Deliver stage ──
    s2 -->|" reads "| ods
    s2 -->|" reads "| docs
    s2 -->|" reads descriptions "| enrich
    s3 --> qs
    s3 --> llm
    DLV --> s1
    risk --> s1
%% ── Writes into owned stores (data flows) ──
    extract -.->|" source rows · payloads · files "| STG
    extract -.->|" document content "| docs
    nl -.->|" entities · links · derived rows "| ods
    nl -.->|" facts changed "| DLV
    risk -.->|" writes decisions "| riskdb
    s2 -.->|" documents "| search
    s3 -.->|" descriptions · embeddings "| enrich
    s1 -.->|" job state "| ctrl
%% ── Platform ──
    s9 --> ctrl
    s5 -.->|" keys · clients "| ctrl
    s7 -.->|" migrations "| DATA
    s8 -.->|" backups "| DATA
```

This diagram shows **dependencies** and **writes into owned stores**. The Query Service reads only the Integration &
Serving layer; the Staging layer is internal to the data pipeline. Platform components (S5–S10) are cross-cutting;
only their data-store edges are drawn, to keep the diagram readable.

---

## 4. Classification rules

These rules decide where new functionality belongs, so that agentic development places code consistently (review P5,
P8).

1. **Does it bring data from outside into the database** (including files, OCR, reference data, entity linking)? →
   **Data Ingestion.** It is the only component that writes facts. Collecting from a source and staging source rows go
   to **Extract**. Mapping, enrichment and linking into `ods` go to **Normalize & Link**.
2. **Does it read Viešpirkiai data for someone else?** → it is a query in the **Query Service**. No other component
   issues read SQL against source, `ods` or `risk` schemas. The exceptions: a writer reads its own schemas, S2 index
   builders read `ods`, and S7 governance tooling reads every schema.
3. **Does it show data to humans?** → **Frontend**, using only the Query Service.
4. **Does it expose data to AI agents?** → **MCP**, using only the Query Service.
5. **Does it compute a judgement about procurements** (score, flag, indicator)? → **Procurement Risk Service.** It reads
   through the Query Service and writes only to `risk`.
6. **Does it turn existing data into another shape** (index, embedding, export)? → **S2, S3 or S4**, each writing only
   to its own store. An aggregate inside `ods` is a derived table or view of Normalize & Link (§8.9).
7. **Does it keep the system running, safe or recoverable?** → **Platform, S5–S10.**
8. **Is it a one-off or operator script?** → an ingestion command issued through S9, or S7 governance tooling. **Never**
   a self-executing file inside a library module.

---

## 5. Current-to-target mapping of notable misplacements

| Today                                                                                    | Problem                                                      | Target owner                                                                     |
|------------------------------------------------------------------------------------------|--------------------------------------------------------------|----------------------------------------------------------------------------------|
| SQL in 21 pages under `src/pages`, query code in `src/lib`, separate queries in MCP tools            | No single read path; the same logic is written several times | **Query Service**                                                                |
| Risk indicators query `ppa."ataskaitos"` and views directly                              | Risk Service coupled to table layouts                        | **Query Service** (analytical reads)                                             |
| OCR checkout/submit endpoints inside the Frontend                                        | Public web app writes to the database and sidecars           | **Extract** of Data Ingestion (I4, OCR work distribution interface)                  |
| `downloadProxyInformation` inside the Frontend                                           | Internal file lookup on the public surface                   | **Extract** of Data Ingestion (I4, file lookup interface)                                  |
| Sidecar HTTP read API inside the Frontend                                                | Direct access to raw stores                                  | **Query Service** (document content)                                             |
| Per-source queues, reservation cleaners and change signals re-implemented in each module | Duplicated ingestion infrastructure                          | **Data Ingestion**: Ingestion Control (I9), Normalize & Link persistence (I8), S1 |
| LLM description generation (`scripts/aprasyti*.js`) writes `eppsViesiejiPirkimai."aprasymai"`                                  | AI enrichment mixed with ingestion; writes a source schema                | **S3 AI Enrichment** (AI enrichment store)                                                 |
| `export:*`, `push:*` scripts inside source modules                                       | Distribution mixed with ingestion                            | **S4 Open Data Publishing**                                                      |
| MCP tool-call logging to the database and Quickwit                                       | Consumer writes data                                         | **S6 Observability**                                                             |
| Info banner table created and edited through the Frontend                                | Runtime DDL, no admin UI                                     | **S9 Operations Console**, S7 migrations                                         |
| `modules/risk` run manually via `npm run risk:run`                                       | Core component without scheduling                            | **Procurement Risk Service**, scheduled through S1, triggered by "facts changed" |
| 115 self-executing files and 87 files with `process.exit` in `modules/`                     | CLI entry points inside library code                         | Ingestion commands via **S9** / **S7** tooling                                   |
| Entity resolution in page services: `src/lib/sutartisPirkimai.ts`, `loadPpaSutarciuAtitikmenys()` in `src/lib/ppa.ts` | Links are computed per request and never stored (review D5)  | **Normalize & Link** (I7), `ods` link tables (§8.5)                              |
| `VPM_SUTARTIS_ROW_SQL` rebuilds contract rows for pages, Quickwit and exports            | Consumers depend on the shape of a dropped table (review D9) | `ods."sutartys"` (§8.4), written by **Normalize & Link**                         |
| `ensureAnalystViews()` creates the `v_*` views at runtime                                | Views drift from the schema; no migration (review D10)       | `ods` views and derived tables (§8.6), **S7** migrations                         |
| Buyer–supplier aggregate in `"vpmSutartys"."sumosPirkejasTiekejas"` and `v_pirkejo_tiekejo_rysys` | Two definitions of one concept (review D12)          | `ods."pirkejuTiekejuRysiai"` (§8.6)                                              |

---

## 6. Monorepo structure (npm workspaces)

The repository stays a single GitHub monorepo, organised with **npm workspaces**. Each workspace is one functional
component from §1–3. Its build, test and run commands, its dependencies and its configuration belong to that workspace
alone.

### 6.1 Design principles

1. **Workspace = functional component.** Each core component and each supporting component of §3 has one primary
   workspace (§6.3). A supporting component that a core component owns is a top-level folder in the workspace of that
   core component, for example `apps/ingestion/src/extract/`. Shared
   technical packages (`domain`, `events`, `search`, `storage`, `testing`) serve several components. S8 lives in
   `infra/backup/`, which is not a workspace.
2. **Two kinds of workspaces.**
    - `apps/*` are **deployable**: they have an entrypoint, a config schema, a Dockerfile and runtime dependencies.
    - `packages/*` are **libraries**: no process, no environment reading, no `process.exit`.
3. **Dependencies point inward only.** Apps depend on packages. Packages never import apps. Apps never import other
   apps; they communicate through database contracts, events or HTTP.
4. **Imports go through declared dependencies and each package's `exports` entry.** Deep imports
   (`@viespirkiai/query/src/…`) are forbidden.
5. **Plain npm workspaces, no extra monorepo tool.**
    - Node 24 runs TypeScript directly (built-in type stripping); `tsc -b` only type-checks.
    - Only the Astro app has a real build step.
    - Add Turborepo later only if CI time becomes a problem.
6. **Configuration per app.** Each app declares its own zod schema and `.env.example`. Packages receive settings as
   parameters. There is no global `CONFIG`.
7. **Strict TypeScript everywhere.** New code is TypeScript; existing JavaScript is converted when its module moves into
   a workspace.
8. **Create a package only when it is shared.** Code used by one workspace stays inside it; for example, the design
   system stays in `apps/web`. A package exists only for a functional component or for code used by two or more
   workspaces.
9. **Versioned agent instructions.** A root `AGENTS.md`, plus a short `AGENTS.md` per workspace stating its
   responsibility, allowed dependencies and commands (review P8).

### 6.2 Repository tree

```text
viespirkiai/
├── package.json                    # private root: workspaces ["apps/*", "packages/*"], orchestration scripts only
├── package-lock.json               # one lockfile for the whole repository
├── tsconfig.base.json              # strict · module "nodenext" · erasableSyntaxOnly · verbatimModuleSyntax
├── tsconfig.json                   # project references to every workspace (tsc -b)
├── eslint.config.js                # flat config: import hygiene, no process.env outside config.ts
├── .dependency-cruiser.cjs         # architecture rules from §6.4, enforced in CI
├── .node-version                   # 24
├── .editorconfig
├── AGENTS.md                       # repository-wide agent instructions (versioned)
├── README.md
│
├── .github/
│   ├── workflows/                  # see §7.4
│   │   ├── ci.yml                  # PR gate: install → lint → typecheck → boundaries → unit tests → build → audit → hadolint
│   │   └── delivery.yml            # main: ci → build changed images → tag all images sha-<commit> → move pointer main
│   ├── dependabot.yml
│   └── CODEOWNERS                  # owners per workspace and per migration folder
│
├── apps/                           # ── deployable functional components ──
│   │
│   ├── web/                        # «core» Frontend · @viespirkiai/web (Astro SSR)
│   │   ├── package.json
│   │   ├── AGENTS.md
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   ├── astro.config.ts
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── config.ts           # web-only config schema
│   │   │   ├── middleware.ts
│   │   │   ├── pages/              # routes: use @viespirkiai/query only, never SQL
│   │   │   ├── components/
│   │   │   ├── design-system/
│   │   │   └── client/             # browser bundles (relationship graph)
│   │   └── test/
│   │
│   ├── mcp/                        # «core» MCP · @viespirkiai/mcp
│   │   ├── package.json
│   │   ├── AGENTS.md
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   ├── src/
│   │   │   ├── main.ts             # HTTP entrypoint (Streamable HTTP transport)
│   │   │   ├── config.ts
│   │   │   ├── server.ts
│   │   │   └── tools/              # one file per tool, built on @viespirkiai/query
│   │   └── test/
│   │
│   ├── ingestion/                  # «core» Data Ingestion · @viespirkiai/ingestion
│   │   ├── package.json
│   │   ├── AGENTS.md
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   ├── src/
│   │   │   ├── worker.ts           # entrypoint: Extract and Normalize & Link workers, schedules
│   │   │   ├── api.ts              # entrypoint: OCR work distribution and file lookup (HTTP)
│   │   │   ├── config.ts
│   │   │   ├── control/            # I9 schedules, backfills, freshness status
│   │   │   ├── extract/            # «supporting» Extract: upstream sources → source schemas, document content
│   │   │   │   ├── connectors/     # I1 · one folder per source
│   │   │   │   │   ├── cvp-is/
│   │   │   │   │   ├── ted/
│   │   │   │   │   ├── jar/
│   │   │   │   │   ├── liteko/
│   │   │   │   │   ├── e-tar/
│   │   │   │   │   └── …
│   │   │   │   ├── gateway/        # I2 Source Gateway: proxies, Tor, rate limits, request log
│   │   │   │   ├── raw-store/      # I3 raw payload retention
│   │   │   │   └── documents/      # I4 download, storage boxes, extraction, OCR distribution, file lookup
│   │   │   └── normalize-link/     # «supporting» Normalize & Link: source schemas → ods
│   │   │       ├── mappers/        # I5 · one source-to-canonical mapper per source
│   │   │       ├── reference-data/ # I6
│   │   │       ├── entity-resolution/ # I7
│   │   │       └── persistence/    # I8 idempotent upserts, versions, derived tables, facts changed
│   │   └── test/
│   │
│   ├── risk/                       # «core» Procurement Risk Service · @viespirkiai/risk
│   │   ├── package.json
│   │   ├── AGENTS.md
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   ├── src/
│   │   │   ├── main.ts             # scheduled or event-triggered evaluation run
│   │   │   ├── config.ts
│   │   │   ├── engine/             # run orchestration, decision writer
│   │   │   └── indicators/         # one folder per indicator (LT-COM-01 …) with fixtures and tests
│   │   └── test/
│   │
│   ├── indexer/                    # «supporting» S2 Search Indexing · @viespirkiai/indexer
│   ├── enrichment/                 # «supporting» S3 AI Enrichment · @viespirkiai/enrichment
│   ├── open-data/                  # «supporting» S4 Open Data Publishing · @viespirkiai/open-data
│   └── ops/                        # «supporting» S9 Operations Console · @viespirkiai/ops
│       ├── package.json            # "bin": { "vp": "./src/cli.ts" }
│       └── src/
│           ├── cli.ts              # vp ingestion run|backfill|requeue · vp db migrate · vp backup verify
│           └── commands/
│
├── packages/                       # ── libraries: no entrypoints, no env reading, no process.exit ──
│   │
│   ├── query/                      # «core» Query Service · @viespirkiai/query
│   │   ├── package.json            # "exports": { ".": "./src/index.ts" }
│   │   ├── AGENTS.md
│   │   ├── src/
│   │   │   ├── index.ts            # the published query contract
│   │   │   ├── entities/           # procurement, contract, organisation, person, document, legal act, court case
│   │   │   ├── search/             # search and facets (search indexes + PostgreSQL fallback)
│   │   │   ├── relationships/
│   │   │   ├── documents/          # extracted text, OCR results, file references
│   │   │   ├── risk/               # risk results
│   │   │   ├── analytics/          # set-based, streamed reads for Risk and Open Data
│   │   │   └── analyst-sql/        # bounded ad-hoc SQL
│   │   └── test/
│   │
│   ├── domain/                     # canonical model: entity types, identifiers, Money, dates
│   ├── database/                   # «supporting» S7 Schema & Data Governance
│   │   ├── src/                    # role-scoped pools: readOnly · analyst · factsWriter · riskWriter · migrator (§6.6)
│   │   ├── migrations/
│   │   │   ├── source/             # source schemas, owned by apps/ingestion
│   │   │   ├── ods/                # Operational Data Store, owned by apps/ingestion
│   │   │   ├── risk/               # owned by apps/risk
│   │   │   └── control/            # infra · auth · jobs
│   │   └── schema/                 # generated schema documentation (committed)
│   ├── jobs/                       # «supporting» S1 Job Orchestration: queues, schedules, retries
│   ├── events/                     # "facts changed" event contracts + transport (NATS)
│   ├── search/                     # Quickwit and Typesense clients, index definitions
│   ├── storage/                    # file store, document content, raw payload stores
│   ├── auth/                       # «supporting» S5 Identity & Access: API keys, rate limiting
│   ├── config/                     # «supporting» S10 typed env loader (zod) used by every app's config.ts
│   ├── observability/              # «supporting» S6 structured logging, metrics, health checks
│   └── testing/                    # fixtures, test database (Testcontainers), fakes
│
├── infra/                          # ── how it runs; no application code, not a workspace ──
│   ├── ci/
│   │   ├── images.json             # image name → Dockerfile, target, workspace (§7.4)
│   │   ├── affected-images.ts      # changed paths + workspace graph → images to build
│   │   └── it.Dockerfile           # integration test image: sources, devDependencies, *.it.ts suites (§7.4)
│   ├── compose/                    # see §7.6
│   │   ├── viespirkiai-business-compose.yaml  # long-running apps of §6.3 · migrate; images by digest; alpha and production
│   │   ├── viespirkiai-data-compose.yaml      # PostgreSQL · PgBouncer · Quickwit · Typesense · NATS; alpha and production
│   │   ├── dev.yaml                # local development services
│   │   └── env/
│   │       ├── alpha.env           # non-secret alpha values
│   │       └── prod.env            # non-secret production values
│   ├── deploy/                     # vp-deploy agent + systemd timer for lempa (§7.5)
│   ├── cloudflared/                # tunnel ingress: viespirkiai.org, alpha.viespirkiai.org
│   ├── postgres/                   # image (PostGIS, pg_repack) and configuration
│   ├── pgbouncer/
│   ├── quickwit/
│   ├── typesense/
│   └── backup/                     # «supporting» S8 Backup & Recovery: scripts and restore runbook
│
└── docs/
    ├── architecture/
    ├── adr/                        # architecture decision records
    └── runbooks/
```

### 6.3 Workspace to functional component map

| Workspace                | Package                      | Functional component                       | Runs as                                 | Moves from (today)                                                                           |
|--------------------------|------------------------------|--------------------------------------------|-----------------------------------------|----------------------------------------------------------------------------------------------|
| `apps/web`               | `@viespirkiai/web`           | «core» Frontend                            | `astro build` → Node server             | `src/`, `start-server.mjs`, `astro.config.mjs`                                               |
| `apps/mcp`               | `@viespirkiai/mcp`           | «core» MCP                                 | `node src/main.ts`                      | `modules/mcp/`, `src/pages/mcp.astro`, `src/lib/mcp.ts`                                      |
| `apps/ingestion`         | `@viespirkiai/ingestion`     | «core» Data Ingestion: Extract, Normalize & Link | `node src/worker.ts`, `node src/api.ts` | `tasks/`, `modules/<source>/`, `modules/failai/`, `modules/documents/`, OCR endpoints, matching logic in `src/lib/sutartisPirkimai.ts` and `src/lib/ppa.ts`        |
| `apps/risk`              | `@viespirkiai/risk`          | «core» Procurement Risk Service            | `node src/main.ts` (scheduled)          | `modules/risk/`, `services/procurement-risk/`                                                |
| `apps/indexer`           | `@viespirkiai/indexer`       | S2 Search Indexing                         | `node src/main.ts`                      | `quickwit/`, `modules/*/quickwitProcessIndexQueue.js`, `modules/juridiniai/typesense*`, `modules/searchSuggestion/` |
| `apps/enrichment`        | `@viespirkiai/enrichment`    | S3 AI Enrichment                           | `node src/main.ts`                      | `modules/openrouter/`, `modules/vector/`, `scripts/aprasyti*.js`                             |
| `apps/open-data`         | `@viespirkiai/open-data`     | S4 Open Data Publishing                    | `node src/main.ts`                      | `modules/spinta/`, `modules/*/pushToSpinta.js`, `export:*` scripts, export WebSocket         |
| `apps/ops`               | `@viespirkiai/ops`           | S9 Operations Console                      | `vp <command>`                          | about 80 `npm run` scripts, `scripts/`                                                       |
| `packages/query`         | `@viespirkiai/query`         | «core» Query Service                       | library                                 | `src/lib/*`, SQL in pages, `modules/*/search*.js`, `modules/rysiai/`, `modules/mcp/analyst/` |
| `packages/domain`        | `@viespirkiai/domain`        | Canonical model (I5)                       | library                                 | new                                                                                          |
| `packages/database`      | `@viespirkiai/database`      | S7 Schema & Data Governance                | library + migrations                    | `postgres/`, `migrations/`, `dbSchema/`                                                      |
| `packages/jobs`          | `@viespirkiai/jobs`          | S1 Job Orchestration                       | library                                 | `runner/`, per-module queues                                                                 |
| `packages/events`        | `@viespirkiai/events`        | "Facts changed" contract                   | library                                 | `utils/natsHub.js`, `utils/taskSignals.js`                                                   |
| `packages/search`        | `@viespirkiai/search`        | Search clients (used by query and indexer) | library                                 | `quickwit/quickwit.js`, `typesense/`                                                         |
| `packages/storage`       | `@viespirkiai/storage`       | Document and raw payload stores            | library                                 | `utils/sidecar*.js`, `modules/failai/failaiFs.js`, `modules/ocr/rezultataiFs.js`             |
| `packages/auth`          | `@viespirkiai/auth`          | S5 Identity & Access                       | library                                 | `modules/failai/auth.js`, `src/lib/botChallenge.ts`                                          |
| `packages/config`        | `@viespirkiai/config`        | S10 Configuration & Secrets                | library                                 | `utils/config*.js`                                                                           |
| `packages/observability` | `@viespirkiai/observability` | S6 Observability                           | library                                 | `utils/log.js`, SQL and scrape log ingest, metrics                                           |
| `packages/testing`       | `@viespirkiai/testing`       | Test support                               | dev library                             | `test/mocks/`                                                                                |
| `infra/backup`           | —                            | S8 Backup & Recovery                       | scripts, runbook                        | `modules/s3backup/` + new database backups                                                   |

### 6.4 Workspace dependency rules

```mermaid
flowchart TB
    classDef app fill: #dbe9fb, stroke: #1f5fa8, stroke-width: 2px, color: #0b2545
    classDef supapp fill: #f5f9ff, stroke: #1f5fa8, stroke-dasharray: 3 2, color: #0b2545
    classDef pkg fill: #eef7ee, stroke: #2e7d32, color: #123d14
    classDef xcut fill: #fafafa, stroke: #888, stroke-dasharray: 3 2, color: #333

    subgraph APPS["apps/* (deployable)"]
        web["web"]:::app
        mcp["mcp"]:::app
        risk["risk"]:::app
        ingestion["ingestion"]:::app
        opendata["open-data"]:::supapp
        enrichment["enrichment"]:::supapp
        indexer["indexer"]:::supapp
        ops["ops"]:::supapp
    end

    subgraph PKGS["packages/* (libraries)"]
        query["query"]:::pkg
        domain["domain"]:::pkg
        database["database"]:::pkg
        search["search"]:::pkg
        storage["storage"]:::pkg
        jobs["jobs"]:::pkg
        events["events"]:::pkg
        auth["auth"]:::pkg
    end

    xc["config · observability · testing<br/>(allowed everywhere)"]:::xcut
    web --> query
    web --> auth
    mcp --> query
    mcp --> auth
    risk --> query
    risk --> database
    risk --> jobs
    risk --> events
    opendata --> query
    opendata --> jobs
    enrichment --> query
    enrichment --> jobs
    ingestion --> domain
    ingestion --> database
    ingestion --> storage
    ingestion --> jobs
    ingestion --> events
    ingestion --> auth
    indexer --> database
    indexer --> search
    indexer --> storage
    indexer --> jobs
    indexer --> events
    ops --> database
    ops --> jobs
    query --> domain
    query --> database
    query --> search
    query --> storage
    jobs --> database
```

Solid arrows are allowed dependencies. Any dependency not drawn is forbidden. `config`, `observability` and `testing` are
cross-cutting and may be used by every workspace.

| Rule                                                                                                                   | Enforced by                                                                                     |
|------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `apps/*` import only `packages/*`; never another app                                                                   | dependency-cruiser in CI                                                                        |
| `packages/*` never import `apps/*`                                                                                     | dependency-cruiser in CI                                                                        |
| `web`, `mcp`, `open-data`, `enrichment` read data **only through `query`**: no `database` dependency                   | dependency-cruiser + `package.json` review (CODEOWNERS)                                         |
| Only `ingestion` imports `@viespirkiai/database/facts-writer`; only `risk` imports `@viespirkiai/database/risk-writer` | Per-role `exports` entries + dependency-cruiser + **PostgreSQL role grants** (defence in depth) |
| Inside `ingestion`, `src/extract/**` and `src/normalize-link/**` never import each other; they meet only at the source schemas | dependency-cruiser in CI                                                                        |
| No deep imports; only paths listed in `exports`                                                                        | Node `exports` resolution + ESLint                                                              |
| Every import is a declared dependency (npm hoisting would otherwise hide mistakes)                                     | ESLint `import/no-extraneous-dependencies` or `knip`                                            |
| No `process.env` outside an app's `src/config.ts`; no `process.exit` or top-level side effects in packages             | ESLint (`n/no-process-env`, custom rule)                                                        |

### 6.5 Commands

**Root `package.json`**, which orchestrates only:

```json
{
  "name": "viespirkiai",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:web": "npm run dev -w @viespirkiai/web",
    "dev:mcp": "npm run dev -w @viespirkiai/mcp",
    "build": "npm run build --workspaces --if-present",
    "typecheck": "tsc -b && npm run typecheck -w @viespirkiai/web",
    "lint": "eslint .",
    "boundaries": "depcruise apps packages",
    "test": "npm run test --workspaces --if-present",
    "test:integration": "npm run test:integration --workspaces --if-present",
    "check": "npm run lint && npm run typecheck && npm run boundaries && npm test"
  }
}
```

The `typecheck` script of `apps/web` runs `astro check`, because `tsc` does not check `.astro` files.

**A workspace `package.json`** (`apps/mcp`):

```json
{
  "name": "@viespirkiai/mcp",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch --env-file=.env src/main.ts",
    "start": "node src/main.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@viespirkiai/query": "*",
    "@viespirkiai/auth": "*",
    "@viespirkiai/config": "*",
    "@viespirkiai/observability": "*",
    "@modelcontextprotocol/server": "^2.0.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@viespirkiai/testing": "*"
  }
}
```

**A library `package.json`** (`packages/query`):

```json
{
  "name": "@viespirkiai/query",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@viespirkiai/domain": "*",
    "@viespirkiai/database": "*",
    "@viespirkiai/search": "*",
    "@viespirkiai/storage": "*"
  }
}
```

Typical workflows:

| Task                                           | Command                                                       |
|------------------------------------------------|---------------------------------------------------------------|
| Run the website locally                        | `npm run dev:web`                                             |
| Test only the Query Service                    | `npm test -w @viespirkiai/query`                              |
| Add a dependency to MCP only                   | `npm install <pkg> -w @viespirkiai/mcp`                       |
| Build the MCP image with only its dependencies | `npm ci -w @viespirkiai/mcp` inside `apps/mcp/Dockerfile` (build context: repository root)     |
| Run a backfill                                 | `npx vp ingestion backfill --source cvp-is --from 2024-01-01` |
| Apply migrations                               | `npx vp db migrate`                                           |
| Local gate (CI stage 1 without build, audit and Dockerfile lint) | `npm run check`                                               |

### 6.6 Configuration separation

| Level        | Where                              | Contains                                                                                       |
|--------------|------------------------------------|------------------------------------------------------------------------------------------------|
| App schema   | `apps/<app>/src/config.ts`         | zod schema of **only** the variables that app needs; the only place `process.env` is read      |
| App template | `apps/<app>/.env.example`          | documented defaults for local development; replaces `ENV.md`, `config.sample.js` and `.env.sample` |
| Packages     | constructor or function parameters | no environment access; the app passes typed settings in                                        |
| Runtime      | `infra/compose/*-compose.yaml`, `env/<env>.env`       | environment per service; secrets from `/srv/viespirkiai/<env>/secrets/<app>.env` on `lempa`, never committed                      |

Database access is split by **role-specific connection strings**, so each app can only receive the credentials it is
allowed to use:

| App                              | Database connection variables                       |
|----------------------------------|-----------------------------------------------------|
| `web`, `open-data`, `enrichment` | `DATABASE_URL_READONLY`                             |
| `mcp`                            | `DATABASE_URL_READONLY`, `DATABASE_URL_ANALYST`     |
| `risk`                           | `DATABASE_URL_READONLY`, `DATABASE_URL_RISK_WRITER` |
| `ingestion`                      | `DATABASE_URL_FACTS_WRITER`                         |
| `indexer`                        | `DATABASE_URL_READONLY`                             |
| `ops`                            | `DATABASE_URL_MIGRATOR`                             |
| `it` image (§7.5)                | `DATABASE_URL_READONLY`                             |

The roles that write job state and control schemas are open (§9 Q6).

---

## 7. CI/CD pipeline

### 7.1 Assessment of the current pipeline

Source: [`architecture-current.md` §5.4](architecture-current.md#54-cicd-pipeline) and
`.github/workflows/build-image.yml`.

**What is worth keeping**

| Practice                                                                                                 | Why it is right                                                                    |
|----------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| **GHCR** as the registry, authenticated with the ephemeral `GITHUB_TOKEN`                                | No long-lived registry secret; the image sits next to the code and its permissions |
| **Immutable commit tags** (`sha-<full>`, `sha-<short>`) from `docker/metadata-action`                    | Every image can be traced to exactly one commit                                    |
| **Multi-stage `Dockerfile`** (`deps` → `builder` → `runtime`), production-only `node_modules`            | Small runtime image without dev tooling                                            |
| **BuildKit with the GitHub Actions cache** (`type=gha`)                                                  | Fast rebuilds                                                                      |
| **Commit baked into the image** (`GIT_COMMIT` → `build-info.json`)                                       | The running version is visible in the footer                                       |
| **Secrets kept out of the build context** (`.dockerignore` excludes `config.js`, `.env*`, `compose.yml`) | The image can be public                                                            |

**Gaps**

| #   | Gap                                                                                                                                                                                                     | Consequence                                                                                                               | Review  |
|-----|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|---------|
| C1  | **No quality gate.** Tests, `astro check` and lint never run; there is no `pull_request` trigger.                                                                                                       | A broken commit is still built and pushed as `latest`.                                                                    | P2      |
| C2  | **Build without a consumer.** No tracked file uses the published image; every tracked compose file builds locally. `architecture-current.md` §5.4 marks the live state on `lempa` as unconfirmed.                                                                                           | Two artifacts, no single source of truth; the CI image is never exercised.                                                | P2      |
| C3  | **The image is not self-contained.** `./modules` and `./public` are bind-mounted from the host.                                                                                                         | The same image digest can run different code. Promoting an image between environments is meaningless until this is fixed. | P2      |
| C4  | **Only the frontend is packaged.** The taskRunner runs as bare Node under `startTaskRunner.sh`; CLI jobs run from the checkout.                                                                         | Web and background processes can run different versions of the same modules.                                              | P2, P12 |
| C5  | **Mutable tags are the only readable tags.** `latest` and `main` are overwritten on every push; no `v*` tag has ever been created.                                                                      | No releases, no rollback target, no answer to "what is in production?"                                                    | P2      |
| C6  | **No deployment definition.** No deploy job, no environments, no approvals, no health checks, no rollback. The production `compose.yml` is git-ignored.                                                 | Deployment is a manual, unrecorded procedure.                                                                             | P2, P4  |
| C7  | **Integration tests don't gate anything.** The `*.it.ts` suites read `config.js` and need a live, pre-populated database.                                                                               | They don't run automatically and can't gate a release.                                                                    | P2      |
| C8  | **No database migration step.** `migrations/` is incomplete and there is no runner; tables are also created at runtime.                                                                                 | Schema changes can't be deployed or rolled back safely.                                                                   | P1, P11 |
| C9  | **No supply-chain controls.** Actions are pinned to major versions rather than commit SHAs; no image scan, no SBOM, no provenance attestation. `npm audit` shows 1 critical and 5 high vulnerabilities. | Vulnerabilities and tampered dependencies ship unnoticed.                                                                 | P3      |
| C10 | **`cancel-in-progress: true` for every ref.**                                                                                                                                                           | A new push can cancel a publish halfway, leaving a partial set of images.                                                 | —       |

**Conclusion.** The pipeline stops at *build and push*. The target pipeline keeps the good build practices, but puts a
gate in front of the push and an integration stage and controlled deployments behind it. Before *build once, promote the
same image* can mean anything, the image must be self-contained (C3) and the taskRunner must be packaged (C4).

### 7.2 Design principles

1. **Build once, promote the same digest.** CI builds an image only for a commit that changes the inputs of that image.
   Integration tests, alpha and production run that same digest.
2. **Deploy by digest.** Compose files reference `image@sha256:…`. Every commit that `delivery.yml` publishes has the
   tag `sha-<commit>` on every image. CI moves one pointer tag, `main`, for discovery only. CI does not publish `latest`.
3. **GitHub Actions verifies and publishes.** Lint, type-check, unit tests and build pass before an image reaches
   `ghcr.io`. Unit tests use mocks only: no network, no database.
4. **lempa pulls. Nothing pushes into lempa.** lempa needs no inbound port, no GitHub runner and no GitHub write
   credentials.
5. **Integration tests are read-only and run on the real database** of the target environment, with a read-only role.
   They run before every rollout and on demand at any time.
6. **Alpha deploys automatically. Production deploys only by an operator command on lempa**, and only a release that
   passed alpha.
7. **Alpha and production use the same compose files.** They differ only in their env files.
8. **Migrations are expand/contract.** The previous app version works on the new schema, so an app rollback needs no
   database rollback.
9. **No self-hosted GitHub Actions runner.** The repository is public, so a pull request from a fork can run code on a
   self-hosted runner.
10. **lempa verifies provenance.** `vp-deploy` verifies the image provenance attestation with `cosign` before it pulls
    an image.

### 7.3 Pipeline overview

GitHub Actions runs unit tests, builds and publishes. The `vp-deploy` agent on lempa pulls images, runs integration tests
and deploys.

```mermaid
flowchart LR
    Contributor(["Contributor"])
    Operator(["Operator"])

    subgraph gha["GitHub Actions"]
        ci["ci.yml: lint, type-check, unit tests, build"]
        delivery["delivery.yml: ci.yml, build changed images, tag all images"]
    end

    ghcr[("ghcr.io")]

    subgraph lempa["lempa"]
        timer["vp-deploy-watch.timer"]
        watch["vp-deploy watch"]
        subgraph alphaenv["alpha environment"]
            alphadeploy["vp-deploy alpha"]
            alphait["it image: integration tests"]
            alphaapps["alpha.viespirkiai.org"]
        end
        subgraph prodenv["production environment"]
            proddeploy["vp-deploy prod"]
            prodit["it image: integration tests"]
            prodapps["viespirkiai.org"]
        end
        ods[("PostgreSQL ods (§8.2), one instance")]
    end

    Contributor -->|pull request| ci
    Contributor -->|merge to main| delivery
    delivery -.->|" images sha-#lt;commit#gt;, pointer main "| ghcr
    timer -->|every 2 min| watch
    watch -->|reads pointer main| ghcr
    watch -->|new commit| alphadeploy
    ghcr -.->|images by digest| alphadeploy
    alphadeploy -->|runs before rollout| alphait
    alphait -->|reads with read-only role| ods
    alphadeploy -->|compose up after tests pass| alphaapps
    Operator -->|ssh lempa, release with status alpha-passed| proddeploy
    ghcr -.->|images by digest| proddeploy
    proddeploy -->|runs before rollout| prodit
    prodit -->|reads with read-only role| ods
    proddeploy -->|compose up after tests pass| prodapps
```

| # | Stage             | Runs on                                    | Trigger                                      | Result                                                          |
|---|-------------------|--------------------------------------------|----------------------------------------------|-----------------------------------------------------------------|
| 1 | Verify            | GitHub Actions `ci.yml`                    | every pull request; reused by `delivery.yml` | lint, type-check, boundaries, unit tests and build pass         |
| 2 | Publish           | GitHub Actions `delivery.yml`              | push to `main`, after stage 1                | changed images built; all images tagged `sha-<commit>`; pointer `main` |
| 3 | Detect            | lempa `vp-deploy watch`                    | systemd timer, every 2 minutes               | release directory for the new commit                            |
| 4 | Deploy alpha      | lempa, compose project `vp-alpha-business` | new commit detected, **automatic**           | release status `alpha-passed` or `failed`                       |
| 5 | Deploy production | lempa, compose project `vp-prod-business`  | `vp-deploy prod`, **manual**                 | release status `prod-deployed` or `failed`                      |

| Test kind         | Runs in                                 | Reads                                        | Side effects                                   |
|-------------------|-----------------------------------------|----------------------------------------------|------------------------------------------------|
| Unit tests        | GitHub Actions, stage 1                 | mocks and fixtures only                      | none; no network, no database                  |
| Integration tests | lempa, `it` image, stages 4 and 5 (§7.5) | the one `ods` instance and search indexes (§9 Q1)    | none; read-only role, search-only keys         |

A release moves through these states:

```mermaid
stateDiagram-v2
    [*] --> published: delivery.yml moves pointer main
    published --> alpha_passed: migrations, integration tests and smoke tests pass on alpha
    published --> failed: a deployment step fails on alpha
    alpha_passed --> prod_deployed: operator runs vp-deploy prod and all steps pass
    alpha_passed --> failed: a deployment step fails on production
    prod_deployed --> [*]
    failed --> [*]
```

### 7.4 GitHub Actions: verify and publish

**Stage 1 — Verify** (`ci.yml`):

| Check            | Command                                             | Blocks merge                           |
|------------------|-----------------------------------------------------|----------------------------------------|
| Install          | `npm ci`                                            | yes                                    |
| Lint             | `npm run lint`                                      | yes                                    |
| Type-check       | `npm run typecheck` (`tsc -b`, `astro check`)       | yes                                    |
| Boundaries       | `npm run boundaries`                                | yes                                    |
| Unit tests       | `npm test` (no network, no database)                | yes                                    |
| Build            | `npm run build`; `docker buildx build` without push | yes                                    |
| Dependency audit | `npm audit --omit=dev --audit-level=high`           | yes                                    |
| Dockerfile lint  | `hadolint`                                          | yes                                    |

**Stage 2 — Publish** (`delivery.yml`, push to `main` only):

1. Run `ci.yml` as a reusable workflow. The unit tests run again on the merged commit.
2. Detect the changed images with `infra/ci/affected-images.ts`.
3. Build and push each changed image with the tag `sha-<full commit>`.
4. Generate an SBOM and a provenance attestation for each built image.
5. Scan each built image with Trivy. `CRITICAL` findings block the publish.
6. Tag each unchanged image: add `sha-<full commit>` to the digest of `sha-<base commit>`. This is a registry operation
   (`docker buildx imagetools create`), without a build.
7. **Move the pointer tag `main`** on every image to the new digests. This step runs last, so lempa never sees a partial
   release.

The images are the eight apps of §6.3 (`ops` included) and the `it` test image.

#### `delivery.yml` builds only the changed images

`delivery.yml` selects the images to build from the paths changed since the last successful publish:

```mermaid
flowchart TD
    run["gh run list: last successful delivery.yml run on main"] -->|run list| found{"run found?"}
    found -->|no| all["select all images"]
    found -->|"yes: base commit"| diff["git diff --name-only base..HEAD"]
    diff -->|changed paths| match["affected-images.ts: match paths to image inputs"]
    match -->|changed images| build["build, attest, scan, push sha-#lt;commit#gt;"]
    match -->|unchanged images| retag["imagetools create: sha-#lt;base#gt; digest as sha-#lt;commit#gt;"]
    all -->|all images| build
    build -->|digests| pointer["move pointer main on every image"]
    retag -->|digests| pointer
```

`infra/ci/images.json` declares each image. `affected-images.ts` resolves the image inputs from the workspace graph:

| Image                                         | Inputs                                                                                                        |
|-----------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `web`, `mcp`, `ingestion`, `risk`, supporting apps | `apps/<app>/**` and every workspace in its transitive `@viespirkiai/*` `dependencies` (§6.4)             |
| `ops`                                         | `apps/ops/**` and its transitive workspace dependencies, which include `packages/database/migrations/**`      |
| `it`                                          | `apps/**`, `packages/**`                                                                                      |
| All images                                    | `package.json`, `package-lock.json`, `tsconfig.base.json`, `.node-version`, `infra/ci/**`                     |

| Rule                                                                                                   | Effect                                                                                     |
|--------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| The base commit is the last **successful** run, not `HEAD^`                                            | Changes from cancelled or failed runs are included in the next build                       |
| Every image gets `sha-<commit>` on every commit                                                        | `vp-deploy` resolves a complete `manifest.env` for any commit, without knowing what changed |
| An unchanged image keeps its digest                                                                    | `compose up` does not recreate its containers                                              |
| A change in `infra/compose/**` or `infra/deploy/**` builds no image, but still creates a release       | Compose and deploy changes deploy through alpha like code changes                          |
| `push` has `paths-ignore: ['docs/**', '**/*.md']`                                                      | Documentation changes create no release                                                    |
| `workflow_dispatch` input `all-images: true` selects all images                                        | An operator rebuilds everything, for example to pick up a patched base image              |

Workflow settings:

- `concurrency: { group: delivery, cancel-in-progress: true }`. A newer push cancels an older run. A cancelled run is
  not a successful run, so the next run takes the changes of the cancelled commit into its diff.
- Minimal `permissions:` per job. `GITHUB_TOKEN` is the only credential.
- Actions are pinned by commit SHA. Dependabot updates them.

`infra/ci/it.Dockerfile` builds the `it` image. It contains the source, `devDependencies` and the `*.it.ts` suites, so
lempa runs tests without a checkout.

### 7.5 Deploy agent `vp-deploy` on lempa

| Element                              | Location                                                        | Responsibility                                                                    |
|--------------------------------------|-----------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `vp-deploy`                          | `infra/deploy/vp-deploy` (bash), installed to `/usr/local/bin/` | Commands `watch`, `it`, `alpha`, `prod`, `rollback`, `status`, `data`, `refresh-alpha-db` |
| `vp-deploy-watch.timer` + `.service` | `infra/deploy/systemd/`                                         | Runs `vp-deploy watch` every 2 minutes as user `deploy`                           |
| `deploy` user                        | lempa                                                           | Member of the `docker` group; owns `/srv/viespirkiai/`                            |
| Repository mirror                    | `/srv/viespirkiai/repo.git`                                     | Bare clone of the public repository; `git fetch` only                             |
| Release directories                  | `/srv/viespirkiai/releases/<commit>/`                           | `infra/` extracted at `<commit>`, `manifest.env`, `status`, test logs             |
| Environment state                    | `/srv/viespirkiai/{alpha,prod}/`                                | `current` and `previous` symlinks, `secrets/<app>.env`, `deployments.log`               |
| Lock                                 | `/srv/viespirkiai/deploy.lock`                                  | `flock`: one `vp-deploy` command at a time                                        |
| Notification                         | `NOTIFY_WEBHOOK_URL` in `/srv/viespirkiai/deploy.env`           | Message on every failure and every production deployment                          |

```text
/srv/viespirkiai/
├── deploy.env                     # NOTIFY_WEBHOOK_URL, poll settings
├── deploy.lock
├── repo.git/                      # bare mirror of github.com/racionalas/viespirkiai
├── releases/
│   └── <commit>/
│       ├── infra/                 # compose files, env files and scripts at <commit>
│       ├── manifest.env           # WEB_IMAGE=ghcr.io/racionalas/viespirkiai-web@sha256:… (one line per image)
│       ├── status                 # published · alpha-passed · prod-deployed · failed
│       └── logs/
├── alpha/
│   ├── current -> ../releases/<commit>
│   ├── previous -> ../releases/<commit>
│   ├── secrets/                   # one <app>.env per app and it.env; chmod 600, not in git
│   └── deployments.log
└── prod/                          # same layout as alpha/
```

`vp-deploy` uses only Docker, git, `curl`, `cosign` and `flock`. The images and the repository are public, so lempa needs no GitHub or GHCR
credentials.

#### `vp-deploy` deploys a release to an environment

`vp-deploy alpha <commit>` and `vp-deploy prod <commit>` run the same steps against their own environment.
`vp-deploy prod` first requires status `alpha-passed`, a typed short commit and a fresh database backup.

```mermaid
flowchart TD
    gate{"prod only: status alpha-passed, typed short commit, fresh backup"}
    fetch["extract infra/ at commit, resolve image digests"]
    verify{"cosign: verify provenance attestations"}
    pull["docker pull images by digest"]
    migrate{"run ops image: vp db migrate"}
    it{"run it image: npm run test:integration with read-only role"}
    abort["abort; release status unchanged"]
    stop["status failed, notify; running apps unchanged"]
    rollout{"point current to release, compose up -d --wait"}
    rollback["point current to previous, compose up -d --wait, status failed, notify"]
    smoke{"smoke tests"}
    record["status alpha-passed or prod-deployed, append deployments.log"]
    gate -->|" alpha, or all prod checks pass "| fetch
    gate -->|" a prod check fails "| abort
    fetch -->|manifest.env| verify
    verify -->|valid| pull
    verify -->|invalid| stop
    pull -->|images| migrate
    migrate -->|migrated schema| it
    migrate -->|fail| stop
    it -->|fail| stop
    it -->|pass| rollout
    rollout -->|unhealthy| rollback
    rollout -->|healthy| smoke
    smoke -->|fail| rollback
    smoke -->|pass| record
```

The integration tests run before rollout, so they test the new code against the migrated schema. The running apps keep
serving during the test run, because migrations are expand/contract.

#### Integration tests read the real database

| Rule                                                                     | Enforcement                                                                                     |
|--------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Tests only read: queries, views, search requests                         | PostgreSQL role from `DATABASE_URL_READONLY`: `SELECT` grants only, `default_transaction_read_only = on` |
| Tests use the data of the target environment                             | The `it` container joins network `vp-<env>-data`                                                |
| Search tests use read access only                                        | Typesense search-only API key; Quickwit search endpoints only (Quickwit has no API keys, so code review enforces it)                                   |
| Tests assert on structure and invariants, not on exact row counts or values | Code review of `*.it.ts`                                                                     |
| Tests run any number of times with the same effect                       | `vp-deploy it <env>` runs the suite against the running environment, without a deployment      |
| A test run has a time limit                                              | 15 minutes                                                                                      |

### 7.6 Compose files

The compose files are in the monorepo, in `infra/compose/`. lempa runs the copy in `releases/<commit>/infra/`, never a
live checkout. A compose change therefore deploys and rolls back with its release.

| File                                 | Contains                                                                              | Compose projects                | Applied by                                                     |
|--------------------------------------|---------------------------------------------------------------------------------------|---------------------------------|----------------------------------------------------------------|
| `viespirkiai-business-compose.yaml`  | `web`, `mcp`, `ingestion`, `ingestion-api`, `risk`, `indexer`, `enrichment`, `open-data`; `migrate` (profile `migrate`, `ops` image)                              | `vp-alpha-business`, `vp-prod-business` | `vp-deploy alpha` / `vp-deploy prod`, every release    |
| `viespirkiai-data-compose.yaml`      | `postgres`, `pgbouncer`, `quickwit`, `typesense`, `nats`, network `vp-<env>-data`     | `vp-alpha-data`, `vp-prod-data` | Operator, `vp-deploy data <env>`, only on data-service changes |
| `env/alpha.env`, `env/prod.env`      | Non-secret values per environment: ports, memory limits, data paths, feature switches | —                               | Committed                                                      |
| `/srv/viespirkiai/<env>/secrets/<app>.env` | Passwords, API keys and `DATABASE_URL_*` values of one app (§6.6)                                                                   | —                               | On lempa only                                                  |
| `releases/<commit>/manifest.env`     | Image digests                                                                         | —                               | Generated by `vp-deploy`                                       |

**One set of compose files, two env files.** Separate alpha and production compose files drift apart, and alpha then
stops testing what production runs. Structural differences go into env values; an override file is added only for a
difference that env values can't express.

**Data and business services are separate compose projects.** A business deployment never recreates PostgreSQL or the
search engines.

`vp-deploy` starts the business services with:

```bash
docker compose -p vp-alpha-business \
  -f releases/<commit>/infra/compose/viespirkiai-business-compose.yaml \
  --env-file releases/<commit>/infra/compose/env/alpha.env \
  --env-file releases/<commit>/manifest.env \
  up -d --wait --remove-orphans
```

`infra/compose/viespirkiai-business-compose.yaml` gives each app its own secrets file, so an app receives only the
credentials of §6.6. The listing shows `migrate`, `web`, `mcp` and `ingestion`. `ingestion-api`, `risk`, `indexer`,
`enrichment` and `open-data` follow the same pattern; the public routes of `ingestion-api` are open (§9 Q13).

```yaml
name: vp-${VP_ENV}-business

x-app: &app
  restart: unless-stopped
  networks: [ data ]
  logging:
    driver: json-file
    options: { max-size: 50m, max-file: "5" }

services:
  migrate:
    <<: *app
    image: ${OPS_IMAGE}
    env_file: [ ./env/${VP_ENV}.env, /srv/viespirkiai/${VP_ENV}/secrets/ops.env ]
    command: [ "vp", "db", "migrate" ]
    restart: "no"
    profiles: [ migrate ]

  web:
    <<: *app
    image: ${WEB_IMAGE}
    env_file: [ ./env/${VP_ENV}.env, /srv/viespirkiai/${VP_ENV}/secrets/web.env ]
    ports: [ "127.0.0.1:${WEB_PORT}:9019" ]
    volumes: [ "${DATA_ROOT}:/data" ]
    healthcheck:
      test: [ "CMD", "node", "-e", "fetch('http://localhost:9019/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s
    deploy:
      resources: { limits: { memory: "${WEB_MEMORY}" } }

  mcp:
    <<: *app
    image: ${MCP_IMAGE}
    env_file: [ ./env/${VP_ENV}.env, /srv/viespirkiai/${VP_ENV}/secrets/mcp.env ]
    ports: [ "127.0.0.1:${MCP_PORT}:9022" ]
    healthcheck:
      test: [ "CMD", "node", "-e", "fetch('http://localhost:9022/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ]
      interval: 15s
      timeout: 5s
      retries: 5
    deploy:
      resources: { limits: { memory: "${MCP_MEMORY}" } }

  ingestion:
    <<: *app
    image: ${INGESTION_IMAGE}
    env_file: [ ./env/${VP_ENV}.env, /srv/viespirkiai/${VP_ENV}/secrets/ingestion.env ]
    command: [ "node", "src/worker.ts" ]
    volumes: [ "${DATA_ROOT}:/data" ]
    stop_grace_period: 120s          # lets running jobs release their reservations
    deploy:
      resources: { limits: { memory: "${INGESTION_MEMORY}" } }

networks:
  data:
    external: true
    name: vp-${VP_ENV}-data          # created by viespirkiai-data-compose.yaml
```

`infra/compose/env/alpha.env`:

```bash
VP_ENV=alpha
PUBLIC_URL=https://alpha.viespirkiai.org
DATA_ROOT=/flashas/viespirkiai-alpha
WEB_PORT=9029
MCP_PORT=9032
WEB_MEMORY=1g
MCP_MEMORY=512m
INGESTION_MEMORY=1g
ROBOTS_NOINDEX=true
JOBS_ENABLED=quickwit-index,typesense-index,risk
SPINTA_PUSH_ENABLED=false
LLM_ENABLED=false
S3_BACKUP_ENABLED=false
```

`env/prod.env` has the same keys with production values: `WEB_PORT=9019`, `MCP_PORT=9022`,
`DATA_ROOT=/flashas/viespirkiai`, all jobs and side effects enabled.

**Alpha and production on lempa:**

| Aspect                                | alpha                                                                                             | production                                                             |
|---------------------------------------|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Compose projects                      | `vp-alpha-data`, `vp-alpha-business`                                                              | `vp-prod-data`, `vp-prod-business`                                     |
| Docker network                        | `vp-alpha-data` (bridge)                                                                          | `vp-prod-data` (bridge)                                                |
| Public hostname (cloudflared ingress) | `alpha.viespirkiai.org` → `127.0.0.1:9029`                                                        | `viespirkiai.org` → `127.0.0.1:9019`                                   |
| Data root                             | `/flashas/viespirkiai-alpha`                                                                      | `/flashas/viespirkiai`                                                 |
| PostgreSQL                            | Own instance, restored from the latest production backup by `vp-deploy refresh-alpha-db` (weekly; §9 Q1, Q10) | Primary, with off-site replica                                         |
| Search                                | Own single-node Quickwit and Typesense, rebuilt from the alpha database                           | Production Quickwit; Typesense cluster (host network for Raft peering; §9 Q14) |
| Jobs                                  | Only the jobs in `JOBS_ENABLED`; no upstream scraping                                             | All jobs                                                               |
| Outbound side effects                 | Off: Spinta push, S3 AI enrichment, file archive backup to S3 object storage                                               | On                                                                     |
| Search engine indexing                | `noindex`                                                                                         | Normal                                                                 |

- Apps reach data services by service name (`pgbouncer:6432`) over the bridge network, not over `localhost`. The
  `DATABASE_URL_*` values in `secrets/<app>.env` point at `pgbouncer:6432`.
- The cloudflared configuration is versioned in `infra/cloudflared/config.yml`.
- The weekly alpha database restore also serves as the tested restore that S8 Backup & Recovery requires.

---

## 8. Data layers: source schemas and the Operational Data Store

Input: [`architecture-review.md` P13](architecture-review.md#p13--no-operational-data-store-pages-and-tools-read-source-schemas-directly-)
and [`../indicators-story/domain-model.md`](../indicators-story/domain-model.md). This section defines guarantee G2
(canonical model) from §2.3 and the data that the Query Service (§1.3) reads.

### 8.1 Principal theses

| #   | Thesis                                                                                                                                                             | Resolves (P13)     |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------|
| T1  | **Data is grouped into three layers:** Staging (source schemas), Integration & Serving (`ods`, `risk` and the derived stores) and Control. Each store has one writer. | D1, D8             |
| T2  | **Frontend, MCP and the Risk Service MUST NOT read source schemas.** They read `ods` and `risk` through the Query Service.                                         | D6, D8, D9         |
| T3  | **`domain-model.md` defines the entities of `ods`.** Their keys and grain are the contract for every consumer, the Frontend included. Conflicts with §8.4 are open (§9 Q3).                             | D10, D11           |
| T4  | **`ods` entities are tables written by Normalize & Link,** with typed keys, enforced foreign keys, provenance and version.                                          | D2, D13            |
| T5  | **`ods` carries the attributes and enrichment that Frontend and MCP serve.** Each is an `ods` column or an `ods` table keyed by an entity.                             | D8, D14, D18       |
| T6  | **Entity resolution runs once, in Normalize & Link.** `ods` stores each result as a link row with `patikimumas` and `metodas`.                                       | D4, D5             |
| T7  | **Each identifier has one type and one format in `ods`.** `jarKodas` is 9-digit `text`. Type conversion happens only between a source schema and `ods`.          | D3, D16            |
| T8  | **An `ods` object is a view only when its read cost is small** (§8.7). Otherwise Normalize & Link maintains it as a derived table.                                  | D13, D17           |
| T9  | **One concept has one definition.** Each aggregate exists once in `ods`. No page and no second view recomputes it.                                               | D12, D17           |
| T10 | **Migrations create every `ods` object.** CI verifies each object against the migrated schema.                                                                  | D10, D11           |
| T11 | **Page reads are bounded.** A page section reads `ods` by key or reads one derived table. No page runs entity resolution.                                        | D5, D14, D15, D19  |
| T12 | **Search indexes are the only copies of `ods` data outside PostgreSQL.** Quickwit and Typesense documents are built from `ods`.                                                     | D18                |

The front page reads the Quickwit contract index built from `ods`. A source schema is never the data source of a page.

### 8.2 Data Layer model

The diagram shows the writer of each data layer and the read path of every consumer.

```mermaid
flowchart LR
    subgraph ingestion["Data Ingestion"]
        Extract["Extract (I1–I4)"]
        NormalizeLink["Normalize & Link (I5–I8)"]
    end
    subgraph staging["Staging layer"]
        Source[("Source schemas, for example vpmSutartys, eppsViesiejiPirkimai, cvpp, ppa, rcJar, sabis")]
    end
    subgraph serving["Integration & Serving layer"]
        Ods[("ods: entities, enrichment, links, derived tables, views")]
        Risk[("risk: procurement risk decisions, risk signals")]
        Search[("Quickwit and Typesense indexes")]
    end
    Indexer["Search Indexing (S2)"]
    RiskService["Procurement Risk Service"]
    QueryService["Query Service"]
    Consumers["Frontend and MCP"]
    Extract -.->|source rows| Source
    Source -.->|typed facts| NormalizeLink
    NormalizeLink -.->|entities, links, derived rows| Ods
    NormalizeLink -.->|facts changed| Indexer
    Indexer -->|reads| Ods
    Indexer -.->|documents| Search
    RiskService -.->|decisions, signals| Risk
    RiskService -->|analytical reads| QueryService
    Consumers -->|calls queries| QueryService
    QueryService -->|reads| Ods
    QueryService -->|full-text search| Search
    QueryService -->|risk results| Risk
```

| Layer          | Schema names                                                                                          | ETL term                         | Grain                                   | Writer                                        | Readers                                   | Rebuilt from                      |
|----------------|-------------------------------------------------------------------------------------------------------|----------------------------------|-----------------------------------------|-----------------------------------------------|-------------------------------------------|-----------------------------------|
| Staging        | One schema per upstream source, for example `vpmSutartys`, `eppsViesiejiPirkimai`, `cvpp`, `ppa`, `rcJar`, `sabis` | Persistent staging area          | One row per source record               | Extract (I1)                                  | Normalize & Link (I5), S7 governance tooling | Raw Payload Store (I3), re-scrape |
| Integration & Serving | `ods`                                                                                                 | Operational Data Store           | One row per entity, link or aggregate   | Normalize & Link (I5–I8); migrations for views        | Query Service, Search Indexing (S2)   | Source schemas                    |
| Integration & Serving | `risk`                                                                                         | Analytical output                | One row per procurement risk decision; one row per risk signal          | Procurement Risk Service                      | Query Service                             | `ods` and indicator code          |
| Control        | `infra`, `auth`, `jobs`                                                                               | Job control and metadata         | One row per setting, key or job          | S1, S5, S9 (§9 Q6)                            | The writing components                    | Migrations and fixtures           |

- The Integration & Serving layer also holds stores outside PostgreSQL: document content (I4), search indexes (S2) and
  the AI enrichment store (S3).
- The Query Service reads only the Integration & Serving layer. Only Normalize & Link and S7 read the Staging layer.

### 8.3 `ods` object kinds

| Kind              | Content                                                                                      | Physical form                                           | Writer                              | Example                                   |
|-------------------|----------------------------------------------------------------------------------------------|---------------------------------------------------------|-------------------------------------|-------------------------------------------|
| Entity table      | One entity of `domain-model.md` §1                                                            | Table                                                   | Normalisation (I5)                  | `ods."sutartys"`                          |
| Enrichment        | Attributes that Frontend or MCP show: names, classifier titles, registry flags, payroll, finance | Entity table column (1:1) or table keyed by the entity (1:N) | Normalisation (I5), Reference Data (I6) | `ods."organizacijos"."darbuotojai"`, `ods."organizacijuFinansai"` |
| Link table        | A relationship that the sources do not key, with its match score                              | Table                                                   | Entity Resolution (I7)              | `ods."sutarciuPirkimai"`                  |
| Derived table     | An aggregate over many entity rows whose view cost is not small                               | Table, updated with its entity rows (§8.6)                      | Fact Persistence (I8)               | `ods."pirkejuTiekejuRysiai"`              |
| View              | A join or aggregate whose read cost is small                                                 | View                                                    | Migration                           | `ods."rinkos"`                            |

- An attribute with one value per entity is a column of the entity table.
- A 1:N attribute, or an attribute set with its own refresh cycle, is a table keyed by the entity.
- The *Writer* column names the Normalize & Link sub-component that produces the rows. Fact Persistence (I8) executes every `ods` write:
  idempotent upsert, version and provenance.

### 8.4 Entity tables and enrichment

Every entity, enrichment and link table has these provenance columns:

| Column            | Type          | Meaning                                                    |
|-------------------|---------------|------------------------------------------------------------|
| `saltinis`        | `text`        | Code of the source schema that supplied the fact           |
| `saltinioIrasoId` | `text`        | Key of the record in the source schema                     |
| `ikelimoId`       | `bigint`      | Id of the ingestion run that wrote the row                 |
| `ikeltaAt`        | `timestamptz` | Commit time of that ingestion run                          |
| `versija`         | `integer`     | Version of the fact; increments on each change             |

The source row that `saltinis` and `saltinioIrasoId` reference records the source URL and the retrieval time (G3).

The table shows the core entities. The remaining entities of `domain-model.md` §1.3 follow the same pattern. The key
convention, the grain of merged entities and the history model are open (§9 Q3–Q5).

| Table                       | Domain entity         | Key                                                        | Foreign keys                                                       | Attributes for Frontend and MCP (examples)                                                                 |
|-----------------------------|-----------------------|------------------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `ods."organizacijos"`       | Įmonė                 | `organizacijosId` (surrogate); `jarKodas` unique if known  | —                                                                  | `pavadinimas`, `teisineForma`, `statusas`, `adresas`, `koordinates`, `darbuotojai`, `vidutinisAtlyginimas`, blacklist validity intervals |
| `ods."pirkimoPlanai"`       | Pirkimo planas        | `planoRaktas`                                              | `pirkejoId` → `organizacijos`                                      | `pavadinimas`, `numatomaVerte`, `bvpzKodai`, `bvpzPavadinimai`                                  |
| `ods."pirkimai"`            | Pirkimas              | `pirkimoRaktas` (`saltinis` + `pirkimoNumeris`)            | `pirkejoId` → `organizacijos`                                      | `pavadinimas`, `pirkimoBudas`, `statusas`, `numatomaVerteEur`, `bvpzKodai`, `bvpzPavadinimai`   |
| `ods."skelbimai"`           | Skelbimas             | `skelbimoRaktas`                                           | `pirkimoRaktas` → `pirkimai`                                       | `skelbimoRusis`, `skelbimoTipas`, `paskelbimoData`                                              |
| `ods."pirkimoDalys"`        | Pirkimo dalis         | `daliesRaktas`                                             | `pirkimoRaktas` → `pirkimai`                                       | `daliesPavadinimas`, `dalyviuSkaicius`, `atmestuSkaicius`                                       |
| `ods."dalyviai"`            | Dalyvis               | `dalyvioRaktas`                                            | `daliesRaktas` → `pirkimoDalys`; `tiekejoId` → `organizacijos`     | `eileNumeris`, `pasiulymoKaina`, `atmetimoPriezastis`                                           |
| `ods."sutartys"`            | Sutartis              | `sutartiesUnikalusId`                                      | `pirkejoId`, `tiekejoId` → `organizacijos`                         | `pavadinimas`, `tipoPavadinimas`, `kategorija`, `verte`, `faktineVerte`, `bvpzPavadinimas`, `dokumentuSkaicius` |
| `ods."sutarciuPakeitimai"`  | Sutarties pakeitimas  | `pakeitimoRaktas`                                          | `sutartiesUnikalusId` → `sutartys`                                 | Changed fields with previous and new values                                                     |
| `ods."dokumentai"`          | Dokumentas            | `dokumentoRaktas`                                          | `pirkimoRaktas` → `pirkimai` or `sutartiesUnikalusId` → `sutartys` | `pavadinimas`, `pletinys`, `parsiustas`, `nuskaitytas`, `failoNuoroda`                          |
| `ods."mokejimai"`           | Mokėjimas             | `mokejimoRaktas`                                           | `sutartiesUnikalusId` → `sutartys`                                 | `israsymoData`, `suma`, `busena`                                                                |
| `ods."bylos"`               | Byla                  | `bylosId`                                                  | `organizacijosId` → `organizacijos`                                | `bylosNumeris`, `bylosRusis`, `bylojeKaip`                                                      |
| `ods."asmenuRysiai"`        | Asmens ryšys          | `rysioId`                                                  | `organizacijosId` → `organizacijos`                                | `vardas`, `pavarde`, `pareigos`                                                                 |
| `ods."valdymas"`            | Valdymas              | `valdymoRaktas`                                            | `organizacijosId`, `valdytojoId` → `organizacijos`                 | `valdymoTipas`, `dalis`                                                                         |
| `ods."organizacijuFinansai"` | Įmonės finansai (enrichment) | `finansuRaktas`                                     | `organizacijosId` → `organizacijos`                                | `laikotarpis`, balance sheet and profit-and-loss lines                                          |

### 8.5 Link tables

| Table                                | Links                                        | Match evidence                                                              | Columns beyond the keys                  |
|--------------------------------------|----------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------|
| `ods."sutarciuPirkimai"`             | `sutartys` → `pirkimai`                      | Procurement number, buyer, title similarity, publication and signing dates  | `patikimumas`, `metodas`, `pozymiai`     |
| `ods."daliuSutartys"`                | `pirkimoDalys` → `sutartys`                  | Procurement number, buyer, supplier, value, signing date                    | `patikimumas`, `metodas`                 |
| `ods."pirkimoNumeriuAtitikmenys"`    | Source `pirkimoNumeris` value → `pirkimai`   | Normalised number; one row per reference in a multi-reference value         | `patikimumas`, `metodas`                 |
| `ods."organizacijuIdentifikatoriai"` | Party code or name within one `saltinis` → `organizacijos`  | Registry code, name, country                                                | `patikimumas`, `metodas`     |

- A link row keeps its `patikimumas`. Each consumer states the minimum `patikimumas` it accepts.
- `organizacijos` includes foreign suppliers and natural persons without a `jarKodas`.
- Buyer and supplier are roles of `organizacijos`, as `domain-model.md` §1.1 defines.
- A relationship that the sources do not key is a link table row, never a nullable foreign key filled by a guess.

### 8.6 Derived tables and views

| Object                        | Form          | Grain                                  | Built from (`ods`)          | Consumers                                                | Evidence for the form                                   |
|-------------------------------|---------------|----------------------------------------|-----------------------------|----------------------------------------------------------|---------------------------------------------------------|
| `ods."pirkejuTiekejuRysiai"`  | Derived table | One row per buyer–supplier pair        | `sutartys`                  | Organisation page, relationship graph, MCP, Risk Service | Recompute 8,933 ms; stored table 5.4 ms (review D17)    |
| `ods."organizacijuMetai"`     | Derived table | One row per organisation and year      | `sutartys`                  | Organisation activity charts                             | 161 ms per view for a buyer with 14,052 contracts       |
| `ods."dalyviuPoros"`          | View          | One row per unordered pair of bidders  | `dalyviai`                  | Risk Service, MCP                                        | Input is about 37 k bid rows                            |
| `ods."rinkos"`                | View          | One row per BVPŽ division              | `pirkimai`                  | Market statistics, Risk Service                          | 45 rows over about 51 k procurements                   |

- A derived table has `perskaiciuotaAt` instead of the provenance columns.
- Fact Persistence (I8) updates the affected derived rows in the transaction that writes the entity rows.

### 8.7 Read cost budget for views

- A view is small when its consumer query takes at most 50 ms at p95 on production data volume.
- Each `ods` view has an `EXPLAIN ANALYZE` result at production volume, recorded next to its migration.
- A view that exceeds the budget MUST be a derived table.

### 8.8 Consumers read `ods`

| Consumer                              | Reads                                                                                                     |
|---------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `/` contract search                   | Quickwit contract index built from `ods."sutartys"`                                                       |
| `/sutartis/[sutartiesUnikalusId]`     | `ods."sutartys"`, `ods."sutarciuPirkimai"`, `ods."dokumentai"`, `ods."mokejimai"`                         |
| `/pirkimas/[pirkimoRaktas]`           | `ods."pirkimai"`, `ods."pirkimoDalys"`, `ods."dalyviai"`, `ods."sutarciuPirkimai"`                        |
| `/organizacija/[jarKodas]`            | `ods."organizacijos"`, `ods."pirkejuTiekejuRysiai"`, `ods."organizacijuMetai"`, enrichment tables (route key: §9 Q11)         |
| Procurement and organisation search   | Quickwit and Typesense indexes built from `ods`                                                           |
| MCP tools                             | `ods` through the Query Service                                                                           |
| MCP analyst SQL                       | `ods` with `SELECT` grants; no separate analyst view layer                                                |
| Procurement Risk Service              | `ods` through the Query Service                                                                           |

### 8.9 Placement rules

1. A fact that a source records, or an identity that Normalize & Link resolves, goes to an `ods` entity or link table.
2. An attribute that Frontend or MCP shows goes to `ods` as an enrichment column or enrichment table.
3. An aggregate over many entity rows goes to an `ods` view within the budget, or else to a derived table.
4. A judgement about a subject goes to `risk`.
5. A source-shaped record goes to its source schema, which Extract writes. A raw payload goes to the Raw Payload Store (I3).

### 8.10 Clarifications

- The source schemas are a persistent staging area. They are not integrated and not subject-oriented, so they are not a
  data warehouse.
- The architecture has no data warehouse and no data mart layer. Source schemas keep source history (G5), the Raw
  Payload Store keeps raw payloads (G6), and `ods` keeps entity versions (§9 Q5).
- `ods` also holds aggregates. One schema gives Frontend, MCP and risk one read contract.
- The `public` schema is not a data layer. It holds PostGIS catalog objects only.
- The control schemas `infra`, `auth` and `jobs` hold configuration, API keys and job state. They form the Control
  layer, which holds no domain data and which the Query Service does not read.

---

## 9. Open questions

Each question records an inconsistency or a gap that needs a decision. The options follow common practice, and
"(recommended)" marks the preferred option. An answered question moves into the relevant section.

1. **Alpha database instance**: the pipeline overview and the test kinds table (§7.3) show one PostgreSQL `ods` instance
   for the alpha and production integration tests. §7.5 and §7.6 give alpha its own restored instance on network
   `vp-alpha-data`, where alpha runs migrations and writes `risk`.
   Question to address: do alpha and production use separate PostgreSQL instances?
   Option 1 (recommended): separate instances. Alpha restores the production backup (`vp-deploy refresh-alpha-db`), and
   §7.3 shows one database per environment. Alpha migrations and writes never reach production data.
   Option 2: one shared instance. Alpha runs no migrations and no writing apps, and reads through the read-only role only.
   Migrations then reach a database for the first time in `vp-deploy prod`.
2. **Delivery guarantee of "facts changed" events**: §2.2 and G7 publish the event after commit as a NATS hint, and NATS
   delivers at most once (`utils/natsHub.js`). A lost event leaves search indexes and risk decisions stale, and no
   component detects it (review P7).
   Question to address: how does each consumer find every committed change?
   Option 1 (recommended): transactional outbox. I8 writes a change row (entity type, key, `ikelimoId`) in the fact write
   transaction; each consumer reads the change log from its stored position, and NATS only wakes it up.
   Option 2: NATS JetStream with durable consumers and acknowledgements. Publishing after commit still needs an outbox or
   a retry loop.
   Option 3: change data capture from PostgreSQL logical replication, for example Debezium. It adds a runtime component
   to operate.
3. **Entity keys and the owner of the domain model**: T3 makes `domain-model.md` the contract for keys and grain, but
   §8.4 changes both. `organizacijosId` replaces `jarKodas`, `daliesRaktas` replaces `subjektoRaktas`, `dalyvioRaktas`
   and `rysioId` replace a composite key and `id`, and `*Id` foreign keys replace `*Kodas` codes. `domain-model.md` §1
   and §3 define entities as views with unenforced relationships, while T4 requires tables with enforced foreign keys.
   `risk."signals"."subjectKey"` stores these keys.
   Question to address: which document defines the `ods` entities, and which key convention applies to all of them?
   Option 1 (recommended): move `domain-model.md` to `docs/architecture/` as the `ods` contract and align it with §8.4.
   One convention applies: a `bigint` surrogate `<entity>Id` primary key plus a unique natural key. The indicator
   sections stay in the risk story.
   Option 2: `domain-model.md` stays the indicator language over views. §8.4 becomes the `ods` contract, and
   `domain-model.md` §4 maps each domain entity to its `ods` tables.
4. **Grain of an `ods` entity row**: §8.4 gives each row one `saltinis` and one `saltinioIrasoId`, and `pirkimoRaktas`
   contains `saltinis`. An organisation merged from JAR, contracts and TED has several source records, and a procurement
   that two sources publish stays two rows (T6).
   Question to address: does an `ods` entity row represent one source record or one real-world entity?
   Option 1 (recommended): one row per real-world entity. Provenance moves to a source record table (entity key,
   `saltinis`, `saltinioIrasoId`, `ikelimoId`), and entity keys contain no `saltinis`.
   Option 2: one row per source record. Link tables group the rows of one entity, and every consumer reads the resolved
   identity.
5. **History of `ods` facts**: G5 requires recorded versions, and the entity queries of §1.3 return change history.
   §8.4 stores only a `versija` counter per row. §8.10 puts source history into the source schemas, whose grain is one
   row per source record (§8.2).
   Question to address: where are the previous versions of an entity stored, and how does the Query Service read them?
   Option 1 (recommended): current-state tables plus one history table per versioned entity, which I8 writes in the same
   transaction, with validity intervals. `ods."sutarciuPakeitimai"` stays a domain entity.
   Option 2: validity intervals on the entity table itself (slowly changing dimension, type 2). Every current-state read
   filters on an open interval.
   Option 3: `ods` keeps current state only, and source schemas keep one row per source record version. The Query
   Service then reads history from source schemas, which T2 forbids.
6. **Database roles for job state and control data**: `packages/jobs` writes job state for `ingestion`, `risk`,
   `indexer`, `enrichment` and `open-data`, but §6.6 gives most of these apps only `DATABASE_URL_READONLY`. S1, S5, S9
   and OCR work distribution write `infra`, `auth` and `jobs` (§3.1), which breaks rule 1 of §1.2. The Risk Service
   holds a session advisory lock (`services/procurement-risk/index.ts`), and PgBouncer transaction pooling keeps no
   session state.
   Question to address: which role writes each control schema, and which connections bypass PgBouncer?
   Option 1 (recommended): one PostgreSQL role per app, granted its owned schema and its own `jobs` queues, while queries
   use the shared read-only role. A lease row in `jobs` replaces the session advisory lock, and the PgBouncer pools of
   all roles fit within `max_connections`.
   Option 2: one shared `DATABASE_URL_JOBS` role for every app that uses `packages/jobs`, plus `DATABASE_URL_*_DIRECT`
   connections that bypass PgBouncer for session features.
7. **Placement of the AI enrichment store**: §1.2, §3 and §3.1 give S3 its own store, which the Query Service reads. §8
   knows only source schemas, `ods` and `risk`; T5 puts every shown attribute into `ods`; `apps/enrichment` has no
   `database` dependency and only a read-only connection (§6.4, §6.6). The current code writes LLM descriptions to
   `eppsViesiejiPirkimai."aprasymai"` and embeddings to SQLite (`modules/vector`).
   Question to address: where does S3 write, and how do its outputs reach Frontend and MCP?
   Option 1 (recommended): a PostgreSQL schema owned by `apps/enrichment`, for example `ai`, with its own writer role.
   §8.2 lists it as a layer, the Query Service reads it, and embeddings use pgvector.
   Option 2: S3 outputs are an upstream source of Data Ingestion. Extract stages them in a source schema, and Normalize & Link maps them
   into `ods` enrichment.
   Option 3: a store outside PostgreSQL behind `packages/storage`, for example object storage. The Query Service then
   combines two stores in one read.
8. **Storage of document content and raw payloads**: I3, I4 and `packages/storage` keep the sidecar SQLite files, which
   have one writer host and no backup (review P1, P7). The Query Service reads document content inside `web` and `mcp`,
   but §7.6 mounts `DATA_ROOT` read-write into `web` and not into `mcp`.
   Question to address: which store keeps document content and raw payloads, and how do `web` and `mcp` read it?
   Option 1: the SQLite sidecars stay. `DATA_ROOT` is mounted read-only into `web` and `mcp` (read-only SQLite access in
   WAL mode needs a test), and S8 backs up the sidecar files.
   Option 2 (recommended, if the measured volume fits the PostgreSQL disk and backup budget): document content in
   PostgreSQL tables with TOAST compression, raw payloads in S3-compatible object storage. No app mounts a shared volume.
   Option 3: S3-compatible object storage for both, for example MinIO on `lempa` with off-site replication.
   `packages/storage` reads it over HTTP.
9. **Schema verification in CI**: T10 requires CI to verify every `ods` object against the migrated schema, and review
   P1 requires a schema rebuild from the repository. §7.2 principle 3 allows no database in GitHub Actions, while
   `packages/testing` provides a Testcontainers database.
   Question to address: which pipeline stage applies all migrations to an empty database?
   Option 1 (recommended): a `schema` job in `ci.yml` with a PostgreSQL and PostGIS service container. It runs
   `vp db migrate` from zero, compiles every view and checks that `packages/database/schema/` is current. Unit tests stay
   without a database.
   Option 2: `vp-deploy alpha` verifies the schema before the integration tests. A broken migration is then found only
   after the merge.
10. **Production control data in the alpha database**: `vp-deploy refresh-alpha-db` restores the full production backup
    (§7.6). The restore copies API keys (`auth.raktai`), worker and storage box keys, and proxy credentials (`infra`)
    into alpha, which is public at `alpha.viespirkiai.org`.
    Question to address: which data does the alpha restore keep, and who can reach alpha?
    Option 1 (recommended): restore everything, then replace the control data with committed alpha fixtures before any
    alpha app starts. Cloudflare Access limits `alpha.viespirkiai.org` to the team.
    Option 2: restore only the fact schemas and `risk`. Migrations and fixtures create the control schemas.
11. **Organisation identity in public URLs**: §8.8 addresses the organisation page as `/organizacija/[jarKodas]`, but
    §8.5 includes foreign suppliers and natural persons without a `jarKodas`. The current code serves
    `/asmuo/[jarKodas]`, `/tiekejas/[kodas]` and `/pirkejas/[kodas]`, and external links point at them.
    Question to address: which key addresses an organisation page, and what happens to the current URLs?
    Option 1 (recommended): two route forms, by `jarKodas` when it is known and by `organizacijosId` otherwise. The
    current URLs redirect permanently (HTTP 301) to the new routes.
    Option 2: `organizacijosId` only, with a lookup route from `jarKodas`. The URLs are stable but not readable.
12. **Implementation of S1 Job Orchestration**: `packages/jobs` moves from `runner/` and the per-module `SKIP LOCKED`
    queues (§6.3). Review P6 names the home-grown scheduler and queues as a permanent maintenance cost.
    Question to address: does `packages/jobs` wrap a maintained job queue library, or does it re-house
    `runner/TaskRunner.js`?
    Option 1 (recommended): a maintained PostgreSQL job queue, for example pg-boss or Graphile Worker, behind the
    `packages/jobs` interface. Compatibility with PgBouncer transaction pooling is a selection criterion (Q6).
    Option 2: `runner/` moves into `packages/jobs`, and one generic queue table replaces the per-module queues. The team
    keeps maintaining the scheduler.
13. **Public HTTP surface of the apps**: `mcp`, `ingestion-api` and the contract export WebSocket need public routes
    (§6.3, §7.6). The cloudflared ingress names only `viespirkiai.org` and `alpha.viespirkiai.org`, and §6.3 moves the
    export WebSocket from `web` into `apps/open-data`.
    Question to address: which hostname, path and port reach each internet-facing app?
    Option 1 (recommended): cloudflared path rules send `/mcp` to `mcp`, and a separate hostname sends OCR worker and
    file lookup traffic to `ingestion-api`. The export WebSocket stays in `web` and reads through the Query Service.
    Option 2: one reverse proxy container, for example Caddy, in the business compose project routes all paths.
    cloudflared forwards every hostname to it.
14. **Networking of the production Typesense cluster**: production Typesense uses host networking for Raft peering
    with `lempa2` and the off-site node (§7.6). Apps reach data services by service name on the bridge network (§7.6),
    and a host-network container does not join that network.
    Question to address: how do the apps on `vp-prod-data` reach Typesense?
    Option 1 (recommended): Typesense keeps host networking. Apps use `host-gateway` (`extra_hosts`), and the API port
    listens only on loopback and WireGuard addresses.
    Option 2: Typesense runs on the bridge network with published API and peering ports. Each node advertises its
    WireGuard address to its peers.
15. **Off-site read-only mirror**: the current system runs a read-only Frontend with a PostgreSQL replica and Typesense
    node 3 on an off-site host (`architecture-current.md` §1, §5). The target removes the sidecar HTTP read API that
    this Frontend uses (§1.3, §5), and §7 defines no off-site environment.
    Question to address: does the target keep a read-only mirror, and for which purpose?
    Option 1: a third environment runs the production release of `web` and `mcp` against the replica. It needs a
    replicated document content store (Q8).
    Option 2: the mirror goes away. The replica serves recovery only (S8), and the Cloudflare cache serves pages during
    an outage.
16. **Language of domain identifiers**: `ods` names are Lithuanian (`organizacijos`, `pirkimoRaktas`), and the `risk`
    schema is English (`procurementDecisions`, `signals`). The workspace folders use English entity names
    (`packages/query/src/entities/`), and review P8 names mixed languages as a risk.
    Question to address: which language do domain types, query functions, tables and columns use?
    Option 1 (recommended): Lithuanian domain terms in every layer, as `domain-model.md` and `CLAUDE.md` do. Technical
    structure stays English, and the root `AGENTS.md` holds a Lithuanian–English glossary.
    Option 2: English in code and in `risk`, Lithuanian only in `ods` and the UI. `packages/domain` maps the two
    vocabularies.
17. **GitHub repository and image namespace**: §7.5 and §7.6 use `github.com/racionalas/viespirkiai` and
    `ghcr.io/racionalas/viespirkiai-<app>`. The `origin` remote is `github.com/Viespirkiu-grupe/viespirkiai`,
    `build-image.yml` publishes to `ghcr.io/${{ github.repository }}`, and `cosign` verification pins the repository
    identity.
    Question to address: which repository builds and signs the release images?
    Option 1: `Viespirkiu-grupe/viespirkiai`, with images under `ghcr.io/viespirkiu-grupe/`.
    Option 2: `racionalas/viespirkiai`, with the `origin` remote changed to match.
18. **lempa capacity for alpha**: alpha adds a second PostgreSQL, Quickwit and Typesense to lempa (§7.6). The
    production stack has about 21.3 GB of memory limits (`architecture-current.md` §5.1).
    Question to address: do lempa's free disk and memory hold a full copy of the production database and search
    indexes?
    Option 1: full restore with low memory limits for alpha.
    Option 2: restore a subset of the data (recent years only) into alpha.
19. **Notification channel**: `vp-deploy` sends failures to `NOTIFY_WEBHOOK_URL` (§7.5).
    Question to address: which channel receives deployment messages?
    Option 1: Telegram bot.
    Option 2: e-mail through an SMTP relay.

---

## 10. Follow-up

The document leaves the work below open. The developers who implement the upgrade close each item and record the
result in this document or in `docs/adr/`.

### 10.1 Facts to verify on `lempa`

The repository does not record these host facts, and the target design depends on them.

- [ ] **Running artifacts:** read the live `compose.yml` and compare the digest of the running `frontend` container
  with GHCR. Record how the taskRunner and the CLI jobs get new code (`architecture-current.md` §7).
- [ ] **Capacity:** measure free memory, CPU and disk, and the sizes of the PostgreSQL, sidecar, Quickwit and Typesense
  data (§9 Q8, Q18).
- [ ] **Undocumented runtimes:** record how NATS, Tor, cloudflared, WireGuard, pgAdmin and Plausible run, with versions
  and configuration files (`architecture-current.md` §5.2).
- [ ] **Existing backups:** find host-level backups or snapshots outside the repository, and the date of the last
  tested restore (review §6, question 1).
- [ ] **Host prerequisites of `vp-deploy`:** confirm systemd, the Docker Engine and Compose versions (`up --wait`,
  repeated `--env-file`), `cosign`, `flock`, the `deploy` user and free space under `/srv` (§7.5).
- [ ] **Network exposure:** confirm that `lempa` accepts inbound connections only over WireGuard and local interfaces
  (§7.2, principle 4).
- [ ] **Other hosts:** list the services, owners and access paths on `lempa2`, the off-site mirror, the goViesdeze
  boxes and the OCR and extractor hosts (§9 Q14, Q15).

### 10.2 Data layer and domain model

- [ ] **Baseline migration:** capture the current production schema as the first migration, so that `vp db migrate`
  rebuilds the schema from zero (S7, review P1).
- [ ] **Migration runner:** select the tool behind `vp db migrate`, its lock, and the order of the `source`, `ods`,
  `risk` and `control` folders (§6.2).
- [ ] **Contract migrations:** define how a destructive migration waits until no deployed app version uses the old
  shape, and enforce the rule in CI (§7.2, principle 8).
- [ ] **Source-to-`ods` mapping:** for each `ods` table, list its source tables, mapping rules and owning mapper (I5)
  (§8.4, `domain-model.md` §4).
- [ ] **Match quality:** measure the precision and recall of each link table on a labelled sample, and set the minimum
  `patikimumas` of each consumer (§8.5, review D5).
- [ ] **Exact types:** replace the global `pg` type parsers (`NUMERIC` as float, dates as strings) with exact money and
  date types in `packages/database` and `packages/domain` (review P9).
- [ ] **Personal data:** classify the personal data in `ods` (natural persons in `organizacijos`, `asmenuRysiai`), with
  legal basis, retention and erasure procedure.
- [ ] **Data-quality checks:** define the S7 checks that reconcile `ods`, derived tables and search indexes, with an
  alert on drift (review P7).
- [ ] **View evidence:** record `EXPLAIN ANALYZE` at production volume for `ods."dalyviuPoros"` and `ods."rinkos"`
  (§8.7).

### 10.3 Platform and operations

- [ ] **Backup & Recovery (S8):** select the tool (for example pgBackRest or WAL-G), RPO, RTO, off-site target,
  encryption and retention. Define the "fresh backup" check of `vp-deploy prod` (§7.5).
- [ ] **Search index rebuild:** document the rebuild procedure and duration of each Quickwit and Typesense index
  (review P7).
- [ ] **Worker health:** give `ingestion`, `indexer`, `risk`, `enrichment` and `open-data` health and metrics
  endpoints, and compose health checks that detect a stuck worker (review P4).
- [ ] **Alerting:** define alerts for failed jobs, ingestion lag (G8), disk usage, backup age and failed deployments
  (S6).
- [ ] **Resource isolation:** set memory and CPU limits for every app, and connection and statement limits for every
  database role (review P4).
- [ ] **Statistics reads:** assign the `/statistika` reads of Quickwit logs and ingestion status to a Query Service
  family (§1.3, S6).
- [ ] **Live page updates:** define how `web` receives OCR results and info-banner changes for its SSE streams. §6.4
  gives `web` no `events` dependency.
- [ ] **Operator commands in production:** define where `vp` runs against production, for example `docker compose run`
  with the `ops` image on `lempa`, and with which database role (§6.5).
- [ ] **Secret rotation:** define the rotation of database passwords, API keys and cloudflared credentials. Rotate the
  Typesense admin key that git history contains (S10, review P3).

### 10.4 CI/CD

- [ ] **Smoke tests:** define the smoke tests, their runner and their time limit for each app (§7.5).
- [ ] **`vp-deploy` self-update:** define how a change in `infra/deploy/**` replaces `/usr/local/bin/vp-deploy` and its
  systemd units (§7.4, §7.5).
- [ ] **Watched pointer:** name the image whose `main` pointer `vp-deploy watch` reads, and move that pointer last in
  step 7 (§7.4).
- [ ] **Vulnerability backlog:** the audit gate blocks every merge while the critical `astro` finding and the unfixable
  `xlsx` finding remain. Upgrade `astro` and replace `xlsx`, or record time-limited exceptions (§7.4, review P3).
- [ ] **GHCR visibility:** make every published package public, because `lempa` pulls without credentials (§7.5).
- [ ] **Rollout of `web`:** `compose up` recreates the single `web` container. Decide whether a short outage per
  release is acceptable (§7.6).
- [ ] **Integration test invariants:** list the invariants per Query Service family that the `*.it.ts` suites assert
  (§7.5).
- [ ] **Architecture rules and agent instructions:** write `.dependency-cruiser.cjs`, the ESLint rules of §6.4, the
  root `AGENTS.md` and one `AGENTS.md` per workspace (§6.1, principle 9; review P8).

### 10.5 Security

- [ ] **API keys in headers:** remove the `?apiKey=` query parameter from the OCR worker and file lookup APIs (S5,
  review P3).
- [ ] **Rate limits:** define per-client limits for search pages, MCP tools and analyst SQL (S5, review P3).
- [ ] **Analyst role:** define the grants, `statement_timeout`, row limit and connection limit of
  `DATABASE_URL_ANALYST` (§1.3, review P3).
- [ ] **Untrusted file parsing:** parse downloaded spreadsheets and XML in a process without database write credentials,
  with CPU and memory limits (review P3).

### 10.6 Documentation

- [ ] **Decision records:** record the decisions of this document and the answers to §9 in `docs/adr/`.
- [ ] **Runbooks:** write the restore, index rebuild, rollback and key rotation runbooks in `docs/runbooks/`.

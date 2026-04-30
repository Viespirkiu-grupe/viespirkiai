# Voratinklis — Interactive Procurement Network Graph

## Summary

Add a new page `/voratinklis/:jarKodas` (Lithuanian: "spider web") that renders an interactive Sigma.js
network graph of procurement relationships centred on the company identified by `jarKodas`. The page
immediately initialises the graph with that company as the root node — no search step is needed.
Visiting `/voratinklis/` without a company code returns a 404-style "įmonė nenurodyta" page.

Two types of node expansion are supported:

- **Organisation node click** — expands employees, board members, shareholders, spouses, and linked contract
  partners via `/voratinklis/expand/:jarKodas`.
- **Person node click** — expands all workplaces, governance roles, and spouse relationships declared by
  that person via `/voratinklis/expand-person?vardas=...`. Data comes from PINREG declarations queried
  directly from the DB using `gautiPinregDeklaracijasPagalVardaPavarde` (the same function that backs the
  MCP `get_pinreg_asmuo` tool). MCP is not used for this — direct DB calls are faster and avoid HTTP/SSE
  overhead; MCP is designed for external AI clients only.

Stack additions: `sigma@3`, `graphology@0.26`, `graphology-layout-forceatlas2`, `graphology-layout-noverlap`,
`@sigma/node-border`, `@sigma/node-image`. Because these are ESM npm packages targeted at Node, a browser
bundle must be compiled with `esbuild` and served as `public/dist/voratinklis.js`.

---

## Technical Breakdown

### Entity & Edge Types

The graph uses the entity and edge model defined in the repository data structures:

| Node type            | Expand trigger                                  | Source function / data                                                                                                                                                                                                                                                               | Key fields                                                                                                   | Details panel link                                                                             |
|----------------------|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `OrganizationEntity` | Org node click                                  | `jarCsv` (root org metadata — `pavadinimas`, `formosKodas`) + `sutartysSaliuSumos JOIN jarCsv` (partner org names)                                                                                                                                                                   | `jarKodas`, `pavadinimas`, `formosKodas`                                                                     | `/asmuo/{jarKodas}`                                                                            |
| `PersonEntity`       | Org node click                                  | `pinregJuridiniaiRysiai` filtered by `jarKodas` — all `DEKLARUOJANCIO_DARBOVIETE`, `KITI_RYSIAI_SU_JA`, `SUTUOKTINIO_DARBOVIETE` rows                                                                                                                                                | `vardas + pavarde` (name is the identity key), `rysioPradzia`                                                | *(no dedicated page)*                                                                          |
| `PersonEntity`       | Person node click                               | `pinregJuridiniaiRysiai` filtered by `vardas + pavarde` — returns all darbovietes, governance roles, and spouse relationships for that person                                                                                                                                        | Same; all declarations for that name are merged into one node                                                | *(no dedicated page)*                                                                          |
| `ContractEntity`     | Org node click                                  | `sutartys JOIN jarCsv` (top 30 contracts by value; buyer/seller names from `jarCsv` JOIN)                                                                                                                                                                                            | `sutartiesUnikalusId` (node ID key), `pavadinimas` (contract title), `verte`, `pirkimoNumeris` (may be null) | `/sutartis/{sutartiesUnikalusId}` (primary); `/viesiejiPirkimai/{pirkimoNumeris}` (if present) |
| `ProcurementEntity`  | Org node click (buyer) / Procurement node click | Created when buyer org is expanded: `viesiejiPirkimai WHERE jarKodas = $jarKodas ORDER BY numatomaVerteEUR DESC LIMIT 20`. When the procurement node itself is clicked, it expands by fetching `sutartys WHERE pirkimoNumeris = $pirkimoId GROUP BY tiekejoKodas` → winner org stubs | `pirkimoId` (node ID key), `pavadinimas`, `numatomaVerteEUR`, `statusas`, `pirkimoBudas`                     | `/viesiejiPirkimai/{pirkimoId}`                                                                |

> **`ProcurementEntity` is a hub node.** One procurement notice can result in contracts with multiple
> different winners (32,605 of 37,796 procurements have >1 distinct winner — see `docs/DB_ER.md`).
> The procurement node sits between the buyer org and its award recipients: `BuyerOrg → Procurement →
> [WinnerOrg1, WinnerOrg2, …]`. This is fundamentally different from a `ContractEntity` which is
> always a one-to-one buyer↔seller financial document.
>
> **`ContractEntity.pirkimoNumeris`** links a signed contract back to the originating procurement
> notice. The details panel renders a secondary link `/viesiejiPirkimai/{pirkimoNumeris}` only when
> the value is non-null. This is separate from the `ProcurementEntity` graph node — both views are
> useful but serve different purposes.

**Entity ID convention:**

| Entity       | ID format                                                             | Example                 |
|--------------|-----------------------------------------------------------------------|-------------------------|
| Organisation | `org:{jarKodas}`                                                      | `org:110053842`         |
| Person       | `person:{vardas.trim().toLowerCase()} {pavarde.trim().toLowerCase()}` | `person:jonas jonaitis` |
| Contract     | `contract:{sutartiesUnikalusId}`                                      | `contract:2008083561`   |
| Procurement  | `procurement:{pirkimoId}`                                             | `procurement:474742`    |

> **Person identity is name-only.** The same physical person appearing in declarations for different
> organisations will have the same node ID and will be merged into a single graph node automatically
> by graphology's idempotent merge — this is the intended behaviour. `deklaracija` UUIDs are stored
> as a node attribute array (`deklaracijos: string[]`) for audit purposes but are not used as the ID.
> Person nodes must store `vardas` and `pavarde` as separate attributes so the frontend can derive
> the node ID and pass the full name to `expand-person`.

#### Person node expansion — `expandPerson` and `expandOrg` DB mapping

Both functions query `pinregJuridiniaiRysiai` directly — this table stores all pinreg declared
relationships as structured rows, with one row per person↔org link. When a **person node is clicked**,
`expandPerson` filters this table by `vardas + pavarde` (or `susijusioAsmensVardas + susijusioAsmensPavarde`
for spouse relationships), returning all darbovietes, governance roles, and spouse links declared
across every employer that person has ever listed. Each row has an `irasoTipas` classifier that
determines which graph elements to produce:

| `irasoTipas`                | Produces                                                                       | Edge type(s)                                                           |
|-----------------------------|--------------------------------------------------------------------------------|------------------------------------------------------------------------|
| `DEKLARUOJANCIO_DARBOVIETE` | `PersonEntity` (declarant) + `OrganizationEntity` stub                         | `Employment`/`Director`/`Official` — person → org                      |
| `KITI_RYSIAI_SU_JA`         | `PersonEntity` + `OrganizationEntity` stub                                     | `Director`/`Shareholder`/`Official` — person → org                     |
| `SUTUOKTINIO_DARBOVIETE`    | `PersonEntity` (spouse) + `OrganizationEntity` stub + declarant `PersonEntity` | `Employment`/`Director` (spouse → org) + `Spouse` (declarant → spouse) |

| Edge type                               | Direction         | Source                                                                                        |
|-----------------------------------------|-------------------|-----------------------------------------------------------------------------------------------|
| `Employment` / `Director` / `Official`  | Person → Org      | `pinregJuridiniaiRysiai` rows with `irasoTipas = DEKLARUOJANCIO_DARBOVIETE`                   |
| `Employment` / `Director`               | Spouse → Org      | `pinregJuridiniaiRysiai` rows with `irasoTipas = SUTUOKTINIO_DARBOVIETE`                      |
| `Shareholder` / `Director` / `Official` | Person → Org      | `pinregJuridiniaiRysiai` rows with `irasoTipas = KITI_RYSIAI_SU_JA`                           |
| `Spouse`                                | Person → Person   | `pinregJuridiniaiRysiai` rows with `irasoTipas = SUTUOKTINIO_DARBOVIETE` (declarant → spouse) |
| `Order`                                 | Org → Contract    | `sutartys.topPirkejai` → buyer side                                                           |
| `Delivery`                              | Contract → Org    | `sutartys.topTiekejai` → supplier side                                                        |
| `Procurement`                           | Org → Procurement | `viesiejiPirkimai WHERE jarKodas = $jarKodas` — buyer org issued the tender                   |
| `Award`                                 | Procurement → Org | `sutartys WHERE pirkimoNumeris = $pirkimoId GROUP BY tiekejoKodas` — winning seller orgs      |

> **`irasoTipas` is a record classifier, not a role label.** The three distinct values in the DB are
> `DEKLARUOJANCIO_DARBOVIETE`, `SUTUOKTINIO_DARBOVIETE`, and `KITI_RYSIAI_SU_JA`. They must **never**
> be used as edge labels — they are only used to decide which mapping branch to enter.

#### Data Source → Graph Element Mapping

```mermaid
flowchart LR
    subgraph DB["PostgreSQL Tables"]
        JC[("jarCsv\npavadinimas · formosKodas")]
        PR[("pinregJuridiniaiRysiai\nirasoTipas · vardas · pavarde\npareigos · rysioPobudzioPavadinimas\njarKodas · pavadinimas\ndarbovietesTipas")]
        ST[("sutartys\nsutartiesUnikalusId · pavadinimas · verte\nperkanciosiosOrganizacijosKodas · tiekejoKodas\npirkimoNumeris")]
        VP[("viesiejiPirkimai\npirkimoId · pavadinimas\njarKodas · numatomaVerteEUR\nstatusas · pirkimoBudas")]
    end

    subgraph GN["Graph Nodes"]
        OE_root["OrganizationEntity\n— root —\nexpanded=true"]
        OE_stub["OrganizationEntity\n— stub —\nexpanded=false\n(partner name from jarCsv JOIN)"]
        PE["PersonEntity\n(all darbovietes + rysiaiSuJa\n+ sutuoktinioDarbovietes)"]
        CE["ContractEntity\nlabel: contract pavadinimas\n(first 9 words)"]
        VPE["ProcurementEntity\nlabel: pavadinimas (first 6 words)\nnumatomaVerteEUR"]
    end

    subgraph GE["Graph Edges"]
        E1["Employment / Director / Official\nlabel: pareigos"]
        E2["Shareholder / Director / Official\nlabel: rysioPobudzioPavadinimas"]
        E3["Spouse\nlabel: Sutuoktinis"]
        E4["Order\nlabel: €X / €XK / €XM"]
        E5["Delivery\n(no label)"]
        E6["Procurement\nlabel: pirkimoBudas"]
        E7["Award\nlabel: €X / €XK / €XM"]
    end

    JC -->|" pavadinimas, formosKodas\n(root org only) "| OE_root
    PR -->|" DEKLARUOJANCIO_DARBOVIETE\nvardas + pavarde "| PE
    PR -->|" SUTUOKTINIO_DARBOVIETE\nvardas/pavarde = spouse\nsusijusioAsmens* = declarant "| PE
    PR -->|" KITI_RYSIAI_SU_JA\nvardas + pavarde "| PE
    PR -->|" all irasoTipas\njarKodas + pavadinimas\n(from pinreg row) "| OE_stub
    PR -->|" DEKLARUOJANCIO / SUTUOKTINIO\ndirection: person → org\npareigos "| E1
    PR -->|" KITI_RYSIAI_SU_JA\ndirection: person → org\nrysioPobudzioPavadinimas "| E2
    PR -->|" SUTUOKTINIO_DARBOVIETE\ndirection: declarant → spouse "| E3
    ST & JC -->|" sutartiesUnikalusId\npavadinimas (contract title)\nverte · partner names via JOIN jarCsv "| CE
    ST & JC -->|" perkanciosiosOrganizacijosKodas / tiekejoKodas\npavadinimas via JOIN jarCsv "| OE_stub
    ST -->|" direction: org → contract\nverte as label "| E4
    ST -->|" direction: contract → org "| E5
    VP & JC -->|" pirkimoId · pavadinimas\nnumatomaVerteEUR · statusas · pirkimoBudas "| VPE
    VP -->|" direction: buyer org → procurement\npirkimoBudas as label "| E6
    ST & VP -->|" pirkimoNumeris = pirkimoId\ndistinct tiekejoKodas → OE_stub\ndirection: procurement → seller org "| E7
```

#### Edge labels

Every edge must carry a visible `label` attribute set at build time in `modules/voratinklis/expand.js`:

| Edge type                                                          | `label` value                                                                                                                                                                              |
|--------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Order` / `Delivery`                                               | Formatted `verte`: `€1.2M`, `€450K`, `€12K`, etc. — see formatting note                                                                                                                    |
| `Procurement`                                                      | `pirkimoBudas` field (e.g. "Atviras konkursas", "Skelbiama apklausa")                                                                                                                      |
| `Award`                                                            | Formatted `verte` sum (total contract value from that seller for this procurement)                                                                                                         |
| `Employment` / `Director` / `Official` (person or spouse → org)    | `pareigos` field (free-text job title, e.g. "Direktorius", "Gydytojas"). Never `darbovietesTipas` — that field holds `STANDARTINE`, `EKSPERTO`, or `SUTUOKTINIO` and is not human-readable |
| `Director` / `Shareholder` / `Official` (from `KITI_RYSIAI_SU_JA`) | `rysioPobudzioPavadinimas` field (controlled vocabulary, e.g. "Valdybos narys", "Akcininkas")                                                                                              |
| `Spouse`                                                           | `"Sutuoktinis"`                                                                                                                                                                            |

> **Contract value formatting**: use `Math.round(verte)` and express as `€XM` (millions, 1 dp), `€XK`
> (thousands, 0 dp), or `€X` (under 1000) — e.g. `1234567 → €1.2M`, `45000 → €45K`, `800 → €800`.
> `null`/`0` values display an empty string (no label).

#### Node labels

Node labels are rendered **below** the node. Long names are word-wrapped at **3 words per line**
using a simple space-split utility:

```js
function wrapLabel(name, n = 3) {
    const words = (name ?? '').split(' ');
    const lines = [];
    for (let i = 0; i < words.length; i += n) lines.push(words.slice(i, i + n).join(' '));
    return lines.join('\n');
}
```

| Entity type          | Label source             | Applied as                          |
|----------------------|--------------------------|-------------------------------------|
| `OrganizationEntity` | `pavadinimas`            | `wrapLabel(pavadinimas)`            |
| `PersonEntity`       | `vardas + " " + pavarde` | `wrapLabel(vardas + " " + pavarde)` |
| `ContractEntity`     | contract count           | `"N sut."` (e.g. `"17 sut."`)       |
| `ProcurementEntity`  | `pavadinimas` (6 words)  | `wrapLabel(pavadinimas, 6)`         |

Sigma's default label renderer draws labels to the **right** of the node centre. A custom
`defaultDrawNodeLabel` function must be provided to `new Sigma(graph, container, { defaultDrawNodeLabel })`
to position the label **below** the node (draw at `y + nodeSize + labelPadding`, horizontally centred on `x`).

### Architecture

New server-side module `modules/voratinklis/` containing:

- `expand.js` — exported functions:
    - `expandOrg(jarKodas)` — queries `jarCsv` (root org metadata), `pinregJuridiniaiRysiai` (person
      relationships), `sutartys JOIN jarCsv` (top 30 contracts by value), and `viesiejiPirkimai`
      (top 20 procurement notices by `numatomaVerteEUR`) for this org as **buyer**; maps raw rows to
      `GraphNode[]` and `GraphEdge[]`. Returns `{ nodes, edges }`.
    - `expandPerson(fullName)` — queries `pinregJuridiniaiRysiai` directly, matching on
      `vardas + pavarde` or `susijusioAsmensVardas + susijusioAsmensPavarde`; returns **all
      darbovietes, governance roles, and spouse relationships** declared by that person across all
      employers, as stub `OrganizationEntity` nodes + person↔org / spouse edges.
    - `expandProcurement(pirkimoId)` — queries `sutartys WHERE pirkimoNumeris = $pirkimoId GROUP BY
      tiekejoKodas` to find distinct winning seller orgs + `jarCsv JOIN` for their names; returns
      seller `OrganizationEntity` stub nodes + `Award` edges from the procurement node.
    - All functions return `{ nodes: GraphNode[], edges: GraphEdge[] }`.

New route `routes/voratinklis.js`:

| Method | Path                                  | Purpose                                                                                           |
|--------|---------------------------------------|---------------------------------------------------------------------------------------------------|
| `GET`  | `/voratinklis/`                       | Returns 404 ("įmonė nenurodyta") — no jarKodas was given                                          |
| `GET`  | `/voratinklis/:jarKodas`              | EJS page shell with jarKodas passed as template variable; graph auto-initialises on load          |
| `GET`  | `/voratinklis/expand/:jarKodas`       | JSON: graph nodes+edges for one organisation (calls `expandOrg`)                                  |
| `GET`  | `/voratinklis/expand-person`          | JSON: graph nodes+edges for one person by full name (`?vardas=...`). Calls `expandPerson`.        |
| `GET`  | `/voratinklis/expand-procurement/:id` | JSON: graph nodes+edges for one procurement — its winning seller orgs. Calls `expandProcurement`. |

> **Route ordering note**: `expand` and `expand-person` static path segments must be registered _before_
> the `/:jarKodas` wildcard so they are not swallowed by the dynamic route handler.

Browser bundle `src/voratinklis-bundle.js` compiled by esbuild into `public/dist/voratinklis.js`:
imports sigma, graphology, layouts, and node-programs; exports nothing — attaches `window.Voratinklis`
with `{ Sigma, Graph, forceAtlas2, noverlap, NodeBorderProgram, NodeImageProgram }` so the inline EJS
script can initialise the graph.

### Client-side fetch strategy

The project uses **no data-fetching library** anywhere — all client fetch calls in every view are vanilla
`fetch()` with manual `AbortController`, debouncing, and request-ID sequencing (see `views/juridiniai/search.ejs`
for the canonical pattern). `@tanstack/query-core` was considered but is **not used** — reasoning:

- Node expansion is **one-shot and idempotent**: once a node is marked `expanded: true`, it is never
  re-fetched. No stale-while-revalidate, background refresh, or pagination is required.
- Concurrent duplicate clicks on the same unexpanded node are deduplicated with a **`Set<nodeId>`** of
  in-flight requests (consistent with the `inFlightControllers` Map pattern already used in the project).
- Introducing a framework-agnostic query client would be an isolated pattern inconsistent with the
  zero-framework vanilla JS convention throughout all views.

**In-flight deduplication pattern** (to implement in the inline script):

```js
const expandingNodes = new Set(); // IDs currently being fetched

async function loadOrg(jarKodas) {
    const id = `org:${jarKodas}`;
    if (expandingNodes.has(id)) return;
    expandingNodes.add(id);
    try {
        const data = await fetch(`/voratinklis/expand/${jarKodas}`).then(r => r.json());
        mergeGraphElements(data);
        graph.setNodeAttribute(id, 'expanded', true);
    } finally {
        expandingNodes.delete(id);
    }
}
```

Same pattern applies to `loadPerson`, keyed by `person:{(vardas+" "+pavarde).trim().toLowerCase()}`.

### Structural Diagram

```mermaid
graph TD
    subgraph Browser
        SigmaCanvas["Sigma.js Canvas\n(full viewport below header)"]
        GraphStore["graphology Graph instance"]
    end

    subgraph "routes/voratinklis.js"
        PageRoute["GET /voratinklis/:jarKodas → EJS shell\n(jarKodas passed as template var)"]
        NotFoundRoute["GET /voratinklis/ → 404"]
        ExpandOrgAPI["GET /voratinklis/expand/:jarKodas → JSON"]
        ExpandPersonAPI["GET /voratinklis/expand-person?vardas=... → JSON"]
    end

    subgraph "modules/voratinklis/expand.js"
        ExpandOrg["expandOrg(jarKodas)\njarCsv (root org metadata)\n+ pinregJuridiniaiRysiai (by jarKodas)\n+ sutartysSaliuSumos JOIN jarCsv (contract partners)"]
        ExpandPerson["expandPerson(fullName)\npinregJuridiniaiRysiai (by vardas+pavarde)\n→ all darbovietes + rysiaiSuJa + sutuoktinioDarbovietes"]
    end

    PageRoute -->|" DOMContentLoaded: loadOrg(jarKodas) "| ExpandOrgAPI
    SigmaCanvas -->|" org node click "| ExpandOrgAPI
    SigmaCanvas -->|" person node click\n(vardas + pavarde from node attrs) "| ExpandPersonAPI
    ExpandOrgAPI --> ExpandOrg --> ExpandOrgAPI
    ExpandPersonAPI --> ExpandPerson --> ExpandPersonAPI
    ExpandOrgAPI -->|" { nodes, edges } "| GraphStore
    ExpandPersonAPI -->|" { nodes, edges } "| GraphStore
    GraphStore --> SigmaCanvas
```

### Behavioral Diagram

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Server
    User ->> Browser: GET /voratinklis/
    Browser ->> Server: GET /voratinklis/
    Server -->> Browser: 404 "įmonė nenurodyta"
    User ->> Browser: GET /voratinklis/{jarKodas}
    Browser ->> Server: GET /voratinklis/{jarKodas}
    Server -->> Browser: EJS page (empty Sigma canvas, jarKodas embedded)
    Browser ->> Browser: DOMContentLoaded → loadOrg(jarKodas)
    Browser ->> Server: GET /voratinklis/expand/{jarKodas}
    Server -->> Browser: { nodes[], edges[] }
    Browser ->> Browser: Add to graphology Graph
    Browser ->> Browser: Run ForceAtlas2 layout
    Browser ->> Browser: Render with Sigma
    User ->> Browser: Clicks unexpanded org node
    Browser ->> Browser: Show loading overlay (blocks further clicks)
    Browser ->> Server: GET /voratinklis/expand/{jarKodas}
    Server -->> Browser: { nodes[], edges[] } (merged, idempotent)
    Browser ->> Browser: Merge nodes pre-position new nodes at clicked node pos
    Browser ->> Browser: Run ForceAtlas2 → compute final positions
    Browser ->> Browser: animateNodes (600ms, quadraticInOut) clicked pos → final pos
    Browser ->> Browser: Hide loading overlay
    User ->> Browser: Clicks unexpanded person node
    Note over Browser: person node attrs contain vardas + pavarde
    Browser ->> Browser: Show loading overlay
    Browser ->> Server: GET /voratinklis/expand-person?vardas=Jonas+Jonaitis
    Server -->> Browser: { nodes[], edges[] }
    Browser ->> Browser: Merge nodes pre-position new nodes at person node pos
    Browser ->> Browser: Run ForceAtlas2 + noverlap → compute final positions
    Browser ->> Browser: animateNodes (600ms, quadraticInOut) → final pos
    Browser ->> Browser: Hide loading overlay
```

---

## Components

### Component Map

```mermaid
graph TD
    subgraph Browser["Browser — two IIFE bundles"]
        BUNDLE["public/dist/voratinklis.js\n(esbuild bundle of voratinklis-bundle.js)\nSigma · graphology · forceAtlas2\nnoverlap · NodeImageProgram\n→ window.Voratinklis"]

        subgraph APP["public/dist/voratinklis-app.js\n(esbuild bundle of src/voratinklis-app.js)"]
            ICONS["src/voratinklis/icons.js\nMUI_ICON_PATHS\nmakeIconDataUri · getIconKey"]
            COLORS["src/voratinklis/colors.js\nNODE_COLOR · EDGE_COLOR\nnodeColor · hiddenEdgeTypes"]
            RENDERERS["src/voratinklis/renderers.js\ndrawNodeLabel · drawNodeHover"]
            GRAPHUTILS["src/voratinklis/graph-utils.js\nmergeGraphElements(dataGraph,getNodePos,data,fromNodeId)\nrebuildViewGraph(dataGraph,viewGraph,hiddenEdgeTypes)\nsyncPositionsToData(dataGraph,viewGraph)\nrunLayout(graph)\n★ testable without DOM"]
            LEGEND["src/voratinklis/legend.js\nbindLegendCheckboxes(renderer,hiddenEdgeTypes,rebuildAndRefresh)"]
            EXPANDUI["src/voratinklis/expand-ui.js\ncreateExpandUI({dataGraph,viewGraph,...})\n→ rebuildAndRefresh callback"]
            ENTRY["src/voratinklis-app.js ← esbuild entry\ncreates dataGraph + viewGraph\nSigma uses viewGraph\nwires clickNode + DOMContentLoaded"]
        end

        ENTRY --> ICONS
        ENTRY --> COLORS
        ENTRY --> RENDERERS
        ENTRY --> GRAPHUTILS
        ENTRY --> LEGEND
        ENTRY --> EXPANDUI
        BUNDLE -->|" window.Voratinklis "| ENTRY
    end

    subgraph Server["Server"]
        ROUTE["routes/voratinklis.js\nExpress router\nGET /voratinklis/:jarKodas\nGET /voratinklis/expand/:jarKodas\nGET /voratinklis/expand-person"]
        EXPAND["modules/voratinklis/expand.js\nexpandOrg · expandPerson\npure helpers: orgNode · personNode\ncontractNode · edge · mapPareigos\nmapRysioPobudis · mapFormosKodas"]
        VIEW["views/voratinklis/index.ejs\npage shell · legend HTML\ncheckboxes · Sigma container"]
    end

    subgraph Tests["Tests — node --test"]
        T_EXPAND["test/voratinklis/expand.test.js\nserver-side pure helpers\n(61 tests)"]
        T_GRAPHUTILS["test/voratinklis/graph-utils.test.js\nclient-side mergeGraphElements\nrebuildViewGraph: orphan removal · anchor logic\nposition restore · syncPositionsToData"]
    end

    ENTRY -->|" fetch /expand/:jk "| ROUTE
    ENTRY -->|" fetch /expand-person "| ROUTE
    ROUTE --> EXPAND
    ROUTE --> VIEW
    T_EXPAND -.->|" import "| EXPAND
    T_GRAPHUTILS -.->|" import "| GRAPHUTILS
```

### Module responsibilities

| File                             | Layer  | Purpose                                                                                                               | DOM required              |
|----------------------------------|--------|-----------------------------------------------------------------------------------------------------------------------|---------------------------|
| `src/voratinklis-bundle.js`      | Client | Bundles third-party npm packages; exposes `window.Voratinklis`                                                        | No                        |
| `src/voratinklis-app.js`         | Client | esbuild entry; creates `dataGraph` + `viewGraph`; Sigma uses `viewGraph`; wires events                                | Yes                       |
| `src/voratinklis/icons.js`       | Client | MUI SVG path map; `makeIconDataUri`; `getIconKey`                                                                     | No                        |
| `src/voratinklis/colors.js`      | Client | `NODE_COLOR`, `EDGE_COLOR`, `nodeColor`, `hiddenEdgeTypes` Set                                                        | No                        |
| `src/voratinklis/renderers.js`   | Client | `drawNodeLabel`, `drawNodeHover` — Sigma canvas callbacks                                                             | No (canvas ctx passed in) |
| `src/voratinklis/graph-utils.js` | Client | `mergeGraphElements(dataGraph,...)`, `rebuildViewGraph`, `syncPositionsToData`, `runLayout` — **pure, injected deps** | No ★                      |
| `src/voratinklis/legend.js`      | Client | `bindLegendCheckboxes(renderer, hiddenEdgeTypes, rebuildAndRefresh)`                                                  | Yes (queries DOM)         |
| `src/voratinklis/expand-ui.js`   | Client | `createExpandUI({dataGraph,viewGraph,...})` — async fetch + rebuild; returns `rebuildAndRefresh`                      | Yes                       |
| `modules/voratinklis/expand.js`  | Server | `expandOrg`, `expandPerson`, `expandProcurement`, all pure builder helpers                                            | No                        |
| `routes/voratinklis.js`          | Server | Express routes; calls `expandOrg`/`expandPerson`/`expandProcurement`; renders EJS                                     | No                        |
| `views/voratinklis/index.ejs`    | View   | HTML shell, inline CSS, legend overlay with checkboxes                                                                | —                         |

**Visual identity — node colours and icons:**

| Entity type          | `NODE_COLOR` key | Hex       | Icon (MUI)                            | Icon key                                           |
|----------------------|------------------|-----------|---------------------------------------|----------------------------------------------------|
| `OrganizationEntity` | `org`            | `#3b82f6` | Business / DomainAdd / AccountBalance | `PrivateCompany` / `PublicCompany` / `Institution` |
| `OrganizationEntity` | `orgStub`        | `#9ca3af` | Business                              | same                                               |
| `PersonEntity`       | `person`         | `#f97316` | Person                                | `Person`                                           |
| `ContractEntity`     | `contract`       | `#10b981` | HistoryEdu                            | `Contract`                                         |
| `ProcurementEntity`  | `procurement`    | `#8b5cf6` | Gavel                                 | `Procurement`                                      |

`ProcurementEntity` uses **purple** (`#8b5cf6`) — distinct from all current node colours. The MUI
`Gavel` icon path must be added to `MUI_ICON_PATHS` in `src/voratinklis/icons.js`, and `getIconKey`
must return `'Procurement'` for procurement nodes. `EDGE_COLOR` must add entries for `Procurement`
(`#8b5cf6`) and `Award` (`#8b5cf6`) edges.

**`ProcurementEntity` node sizing** — same tiers as `ContractEntity`, driven by `numatomaVerteEUR`:

| Estimated value | Node size |
|-----------------|-----------|
| < €100 K        | 8         |
| €100 K – €1 M   | 13        |
| ≥ €1 M          | 19        |

The single most impactful change for testability is the **dependency-injection signature** of
`mergeGraphElements`. Instead of closing over the module-level `graph` and `renderer`, it receives
them as parameters:

```js
// graph-utils.js (Phase 9 signature — hiddenEdgeTypes removed; dataGraph is a pure store)
export function mergeGraphElements(dataGraph, getNodePos, data, fromNodeId) { ...
}

export function rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes) { ...
} // returns newNodeIds[]
export function syncPositionsToData(dataGraph, viewGraph) { ...
}

export function runLayout(graph, forceAtlas2, noverlap) { ...
}
```

In production (`expand-ui.js`):

```js
mergeGraphElements(dataGraph, (id) => renderer.getNodeDisplayData(id), data, fromNodeId);
const newNodes = rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes);
syncPositionsToData(dataGraph, viewGraph);
```

In unit tests — no DOM or Sigma needed:

```js
import Graph from 'graphology';
import {mergeGraphElements, rebuildViewGraph, syncPositionsToData} from '../../src/voratinklis/graph-utils.js';

const dataGraph = new Graph({type: 'directed', multi: true});
const viewGraph = new Graph({type: 'directed', multi: true});
const getNodePos = () => null;

mergeGraphElements(dataGraph, getNodePos, data, null);
const newNodes = rebuildViewGraph(dataGraph, viewGraph, new Set(['Official']));
```

This allows testing:

- That `dataGraph` receives all edges unconditionally (no hidden filtering at merge time)
- That `rebuildViewGraph` removes orphan nodes (no visible edges) from `viewGraph`
- That anchor nodes (expanded, non-ContractEntity) survive even when all their edges are hidden
- That `ContractEntity` nodes disappear when `Order`/`Delivery` are in `hiddenEdgeTypes`
- That re-appearing nodes restore their `x`/`y` position from `dataGraph`
- That `syncPositionsToData` correctly copies layout coordinates back to `dataGraph`
- That newly added node IDs are returned by `rebuildViewGraph` (for `animateNodes` call site)

### Two-graph design

A `dataGraph` (permanent store) and a `viewGraph` (Sigma's rendered graph) are maintained separately:

- `dataGraph` — holds **all** fetched nodes and edges unconditionally. Updated only on expand fetches. Never passed to
  Sigma.
- `viewGraph` — passed to `new Sigma(viewGraph, ...)`. Rebuilt by
  `rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes)` after every expand or legend toggle.

**Anchor rule**: a node is always kept in `viewGraph` when
`attrs.expanded === true && attrs.entityType !== 'ContractEntity'`. ContractEntity nodes are not anchors and disappear
when all `Order`/`Delivery` edges are hidden.

**`rebuildViewGraph`**: computes the visible node set (anchors + nodes incident to non-hidden-type edges), syncs
nodes/edges in `viewGraph`, restores saved `x`/`y` from `dataGraph` when re-adding nodes, returns newly added node IDs
for `animateNodes`.

**`syncPositionsToData`**: after every layout pass, copies `x`/`y` from `viewGraph` → `dataGraph` so positions survive
the next rebuild.

**Animation cancel token**: `animateNodes` returns a cancel function stored in `cancelAnimation`. It is called before
each `rebuildViewGraph` to prevent writing attributes to nodes that were just dropped from `viewGraph`.

### Selection state

Single-node selection. Clicking a node sets `highlighted: true; selected: true` on both graphs (Sigma draws the
persistent ring via `drawNodeHover`). `nodeHiddenEdgeTypes: Map<nodeId, Set<string>>` stores per-node edge-filter
state — on first selection a new Set is initialised as a copy of `HIDDEN_BY_DEFAULT`. `currentHiddenSet()` returns the
selected node's Set or the global fallback; `rebuildAndRefresh` always uses `currentHiddenSet()`.

| Visual state       | Ring radius    | Fill                     | Stroke width | Stroke colour |
|--------------------|----------------|--------------------------|--------------|---------------|
| Hover only         | `nodeSize + 4` | `rgba(255,255,255,0.6)`  | `2`          | `data.color`  |
| Selected (± hover) | `nodeSize + 6` | `rgba(255,255,255,0.15)` | `5`          | `data.color`  |

### Node and edge sizing

**Org node size** — computed client-side from raw sodra fields stored in node attributes:

```js
Math.max(attrs.bendrasDraustujuSkaicius || 0, attrs.draustieji || 0, attrs.draustieji2 || 0, 1)
```

| Personnel | Node size |
|-----------|-----------|
| < 10      | 8         |
| 10 – 50   | 13        |
| 50 – 200  | 19        |
| > 200     | 28        |

`expandOrg` fetches raw sodra fields (`draustieji`, `draustieji2`) per org in a single flat query and stores them in
node attributes. `bendrasDraustujuSkaicius = draustieji + draustieji2` is computed client-side; it is **not** a DB
column.

**Contract / Procurement node size** (`contractSize`) and **Order / Delivery edge weight** (`edgeWeight`) — same
thresholds:

| Value         | Node size | Edge `size` |
|---------------|-----------|-------------|
| < €100 K      | 8         | 1           |
| €100 K – €1 M | 13        | 3           |
| > €1 M        | 19        | 6           |

Person nodes keep a fixed `size: 8`. `edgeWeight` is mirrored as a local helper in `modules/voratinklis/expand.js` so
`Order`/`Delivery` edges carry their `size` from the server payload.

---

## Out of Scope

- Contract node expansion (clicking a `ContractEntity` node to load the full contract) — v2
- Risk score colouring of nodes/edges
- Saving / sharing graph state via URL
- Toolbar "Balance" button triggering a full ForceAtlas2 pass — v2

---

## Tasks

> **Phases 1–12 complete.** Core infrastructure (routes, expand.js, Sigma canvas, icons), expand
> animations, loading overlay, edge/node type labels, legend checkboxes, two-graph architecture,
> per-node selection state, dynamic node/edge sizing, entity-types module, and SVG legend arrows are
> all implemented. See architecture sections above for current implementation state.

---

**Phase 13 — Details panel**

When a node is selected a compact details card appears in the **top-right** corner of the graph
canvas. It shows the 2–3 most useful attributes for the selected entity type and — where a
dedicated page exists — a prominent "open" link that navigates to that entity's full page.

#### Detail page routes (existing)

| Entity type          | Detail page URL pattern              | Example                                  |
|----------------------|--------------------------------------|------------------------------------------|
| `OrganizationEntity` | `/asmuo/{jarKodas}`                  | `/asmuo/171658927`                       |
| `ContractEntity`     | `/sutartis/{sutartiesUnikalusId}`    | `/sutartis/2008083561`                   |
|                      | `/viesiejiPirkimai/{pirkimoNumeris}` | `/viesiejiPirkimai/7676505` (if present) |
| `PersonEntity`       | *(no dedicated page)*                | — show attributes only, no link          |

> The `ContractEntity` node ID has the form `contract:{sutartiesUnikalusId}`. Strip the
> `contract:` prefix to get the URL segment for `/sutartis/…`.

#### Panel content per entity type

**OrganizationEntity:**

- Title: `pavadinimas`
- Sub-line: company code `jarKodas`
- Sub-line: employee count (only if sodra data is present: `draustieji + draustieji2`), e.g. `Darbuotojų: 47`
- Link (opens new tab): `/asmuo/{jarKodas}` — label `Peržiūrėti įmonę ↗`

**ContractEntity:**

- Title: `pavadinimas` (full contract title — let it wrap)
- Sub-line: contract value formatted as `€1.2M`, `€450K`, etc. (use `formatContractValue`)
- Link (opens new tab): `/sutartis/{sutartiesUnikalusId}` — label `Peržiūrėti sutartį ↗`
- Link (opens new tab, **only when `pirkimoNumeris` is not null**): `/viesiejiPirkimai/{pirkimoNumeris}` — label
  `Peržiūrėti pirkimą ↗`

**ProcurementEntity:**

- Title: `pavadinimas` (let it wrap)
- Sub-line: estimated value formatted as `€1.2M`, `€450K`, etc. (use `formatContractValue`)
- Sub-line: `statusas` (e.g. "Nustatytas laimėtojas", "Baigtas")
- Link (opens new tab): `/viesiejiPirkimai/{pirkimoId}` — label `Peržiūrėti pirkimą ↗`

**PersonEntity:**

- Title: `vardas + " " + pavarde`
- No detail page link (no dedicated person page exists in viespirkiai)

#### UI/UX requirements

- Panel is **hidden** by default (HTML `hidden` attribute).
- Panel appears when a node is **selected** (same click that sets `selected: true`).
- Panel is **cleared and hidden** when selection is dismissed (`deselectAll`).
- Panel is positioned **top-right** of the graph canvas using `position: absolute; top: 12px; right: 12px`.
- Styled as a white card with subtle shadow and `max-width: 240px`.
- The "open" link opens in a **new tab** (`target="_blank" rel="noopener"`).
- Panel must not overlap the legend (legend is on the left side).

#### Architecture

New client-side module **`src/voratinklis/details-panel.js`** with two exported functions:

```js
export function showNodeDetails(nodeId, attrs) { …
}

export function hideDetails() { …
}
```

`showNodeDetails` builds inner HTML conditionally on `attrs.entityType` and sets `hidden = false`.
`hideDetails` sets `hidden = true`. Both are imported in `expand-ui.js` and called from `selectNode`
and `deselectAll`.

`formatContractValue` is server-side only (`modules/voratinklis/expand.js`). Duplicate the same pure
function locally in `details-panel.js` (< 5 lines, no import needed).

#### Tasks

- [ ] **`modules/voratinklis/expand.js`**: add `s."pirkimoNumeris"` to both `asBuyerRes` and
  `asSellerRes` SQL queries; pass `pirkimoNumeris: row.pirkimoNumeris || null` into `contractNode`;
  update `contractNode` factory to store `pirkimoNumeris` in attributes.

- [ ] **`views/voratinklis/index.ejs`**: add `<div id="voratinklis-details" hidden></div>` inside
  `#voratinklis-wrapper` (after `#voratinklis-legend`); add CSS: absolute top-right card, white
  background, shadow, `max-width: 240px`, padding 10px, `font-size: 0.85rem`, border-radius, `z-index: 20`.

- [ ] **`src/voratinklis/details-panel.js`** (new): implement `showNodeDetails(nodeId, attrs)` and
  `hideDetails()`; local `formatContractValue(verte)` helper; entity-specific HTML per
  `attrs.entityType`; `pirkimoNumeris` link only when non-null.

- [ ] **`src/voratinklis/expand-ui.js`**: import `showNodeDetails`, `hideDetails`; call
  `showNodeDetails(id, viewGraph.getNodeAttributes(id))` in `selectNode`; call `hideDetails()` in
  `deselectAll`.

- [ ] **Build** with `npm run build` — clean; all tests passing.

- [ ] **Browser smoke-test**:
    - Select an org node → panel shows name, jarKodas, optional employee count, link to `/asmuo/…`
    - Select a contract node → panel shows title, value, link to `/sutartis/…`; second link when `pirkimoNumeris`
      present
    - Select a person node → panel shows full name, no link
    - Select a procurement node → panel shows title, estimated value, statusas, link to `/viesiejiPirkimai/…`
    - Deselect (click canvas) → panel disappears

---

**Phase 14 — ProcurementEntity graph nodes**

Add `ProcurementEntity` as a first-class node type. When an org is expanded as a **buyer**, up to 20
of its highest-value procurement notices appear as purple hub nodes connected by `Procurement` edges.
Clicking a procurement node expands it to reveal winning seller orgs via `Award` edges.

#### Data model

| Attribute          | Source                              | Notes                                             |
|--------------------|-------------------------------------|---------------------------------------------------|
| `id`               | `procurement:{pirkimoId}`           | Stable across page loads                          |
| `entityType`       | `'ProcurementEntity'`               |                                                   |
| `pirkimoId`        | `viesiejiPirkimai.pirkimoId`        | Used for expansion and detail page link           |
| `pavadinimas`      | `viesiejiPirkimai.pavadinimas`      | Procurement title                                 |
| `numatomaVerteEUR` | `viesiejiPirkimai.numatomaVerteEUR` | Estimated total value                             |
| `statusas`         | `viesiejiPirkimai.statusas`         | e.g. "Nustatytas laimėtojas"                      |
| `pirkimoBudas`     | `viesiejiPirkimai.pirkimoBudas`     | e.g. "Atviras konkursas"                          |
| `size`             | `contractSize(numatomaVerteEUR)`    | Same tiers as ContractEntity (8 / 13 / 19)        |
| `expanded`         | `false` initially                   | Set to `true` after `expandProcurement` is called |

**Edges from `expandOrg` (buyer side)**: `Procurement` edge `org:{buyerJk}` → `procurement:{pirkimoId}`, label =
`pirkimoBudas`.

**Edges from `expandProcurement` (winner orgs)**: `Award` edge `procurement:{pirkimoId}` → `org:{tiekejoKodas}`, label =
formatted total `verte` sum for that seller.

#### Tasks

- [ ] **`modules/voratinklis/expand.js`**:
    - Add `procurementNode(row)` factory:
      `{ id, entityType, pirkimoId, pavadinimas, numatomaVerteEUR, statusas, pirkimoBudas, size, expanded: false }`.
    - In `expandOrg`: query
      `SELECT pirkimoId, pavadinimas, numatomaVerteEUR, statusas, pirkimoBudas FROM viesiejiPirkimai WHERE jarKodas = $jk ORDER BY numatomaVerteEUR DESC NULLS LAST LIMIT 20`;
      emit `procurementNode` + `Procurement` edge per result.
    - Add `expandProcurement(pirkimoId)`: query
      `SELECT DISTINCT s.tiekejoKodas, j.pavadinimas, SUM(s.verte) as totalVerte FROM sutartys s LEFT JOIN jarCsv j ON j.jarKodas::text = s.tiekejoKodas WHERE s.pirkimoNumeris = $1 GROUP BY s.tiekejoKodas, j.pavadinimas`;
      return org stub nodes + `Award` edges.

- [ ] **`src/voratinklis/entity-types.js`**: add `isProcurementNode(attrs)` predicate and export `Procurement` entity
  type constant.

- [ ] **`src/voratinklis/colors.js`**: add `procurement: '#8b5cf6'` to `NODE_COLOR`; add `Procurement: '#8b5cf6'` and
  `Award: '#8b5cf6'` to `EDGE_COLOR`; update `nodeColor()`.

- [ ] **`src/voratinklis/icons.js`**: add MUI `Gavel` icon path to `MUI_ICON_PATHS`; update `getIconKey` to return
  `'Procurement'` for procurement nodes.

- [ ] **`routes/voratinklis.js`**: add `GET /voratinklis/expand-procurement/:id` route (before `/:jarKodas`); calls
  `expandProcurement(req.params.id)`; returns JSON.

- [ ] **`src/voratinklis/expand-ui.js`**: handle procurement node click — fetch
  `/voratinklis/expand-procurement/{pirkimoId}`, merge, mark `expanded: true`; same in-flight deduplication as
  org/person.

- [ ] **`views/voratinklis/index.ejs`**: add `Procurement` and `Award` legend rows with purple arrow SVGs.

- [ ] **`src/voratinklis/details-panel.js`**: add `ProcurementEntity` branch to `showNodeDetails` (can be done together
  with Phase 13).

- [ ] **Tests** (`test/voratinklis/expand.test.js`): add tests for `procurementNode`, `expandProcurement`, `Procurement`
  edge structure.

- [ ] **Build** with `npm run build` — clean; all tests passing.

- [ ] **Browser smoke-test**:
    - Expand a buyer org → purple procurement nodes appear
    - Click a procurement node → winner seller org stubs appear via `Award` edges
    - Select a procurement node → details panel shows title, estimated value, statusas, link

---

1. **ForceAtlas2 in browser**: `graphology-layout-forceatlas2` runs synchronously and blocks the main
   thread for large graphs. For large graphs (>200 nodes) a Web Worker is recommended. For v1,
   synchronous with a capped iteration count is acceptable.

2. **Search UX on `/voratinklis`**: Eliminated. Entry is exclusively via `/voratinklis/:jarKodas`
   (linked from `/asmuo/`). ✓ Resolved.

3. **Header nav link for `/voratinklis`**: Keep pointing to `/voratinklis/` — shows 404 "įmonė nenurodyta"
   when clicked directly. This is intentional. ✓ Resolved.

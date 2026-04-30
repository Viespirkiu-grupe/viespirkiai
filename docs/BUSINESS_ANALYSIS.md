# Business Analysis: Voratinklis as a Risk Intelligence Tool

## Table of Contents

1. [Overview](#overview)
2. [How Voratinklis Benefits viespirkiai](#how-voratinklis-benefits-viespirkiai)
    - [Alignment with Risk Intelligence Principles](#alignment-with-risk-intelligence-principles)
    - [OSINT Aggregation](#osint-aggregation)
    - [Risk Patterns the Graph Exposes](#risk-patterns-the-graph-exposes)
    - [Visual Risk Triage](#visual-risk-triage)
    - [Interactive, Iterative Investigation](#interactive-iterative-investigation)
3. [Recommended Improvements](#recommended-improvements)
    - [1. Risk Scoring](#1-risk-scoring--the-critical-missing-layer)
    - [2. Temporal Dimension](#2-temporal-dimension)
    - [3. Shareable Graph State](#3-shareable--permalink-graph-state)
    - [4. Contract Node Expansion](#4-contract-node-expansion)
    - [5. Known-Fraud Pattern Auto-Detection](#5-known-fraud-pattern-auto-detection)
    - [6. Person Identity Robustness](#6-person-identity-robustness)
    - [7. Export for Investigation Reports](#7-export-for-investigation-reports)
    - [8. Depth and Path Controls](#8-depth-and-path-controls)
4. [Summary](#summary)

---

## Overview

This document analyses the [Voratinklis](./VORATINKLIS.md) interactive procurement network graph
feature through the lens of **Risk Intelligence Systems**, **FICO Falcon**, **Open Source
Intelligence (OSINT)**, and **public procurement risk prevention**. It covers both the value the
feature already delivers and the improvements that would elevate it from a visualisation tool into
an active risk intelligence platform.

---

## How Voratinklis Benefits viespirkiai

### Alignment with Risk Intelligence Principles

FICO Falcon's core technique is linking transactions to entities and tracing hidden networks to
surface anomalies that are invisible in any single record. Voratinklis applies the same paradigm to
public procurement: it links contracts (transactions), companies (entities), and persons (beneficial
owners, directors, spouses) into a traversable graph. A compliance analyst, journalist, or
anti-corruption investigator can in minutes see what previously required hours of manual
cross-referencing across separate database pages.

Before Voratinklis, viespirkiai surfaced procurement data *per entity* — one company page, one
person page, one contract page. Voratinklis is the first feature that makes the **network of
relationships** between entities visible at once, which is where procurement fraud lives.

### OSINT Aggregation

Voratinklis is an OSINT aggregation surface. It fuses four public data sources into a single
interactive view:

| Data source                      | What it contributes                                                                |
|----------------------------------|------------------------------------------------------------------------------------|
| **PINREG declarations**          | Conflict-of-interest disclosures — employment, board roles, shareholdings, spouses |
| **JAR company registry**         | Company metadata — legal form, name                                                |
| **Sodra**                        | Employment / social insurance headcount (Phase 12)                                 |
| **Public procurement contracts** | Contract titles, values, buyer/seller relationships                                |

Assembling fragmented public records to reveal non-obvious relationships is precisely the OSINT
playbook. Each data source alone is insufficient; their intersection is where risk signals appear.

### Risk Patterns the Graph Exposes

| Risk pattern                        | How Voratinklis surfaces it                                                                                                                                                                |
|-------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Conflict of interest**            | A public official who is a director at a supplier appears as a `Director` edge connecting both the contracting authority and the supplier — visible in a single node expansion             |
| **Nepotism / spouse relationships** | `Spouse` edges between a procurement decision-maker and a supplier employee are a first-class edge type, not a buried footnote                                                             |
| **Procurement cartel / ring**       | Expanding a person who sits on the boards of multiple competing suppliers reveals them as one node connected to all those organisations — the classic "common controller" cartel indicator |
| **Shell company detection**         | Expanding an org reveals whether it has employees (Sodra-weighted node size in Phase 12) and contract volume — a company with 1 employee and €5 M in contracts is immediately anomalous    |
| **Beneficial ownership tracing**    | Person-centric expansion (`expand-person`) follows the "follow the money" OSINT technique: contract winner → director → their other companies → their other contracts                      |

### Visual Risk Triage

Phase 12's contract-value-weighted edges and employee-count-weighted org nodes introduce the core
visual encoding used in risk intelligence dashboards: **size and thickness encode significance**.
A thin org node (few employees) connected to a thick high-value contract edge is immediately
anomalous without reading any numbers. This is the same principle behind FICO Falcon's risk-score
colour coding and i2 Analyst's Notebook's visual link charts.

### Interactive, Iterative Investigation

Risk intelligence platforms — FICO Falcon, Palantir, i2 Analyst's Notebook — are fundamentally
interactive graph tools because real investigations follow unexpected threads. Voratinklis adopts
the same model: an analyst starts at one company, follows a suspicious person, discovers that person
sits on three other boards, and continues expanding. No other page in viespirkiai supports this
iterative workflow. The two-graph architecture (Phase 9) and per-node legend filtering (Phase 11)
give analysts control over what they see without losing the underlying data — a design that mirrors
professional link-analysis tools.

---

## Recommended Improvements

### 1. Risk Scoring — the Critical Missing Layer

> Currently listed as **Out of Scope** in `VORATINKLIS.md`.

This is the single highest-value addition. The difference between a visualisation and a risk
intelligence system is that the latter **generates alerts** — it tells the analyst where to look,
not just what to look at once they arrive.

Even a simple rule-based score computed at `expandOrg` time and stored as a node attribute would
give Voratinklis FICO Falcon-level signal:

| Signal                                                  | Threshold           | Risk level |
|---------------------------------------------------------|---------------------|------------|
| Supplier winning share from a single buyer              | > 60 %              | High       |
| Person appearing as director/shareholder simultaneously | > 4 companies       | High       |
| Company employee count vs. annual contract value        | < 5 staff, > €500 K | Medium     |
| Company age at time of first contract award             | < 6 months          | Medium     |

Nodes breaching thresholds could receive a red ring or colour shift. This would transform
Voratinklis from a fraud *reporting* tool into a fraud *alerting* tool — the defining characteristic
of FICO Falcon.

### 2. Temporal Dimension

The underlying data already contains time: `rysioPradzia` (relationship start date on PINREG rows)
and contract signing dates (`sudarymoPasirasymoData`). Voratinklis currently presents all
relationships as static.

Two critical risk signals require time:

- **Company incorporated just before the procurement** — company creation date (from JAR) vs.
  contract award date.
- **Director joining the supplier board shortly before contract award** — `rysioPradzia` vs.
  contract signing date.

Including `rysioPradzia` on person edges and `sudarymoPasirasymoData` on contract nodes in the
`expandOrg` payload would let analysts spot suspicious timing visually. A `Director` edge labelled
"2 months before contract" is a major red flag that no static report surfaces.

### 3. Shareable / Permalink Graph State

> Currently listed as **Out of Scope** in `VORATINKLIS.md`.

For an OSINT and risk intelligence use case, URL-based state sharing is not a cosmetic feature — it
is essential. Investigations involve multiple analysts, and findings must be shared with colleagues,
prosecutors, or oversight bodies.

**Minimal implementation:** serialize the set of expanded node IDs into the URL hash:

```
/voratinklis/110053842#expand=org:110078991,person:jonas+jonaitis
```

On page load, replay the expansion sequence automatically. This requires no server changes — pure
client-side URL parsing in `voratinklis-app.js`.

### 4. Contract Node Expansion

> Currently listed as **Out of Scope (v2)** in `VORATINKLIS.md`.

Clicking a `ContractEntity` to load the full contract detail is a significant gap for risk
analysis. The contract itself carries important risk signals that are not visible in the graph:

- **Award procedure type** — competitive tender vs. direct award (sole source)
- **Number of bids received** — one bid means no real competition
- **Contract amendments** — post-award value increases are a classic fraud mechanism

Direct-award contracts to a supplier connected to the buyer's officials are a primary procurement
fraud indicator. Without drilling into the contract from the graph, an analyst must leave Voratinklis
and navigate to the contract page manually, breaking the investigation flow.

### 5. Known-Fraud Pattern Auto-Detection

Voratinklis currently surfaces raw relationships and leaves interpretation entirely to the analyst.
A higher-leverage design would **auto-detect and annotate known structural fraud patterns** before
the analyst starts exploring — the same way FICO Falcon flags transactions matching known fraud
typologies.

Patterns detectable from data already in viespirkiai:

| Pattern                      | Detection logic                                                                                     |
|------------------------------|-----------------------------------------------------------------------------------------------------|
| **Common controller cartel** | Two orgs that submitted bids for the same tender share a director/shareholder                       |
| **Revolving door**           | A person previously employed at the contracting authority is now a director at the winning supplier |
| **Subcontracting loop**      | Org A wins a contract; org B is a declared supplier to A; B's director is connected to A            |
| **Family award**             | Contract buyer's procurement officer has a `Spouse` edge to the winning supplier's director         |

These patterns can be computed server-side at `expandOrg` time and stored as node/edge attributes:

```js
// e.g., on a PersonEntity node
riskFlags: ['REVOLVING_DOOR', 'COMMON_CONTROLLER']
```

The client renders `riskFlags` as visual annotations (icon overlay, node border colour) without
requiring any graph architecture changes — the two-graph design already supports arbitrary node
attributes.

### 6. Person Identity Robustness

The spec intentionally uses **name-only identity** for person nodes
(`person:{vardas} {pavarde}`), merging all declarations for the same name into one node. This is
correct behaviour when the same physical person appears in multiple declarations, but it introduces
a risk of **false positive merges** — two different people who happen to share a common Lithuanian
name (e.g., "Jonas Jonaitis") would appear as one node, creating phantom relationships that could
incorrectly flag innocent parties.

The spec should document this limitation explicitly and propose a v2 path: if PINREG declarations
ever expose a stable person identifier (`asmensKodas` or equivalent), use it as the primary key
with the full name as a display label and fallback. Until then, analysts should treat person node
merges as provisional when names are common.

### 7. Export for Investigation Reports

Anti-corruption investigations produce reports submitted to prosecutors, oversight bodies, or
published as journalism. Voratinklis has no export mechanism. Two additions would make it useful
as an evidence-gathering tool, not just a visual exploration tool:

- **Graph image export** — SVG or PNG of the current Sigma viewport, suitable for embedding in
  reports.
- **Node/edge CSV export** — all nodes and edges currently in `dataGraph`, with their attributes,
  so analysts can perform further analysis in Excel or a dedicated link-analysis tool.

Neither requires server changes — both are pure client-side operations on the `dataGraph` instance.

### 8. Depth and Path Controls

Currently the graph grows unboundedly — each expansion can add tens of new nodes, and a deep
investigation can produce an unmanageable hairball. Professional OSINT and link-analysis platforms
address this with two complementary controls:

- **Hop depth limiter** — "expand only relationships up to N hops from the root node" — keeps the
  graph focused on the immediate network of a target entity.
- **Shortest path query** — "find the shortest relationship path between company X and company Y"
  — directly relevant to proving that two apparently unrelated companies are connected through a
  chain of shared persons.

Both are computable client-side on `dataGraph` using graphology's built-in shortest-path utilities
(`graphology-shortest-path`), which is already a transitive dependency of the bundle.

---

## Summary

Voratinklis is a strong foundation for a risk intelligence layer on top of viespirkiai's
procurement data. Its entity-and-relationship graph model aligns directly with proven fraud
detection methodology: FICO Falcon entity networks, OSINT link analysis, and i2 Analyst's Notebook
visual investigation workflows.

The feature already delivers:

- Network-level visibility across contracts, companies, and persons that was previously impossible
  without manual cross-referencing.
- First-class modelling of high-risk relationship types (spouses, directors, shareholders).
- Visual encoding of financial significance through contract-value-weighted edges and
  employee-count-weighted nodes.
- An interactive, iterative investigation workflow suited to following unexpected threads.

The primary gap between **"good visualisation"** and **"active risk intelligence tool"** is the
absence of:

1. **Risk scoring** — tell analysts where to look, not just what to look at.
2. **Temporal analysis** — suspicious timing is as important as suspicious relationships.
3. **Automatic fraud pattern detection** — match known typologies before the analyst starts.
4. **Shareable state** — investigations are collaborative; findings must be reproducible.

All four are achievable by building incrementally on the data and architecture already specified in
`VORATINKLIS.md`, without requiring new data sources or fundamental architectural changes.

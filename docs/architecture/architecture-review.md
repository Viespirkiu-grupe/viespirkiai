# Viešpirkiai — Principal Architecture Review (Pain Points)

> **Status:** Phase 2a: findings only. Recommendations and target architecture come in a later phase (`architecture-upgrade.md`).
> **Baseline:** [`architecture-current.md`](architecture-current.md) and repository state at `d4451301` (2026-09-12).
> **Context:** The system was built by a very small team without formal software-engineering training, mostly through agentic (AI-assisted) development. That context matters. Many findings below are not individual mistakes. They are the *predictable* result of producing a lot of code fast with no automated guard-rails to hold the structure together.

---

## 1. Executive summary

Viešpirkiai is an impressive system for its team size. It has roughly **100 background tasks**, **30+ upstream data sources**, **eight kinds of data store**, public web, MCP and open-data interfaces, and about **150k lines** of JavaScript, TypeScript and Astro. That is written in 14 months (1,195 commits, with 295 in August 2026 alone). The product works and delivers real public value.

The architecture has, however, grown by **accretion rather than design**. It has reached the point where the cost of each change, and the risk of each deployment, is rising faster than the team's capacity to absorb it. The five most serious problems:

1. **Data can't be reliably recovered.** No PostgreSQL backup procedure is defined in the repository. The only copy of the data is a streaming replica, which replicates deletions and corruption too. The database schema cannot be rebuilt from the repository.
2. **There is no automated safety net.** CI only builds a Docker image. The 153 test files never run automatically. There is no lint, no type-check gate and no deployment pipeline. What runs in production is the image *plus* whatever is checked out on the server.
3. **Security exposure is known but unmanaged.** `npm audit` reports 1 critical and 5 high vulnerabilities. One of them (`xlsx`) has no fix and parses spreadsheets from untrusted external sources. A search API key sits in git history, and API keys are passed in query strings.
4. **One server does everything.** Database, search, web site, 18 concurrent scraping jobs and analytics all compete for the same server (`lempa`). Batch workloads can degrade the public site, and a single hardware failure takes everything down.
5. **Module boundaries don't exist in practice.** SQL is written directly in pages. Library modules double as CLI scripts and call `process.exit`. The same code is deployed through two different lifecycles (a Docker image and a bare git checkout).

The common root cause: **agentic development optimises locally** (make this feature work) **but nothing optimises globally** (keep the system coherent). Without tests in CI, enforced conventions and explicit boundaries, each AI-assisted change is individually reasonable and collectively entropic.

---

## 2. What is working well

A fair review starts here. These are foundations to *keep*.

- **Durable queues in PostgreSQL, with NATS used only for wake-up hints.** This is the correct reliability model. A lost NATS message never loses work.
- **Graceful shutdown** in both processes, plus a multi-stage, dev-dependency-free Docker image.
- **Configuration is validated** with a zod schema, and feature flags have fallbacks (Typesense or Quickwit unavailable → PostgreSQL search).
- **Explicit egress control** for scraping: registered proxies, and an instrumented HTTP client that redacts secrets from its logs.
- **Unusually strong observability for a small team:** SQL and scrape logs in Quickwit, `/statistika`, `/metrics`.
- **Table meaning is documented inside the database** (`COMMENT ON`), and schema tooling exists.
- **Tests exist:** 153 files, with fixtures for risk indicators. The habit is there; the enforcement is not.

---

## 3. Pain-point map

| # | Pain point | Areas affected | Severity | Likelihood of harm |
|---|---|---|---|---|
| P1 | Data can't be reliably recovered and the schema can't be rebuilt | Sustainability, operations | 🔴 Critical | Medium → certain over time |
| P2 | No automated quality gate or reproducible deployment | Engineering, reliability | 🔴 Critical | High |
| P3 | Unmanaged security exposure | Security | 🔴 Critical | Medium |
| P4 | Everything on one server; no workload isolation | Reliability, performance, operations | 🟠 High | High |
| P5 | No module boundaries | Maintainability | 🟠 High | Certain (already happening) |
| P6 | Home-grown infrastructure the team must maintain forever | Sustainability, maintainability | 🟠 High | Certain |
| P7 | Too many data stores kept consistent by hand | Data integrity, operations | 🟠 High | Medium |
| P8 | Knowledge erosion and documentation drift amplified by AI-assisted development | Maintainability, bus factor | 🟠 High | Certain |
| P9 | Weak typing where most of the logic lives | Engineering, correctness | 🟡 Medium | High |
| P10 | Dependency and toolchain fragility | Security, build reliability | 🟡 Medium | Medium |
| P11 | Configuration spread across seven files | Operations, onboarding | 🟡 Medium | High |
| P12 | The public web process is also an internal control plane | Security, reliability | 🟡 Medium | Medium |

Every finding below follows the same format: what was observed, the evidence, why it matters, and how agentic development contributed.

---

## 4. Findings

### P1 — Data can't be reliably recovered and the schema can't be rebuilt 🔴

**Observation**
- No `pg_dump`, `pg_basebackup`, pgBackRest, WAL-G or Barman configuration, and no restore runbook, anywhere in the repository. The only secondary copy of PostgreSQL is an off-site **streaming replica**, and a replica faithfully replicates `DROP TABLE`, bad `UPDATE`s and logical corruption.
- **The schema can't be rebuilt from the repository.**
  - `migrations/` holds 15 SQL files with 15 `CREATE TABLE` statements.
  - The local schema dump (`dbSchema/`, which is git-ignored) has about **246** table and routine files.
  - There is no migration runner and no record of which migrations have been applied.
  - Tables are also created at runtime from application code (10 files, for example `src/lib/infoBanner.ts` and the sidecar and vector SQLite stores).
- A script exists to *reverse-engineer which code writes to which table* (`scripts/aptiktiLenteliuRasytojus.js`). This shows the team has lost track of who owns which data.
- **Sidecar SQLite stores** (OCR results, extracted file content, e-TAR and LITEKO payloads) live in a single directory on one host (`/flashas/viespirkiai`). Nothing in the repository backs them up. S3 backup covers only the *raw files*, not these derived stores.
- The **production `compose.yml` is git-ignored** (since `a6e03063`), so even the infrastructure definition can't be recovered from the repository.

**Why it matters**
This is the one class of failure the project may not survive. The value of Viešpirkiai is years of collected, cleaned and OCR-processed data, much of which **can no longer be re-scraped** (sources change, delete records or block access). A single `DELETE` without `WHERE`, a buggy migration, ransomware or a disk failure on `lempa` could be unrecoverable. Separately, standing up a clean environment (new contributor, disaster recovery, staging) is impossible without copying a production database.

**How agentic development contributed:** AI agents modify schemas with ad-hoc `ALTER`s against a live database and rarely produce ordered, idempotent migrations unless the repository enforces it. Backups are invisible work that no feature prompt ever asks for.

---

### P2 — No automated quality gate or reproducible deployment 🔴

**Observation**
- The only CI workflow is `build-image.yml`. **Tests, `astro check` and linting never run automatically.** No lint tooling exists at all.
- The 153 test files cover useful areas, but can only run serially (`maxWorkers: 1`, 120 s timeouts), and some depend on a live database.
- **Deployment is not reproducible.**
  - The frontend container bind-mounts `./modules` and `./public` from the host checkout, so the running code is the image plus whatever `git pull` last produced on `lempa`.
  - CI pushes a GHCR image, but compose builds locally. There are two artifacts and no single source of truth.
  - The taskRunner is not packaged at all: it is `node tasks/index.js` under a bash restart loop.
- There is no staging environment, no rollback procedure and no versioned releases. The footer commit hash is the only trace of what is deployed.

**Why it matters**
Every change goes to production unverified, and the web server and batch processes can end up running *different code versions* of the same modules. Regressions surface as user-visible failures or, worse, silently corrupted data from a background job. At the current pace (about 10 files and 300 lines per commit, around 70 commits a week at peak), manual verification cannot keep up.

**How agentic development contributed:** Agents generate tests willingly, but a test that never runs is decoration. Without a CI gate, "tests pass" becomes an unverifiable claim in a chat transcript. The volume of change per commit is also well beyond what a human reviewer can meaningfully check.

---

### P3 — Unmanaged security exposure 🔴

**Observation**
- `npm audit --omit=dev`: **7 vulnerabilities (1 critical, 5 high, 1 moderate)**.
  - Critical: `astro`.
  - High: `@xmldom/xmldom`, `sharp`, `js-yaml`, `svgo`, and **`xlsx`** (prototype pollution and ReDoS, **no fix available**: the npm package is abandoned upstream).
  - `xlsx` and `xmldom` are used to **parse files downloaded from external sources** (VPT and CPVA spreadsheets, XML notices). That is exactly the input these vulnerabilities target.
- **A secret in git history:** a Typesense admin API key is hard-coded in `typesense/compose.yml` in 3 commits (`96921837`, `4677a5c1`, `32e0678f`). The repository is (or may become) public.
- **API keys are accepted in query strings** (`?apiKey=` on the OCR endpoints). Query strings end up in Cloudflare, proxy and request logs.
- **No application-level rate limiting.** `CLAUDE.md` describes a rate-limit toggle, but no rate-limiting code exists; only an optional bot challenge. The Cloudflare edge is the only protection for expensive search and SQL-backed pages.
- The **MCP `execute_query` tool** lets anonymous clients run SQL. Its protection is a 302-line SQL-parser whitelist (`validateSql.ts`, **36 changes in 6 months**, one of the most-edited files) plus a read-only role. Parser-based SQL whitelisting is notoriously bypassable. If the database role is not strictly minimal, the parser is the only barrier.
- **Internal infrastructure details are hard-coded** in 18 places (`10.1.10.x`, `192.168.255.99`, `/flashas/...`).
- Public site, OCR-worker API, file-proxy authentication API and sidecar data API all run in **one internet-facing process** (see P12).

**Why it matters**
This is a transparency project that scrutinises public procurement. It is a plausible target for hostile actors, and a breach would be reputationally disproportionate. The combination "untrusted file parsing + vulnerable parser + same host as the primary database" is the most concrete risk.

**How agentic development contributed:** Agents pick whichever library they know best (`xlsx` is the most common answer in training data despite being abandoned). They also copy existing patterns, such as API keys in query strings, and reinforce them with every change.

---

### P4 — Everything on one server; no workload isolation 🟠

**Observation**
- `lempa` hosts PostgreSQL (10 GB), Quickwit (6 GB), pgAdmin, PgBouncer, Typesense, the public frontend, the taskRunner (18 concurrent jobs: scraping, parsing, indexing, LLM calls), CLI jobs, NATS, Tor, cloudflared and Plausible (with ClickHouse). Memory limits of the main stack alone add up to about 21 GB, and the taskRunner and CLI jobs have **no limits**.
- Heavy batch work (reindexing Quickwit, bulk imports, archive extraction, vector jobs) shares CPU, memory, disk I/O and the PgBouncer pool with user-facing requests.
- **Process supervision is minimal.**
  - The taskRunner runs under a bash `while true` loop with no memory limit, no health check and no alerting.
  - Neither process registers `unhandledRejection` or `uncaughtException` handlers.
  - The runtimes of NATS, Tor and cloudflared are undefined (see the deployment view).
- The taskRunner exposes **no health or metrics endpoint**. A stuck worker is only noticed indirectly.

**Why it matters**
Performance incidents on the public site will be hard to diagnose ("is it traffic or a backfill?"). A single disk, memory or kernel failure on `lempa` is a full outage and potentially a data-loss event (P1). A single memory leak in an unbounded batch job can take PostgreSQL down with it.

---

### P5 — No module boundaries 🟠

**Observation**
- **SQL is everywhere:** 1,093 `.query(` call sites. **21 pages** in `src/pages` execute SQL directly. There is no data-access layer, so schema changes require searching the whole codebase (hence the table-writer detection script).
- **Library code and CLI entry points are mixed.**
  - 115 files under `modules/` are also directly runnable scripts (`import.meta.url === file://…`).
  - **87 files under `modules/` call `process.exit`.** If one of these files is imported by the web server and hits that path, it kills the web server.
- **`modules/*` is a shared kernel with no layering.** The web server, the taskRunner and the CLI jobs import the same files, with different lifecycles and different deployment mechanisms (P2).
  - Scraping, parsing, persistence, indexing and presentation helpers sit side by side.
  - CLAUDE.md states the rule "never import task runner code into the web server", but nothing enforces it.
- **Very large files and mixed responsibilities:** 11 source files exceed 600 lines. `modules/mcp/tools/getSchema.ts` (1,010 lines) is a hand-maintained schema description. Several `.astro` pages exceed 500 lines of mixed markup, logic and data access.
- **Organised by data source, not by domain capability.** `modules/` has 50 folders (`sutartys`, `vpmSutartys`, `cvpp`, `cvppDumpAtn1`, `viesiejiPirkimai`, `neskelbiamosDerybos`, `ppa`…). The concepts *procurement*, *contract*, *organisation* and *document* are scattered across many of them, and the code is full of comments explaining renames ("buvęs `public.jar`", "iškeltas į `rcJar` schemą").

**Why it matters**
Change cost grows superlinearly: every feature touches pages, modules and SQL in many places, and every refactor risks breaking an unrelated process. No one, human or AI, can reason about the impact of a change without reading large parts of the codebase. That also makes AI assistance progressively *less* effective, because relevant context no longer fits in a prompt.

**How agentic development contributed:** Agents put code where the prompt is focused ("add this to the page"). They also resolve ambiguity by duplicating rather than refactoring. For example, `extractApiKey` is copied between OCR endpoints, and stale-reservation cleaners are re-implemented per queue.

---

### P6 — Home-grown infrastructure the team must maintain forever 🟠

**Observation.** The team has built and must maintain its own versions of:

| Home-grown component | Established alternative category |
|---|---|
| `runner/TaskRunner.js` scheduler (cron, priorities, cooldowns, nudges, dynamic workers) | Job queue / workflow engine |
| PostgreSQL work queues, reinvented per domain (`SKIP LOCKED` in **28 files**, **4 separate "stale reservation" cleanup tasks**) | Job queue library on PostgreSQL |
| Sidecar KV store: zstd SQLite files with a worker-thread pool and a remote HTTP read API | Object storage / KV / PostgreSQL TOAST |
| Configuration system: `config.js` + env map + zod + typings | Standard 12-factor config |
| HTTP-to-SOCKS proxy server, proxy registry, instrumented fetch | Egress proxy |
| Search abstraction over **three** search back-ends (Typesense, Quickwit, PostgreSQL fallback) | One search engine |
| OG image renderer, SQL sandbox for MCP, schema description tool | — |

**Why it matters**
Each component is small and clever. Together they form a **platform the team never set out to build**, with no tests of its failure modes, no documentation of its guarantees, and no community fixing its bugs. Sustainability depends on the one or two people who understand how `TaskRunner`, the queue tables, the sidecar stores and NATS nudges interact.

**How agentic development contributed:** Asking an agent to "make a small scheduler" or "add a queue for X" yields working bespoke code in minutes. Adopting a proven library requires architectural judgement that no prompt asks for. The result is lots of one-off infrastructure.

---

### P7 — Too many data stores kept consistent by hand 🟠

**Observation**
Eight kinds of storage:
- PostgreSQL (plus a replica),
- Quickwit (a release candidate `v0.9.0-rc`, also used as a log store),
- a Typesense cluster (3 nodes),
- six sidecar SQLite databases,
- SQLite vector stores,
- goViesdeze file boxes,
- S3 backups,
- ClickHouse (Plausible).

Consistency between them relies on application-level index queues, requeue scripts (`quickwit:requeue-live`, `juridiniai:typesense:requeue`, `quickwit:delete-dead-indexes`) and operator knowledge. Nothing defines a system of record per data type, a rebuild procedure for each derived store, or a way to detect drift.

**Why it matters**
Search results that silently disagree with the database, orphaned sidecar entries, and indexes that can only be rebuilt by whoever remembers the right sequence of `npm run` commands. For a transparency platform, **silent data inconsistency is a credibility risk**.

---

### P8 — Knowledge erosion and documentation drift amplified by AI-assisted development 🟠

**Observation**
- **Very high change velocity, low consolidation.** 1,195 commits in 14 months, 295 in a single month, averaging about 10 files and 300 lines per commit. Commit authors are 4 git identities; three look like shared or organisational accounts, which blurs accountability.
- **Agent instructions are not shared and are out of date.** `CLAUDE.md` (and `.claude/`) are git-ignored, so each machine and contributor runs agents with different, unversioned instructions. The local `CLAUDE.md` is already wrong:
  - it says `npm start` runs `dist/server/entry.mjs` (it runs `start-server.mjs`),
  - it describes a rate-limit flag that does not exist,
  - it says tests live in `test/rysiai` (there are 153 test files across the repository).
- **Documentation drift.** 52 Markdown files, with story, spec and plan documents mixed with reference docs. `ENV.md` still says Chromium ships in the Docker image; it no longer does. The same configuration value is documented in `ENV.md`, `config.sample.js`, `configSchema.js`, `config.d.ts` and `.env.sample`.
- **Rules are stated but not enforced.** "Never use `console.log`" versus **412 `console.*` calls**. "Modules are `.js`" versus 12.9k lines of TypeScript in `modules/`.
- **Comments used as a changelog.** Long in-code comments narrate history ("buvęs…", "anksčiau…", "persikėlė…"). They record what *used to* be true, age quickly, and hide the current intent.
- **Mixed Lithuanian and English** across identifiers, comments, docs and commit messages. Lithuanian domain terms are a sensible choice, but mixing languages *within the technical layer* makes the code harder for outside contributors, reviewers and tooling to follow.
- **Scope creep into the largest module.** `modules/risk` (11.1k lines, the largest module) plus extensive story documents is a not-yet-scheduled experimental service. It is now larger than the core contracts module.

**Why it matters**
The bus factor is effectively one or two people plus their chat histories. AI-generated documentation that is not verified against the code turns into **confidently wrong context**, which then misleads the next agent session, compounding the problem.

---

### P9 — Weak typing where most of the logic lives 🟡

**Observation**
- About **64k lines of untyped JavaScript** in `modules/`, where the business logic, SQL and scrapers live. There are no JSDoc type checks (`@ts-check` appears 0 times), and `utils/` and `tasks/` are untyped too.
- TypeScript is limited to pages and `src/lib`, on Astro's *base* (non-strict) preset, with **473 uses of `any`**.
- Database rows are untyped. Global type parsers turn `NUMERIC` into floats (a precision risk for monetary amounts) and dates into strings.

**Why it matters**
Monetary values and dates are the core of procurement data, so a float-rounding or date-string bug is a *correctness* bug in published facts. Renaming a column or changing a data shape cannot be checked by the compiler, which is precisely the safety net agents rely on to avoid breaking callers.

---

### P10 — Dependency and toolchain fragility 🟡

**Observation**
- **Overlapping libraries:**
  - five HTML/XML parsing stacks (`jsdom`, `linkedom`, `htmlparser2`, `@xmldom/xmldom`, `xpath`),
  - two HTTP clients (`node-fetch`, `undici`, plus built-in `fetch`),
  - two concurrency limiters (`p-limit`, `p-queue`).
- **Fragile build:** `tokenizers@0.13.3` needs *hand-maintained stub entries* in `package-lock.json` (documented in the Dockerfile). Any `npm install` breaks `npm ci` until someone restores them by hand.
- **Bleeding-edge and pre-release runtime pieces:** TypeScript 6, Astro 7, Quickwit `v0.9.0-rc` in production, and a Typesense cluster on an older major (28.0).
- `package.json` is the most frequently changed file (91 changes in 6 months). Dependency churn is continuous and unreviewed (no Renovate or Dependabot, no audit in CI).

---

### P11 — Configuration spread across seven files 🟡

**Observation**
Adding one setting touches up to **seven** places: `config.sample.js`, `utils/configEnv.js`, `utils/configSchema.js`, `utils/config.d.ts`, `.env.sample`, `ENV.md`, and the deployment compose file. These are among the most-changed files in the repository (`config.sample.js` 49 changes, `ENV.md` 36, `configSchema.js` 29).
- The Docker frontend reads **only `.env`**; the bare taskRunner may read **`config.js` and `.env`**. The same checkout can therefore run two processes with different effective configuration.
- Internal addresses are also hard-coded as defaults in code (P3).

---

### P12 — The public web process is also an internal control plane 🟡

**Observation**
The internet-facing Astro process also serves:
- the OCR-worker API (checkout / submit, which writes to the database and sidecars),
- the file-proxy lookup API used by `goViesdezeProxyRewrite`,
- the sidecar replication API,
- the MCP endpoint with an arbitrary-SQL tool,
- `/metrics`,
- SSE and WebSocket streams.

It also holds write credentials for PostgreSQL and the sidecar stores.

**Why it matters**
- **Large attack surface:** any vulnerability in page rendering (P3: critical Astro advisory) exposes internal machine APIs and write paths.
- **Coupled availability:** a traffic spike on public search starves the OCR fleet and file gateway, or the reverse.
- **Coupled deployment:** a UI change redeploys machine-to-machine APIs that external workers depend on.

---

## 5. Systemic root causes

| Root cause | Shows up in |
|---|---|
| **No automated feedback loop** (CI gate, types, lint) to counteract high-velocity AI changes | P2, P5, P8, P9, P10 |
| **Architecture that emerged rather than was decided** (no recorded decisions, no ownership map per data store) | P5, P6, P7, P11, P12 |
| **Operational concerns invisible to feature-driven prompts** (backup, recovery, isolation, patching) | P1, P3, P4 |
| **Unversioned, unverified knowledge** (git-ignored agent instructions, drifting docs, comments as changelog) | P8, and it amplifies all the others |

The key insight for the next phase: **the fix is not "write better code by hand"**. The fix is to give the agents (and the humans) *guard-rails that enforce architecture automatically*: CI gates, types, explicit module boundaries, migrations, versioned agent instructions. With those, agentic development remains an accelerator rather than an entropy source.

---

## 6. Questions to validate before recommendations

1. Are PostgreSQL and sidecar backups taken **outside** this repository (host cron, provider snapshots)? When was a restore last tested?
2. Is the GitHub repository public? If so, the Typesense key in git history must be treated as compromised.
3. Which frontend artifact runs in production: the GHCR image or a local build? How is the taskRunner updated?
4. Is the MCP `execute_query` tool enabled in production, and what exactly can the `analyst` role read?
5. What is the realistic team size and time budget for the next 6–12 months? This determines whether to adopt managed services or keep self-hosting.
6. Is `modules/risk` meant to become a production service, and on what timeline?

# Risk Indicator implementation plan (reusable template)

One pass of this plan implements **one** `LT-*` indicator version, from reading the catalogue row to a validated,
registered, tested indicator ready for the repo owner to commit. It is written to be copied per indicator and worked top
to bottom.

**How to use it**

- Copy this file to a scratch location (or track it in the issue/PR for the indicator) and replace `<ID>` with the
  canonical id, e.g. `LT-COM-02`. Do not edit this template in place while implementing.
- Work the phases in order. Phases 4–8 are deliberately *rules before SQL* — that is the ordering
  [`risk-service-architecture.md`](risk-service-architecture.md) §7.2 prescribes, and it keeps the decision logic from
  being shaped by whatever the query happened to make convenient.
- Every unchecked box at the end of a phase is either done or explicitly written down as "not applicable, because …"
  in the indicator's `README.md`.

**The reference implementation is `modules/risk/indicators/LT-COM-01/`.** When this plan and that directory disagree,
the directory wins and this plan gets fixed.

**Authoritative sources**

| Question                                                        | Document                                                          |
|-----------------------------------------------------------------|-------------------------------------------------------------------|
| What the indicator means, its subject, its references           | [`indicators-canonical.md`](indicators-canonical.md)              |
| Directory layout, class model, where each kind of logic belongs | [`risk-service-architecture.md`](risk-service-architecture.md) §4 |
| Parameter resolution, versioning vs. new parameter entry        | `risk-service-architecture.md` §4.5, §7.3                         |
| Required tests                                                  | `risk-service-architecture.md` §8                                 |
| Stored schema, constraints, retention                           | [`risk-schema.md`](risk-schema.md)                                |
| Source tables and columns                                       | [`tables.md`](tables.md), `dbSchema/` (`npm run db:schema:dump`)  |

## Development-phase ground rules

**The `risk` schema holds no production data and is not maintained as if it did.** `risk.evaluation_runs` and
`risk.risk_signals` exist only to develop against. There is no live public read model, no user is looking at a stored
signal, and nothing downstream depends on a row surviving.

Consequences that apply to every phase below:

- **Both risk tables can be truncated at any time**, for any reason — a changed observation shape, a bad run, a schema
  edit, or simply to get a clean slate. Backfilling or preserving them is never a requirement, and "would this lose
  stored signals?" is not a blocker on any decision.
- **The `risk` schema may be changed in place.** Editing `migrations/risk/001_risk.sql` and recreating the schema is a
  legitimate move; a strictly additive, backwards-compatible migration is not required while we are here.
- **The architecture itself is still open.** `contracts.ts`, `riskIndicator.ts`, `subjectFactsIndicator.ts`, the
  observation contract and the storage model can all be changed when an indicator shows they are wrong. Do not
  contort an indicator to fit shared machinery that turns out not to fit the catalogue — change the machinery and say
  so.
- What is **not** relaxed: the reproducibility rules inside one run (the `$1` cutoff, pure rules, immutable parameter
  entries once merged). Those exist so results can be explained, not because of stored history, and they stay.

This section is the thing to delete first once a production read model exists.

---

## Phase 0 — Scope one indicator

- [ ] Pick `<ID>` from [`indicators-canonical.md`](indicators-canonical.md) and copy its catalogue row verbatim into the
  working notes: canonical name, **primary evaluation subject**, reference codes.
- [ ] Confirm no directory `modules/risk/indicators/<ID>/` exists yet. If it does, this is a **new version**
  (§7.3) — decide version number and read the existing one before touching anything.
- [ ] Record the intended `stage` (`planning` | `tender` | `award` | `contract`): the earliest lifecycle point at which
  the facts are knowable. A signal that can only be computed after contract award is not a `tender` signal.
- [ ] Record the primary source-catalogue citation for `standard` — document name, public URL, page if known. Every
  reference code in the catalogue row goes into `references`; exactly one document goes into `standard`.

## Phase 1 — Data feasibility, before writing anything

The goal of this phase is to find out whether the indicator is computable *at all* on current data, and to decide the
unit of analysis. Never skip it: several catalogue indicators depend on data with thin coverage (ATN-1 lot detail
covers ~1,272 lots), and it is far cheaper to discover that here than in `collect.it.ts`.

- [ ] Identify the canonical views the indicator reads (`public.v_pirkimas`, `v_dalyviai`, `v_sutartys`,
  `v_company`, `v_person_links`, `v_bylos` — definitions in `modules/mcp/analyst/views/`). Prefer a canonical view over
  a raw ingestion table; if no view exposes the field, note it as a possible new view (§4.6).
- [ ] List every source column the rule needs, and confirm each exists with the expected type. `DATE`/`TIMESTAMP`
  come back as **strings**, `NUMERIC` as **float** (see `CLAUDE.md`) — that affects the fact types in `rules.ts`.
- [ ] Query the real database read-only for coverage: how many subjects have the required fields non-null, and what the
  distribution of the measured quantity looks like. Use the analyst MCP `executeQuery` tool or a read-only
  `psql`. Write the numbers down — they justify the threshold in Phase 4 and predict the trigger rate in Phase 12.
- [ ] Decide the **unit of analysis** (one row = one what?) and write the exact `subjectKey` formula, e.g.
  `saltinis:pirkimoId:daliesNumeris`. The key must be stable across runs and unique within the indicator —
  `RiskIndicator.validateObservations` rejects duplicates, and the schema's
  `(run_id, subject_type, subject_key, indicator_id)` index would collide at write time.
- [ ] Enumerate the **`insufficient_data` cases** the real data produces: which join can miss, which field can be null,
  which report can be empty. Each one becomes a `missingData` entry and a fixture.
- [ ] Enumerate the **`not_applicable` cases**: subjects the rule should not judge at all (wrong procedure type, outside
  the parameter timeline). Decide whether these are handled by parameter `scope` (preferred — the shared class returns
  `not_applicable` with no applied parameters) or by the `WHERE` clause of `collect.sql` (only when the subject
  genuinely is not in the indicator's universe).

**Stop conditions.** If the data does not support the indicator, do not implement a weakened version silently. Write the
finding in `README.md`, ship the directory as `lifecycle: 'draft'` (not evaluated), and report it.

## Phase 2 — Choose the shape

- [ ] Classify the indicator against `risk-service-architecture.md` §4.4:

| Shape                                             | Base class              | Signal                                                                                          |
|---------------------------------------------------|-------------------------|-------------------------------------------------------------------------------------------------|
| Row-local arithmetic over one subject's own facts | `SubjectFactsIndicator` | one `SELECT` yields one row per subject                                                         |
| Comparison against a population baseline          | `SubjectFactsIndicator` | the peer benchmark can be carried on the same row (window function or join to a benchmark view) |
| Sample → statistic → threshold                    | own `calculate()`       | needs many rows per subject (Benford, bid rotation)                                             |
| Ownership / person-link graph traversal           | own `calculate()`       | needs edges and a traversal, and the path is evidence                                           |
| Document text, spans, similarity                  | own `calculate()`       | needs documents/spans, and the spans are evidence                                               |

- [ ] If `SubjectFactsIndicator` fits (~78 of 106 indicators do), continue — the rest of this plan assumes it.
- [ ] If it does not, mark it here and adapt: the indicator subclasses `RiskIndicator` directly in its own directory and
  implements `protected async calculate(context, data)`. It may run several packaged statements and bind its own
  arguments. Everything else in this plan — parameters, rules purity, fixtures, tests, registration — is unchanged, plus
  one extra test: **the output is a deterministic function of the rows its SQL returned**.
- [ ] If a shared or expensive intermediate is needed (peer benchmark per CPV division and method, ownership-graph
  closure), it belongs in a `public` view, not inside the indicator (§4.6). Build the view — the point is only that it
  ends up as a fact every indicator reads on equal terms, rather than a 200-line CTE inlined in one `collect.sql`.

## Phase 3 — Extend the shared machinery if this indicator needs it

**Nothing here is a gate.** If the indicator needs something the shared machinery does not have yet, add it and carry
on — the `risk` schema is development-only, so the cost is: edit, recreate the schema, truncate, rerun. The only
obligations are that the change stays consistent across the places that declare the same thing, and that it is
mentioned in the handoff so the repo owner sees it as its own decision rather than finding it inside an indicator diff.

- [ ] **Is this indicator's evaluation subject expressible?** `subject_type` is the label stored on every signal saying
  *what kind of thing the signal is about* — the identity of one result row. It is an enumerated string, declared in
  two places that must stay in sync:
  `SubjectType` and `riskObservationV1Schema` in `modules/risk/contracts.ts`, and the
  `risk_signals_subject_type_check` constraint in `migrations/risk/001_risk.sql`.
  Today both allow only `procurement` | `lot` | `contract` | `supplier`.

  [`indicators-canonical.md`](indicators-canonical.md) ("Evaluation subject and UI placement" → "Consequence for the
  risk schema") assigns each of the 106 indicators a primary evaluation subject, and several of those subjects have no
  value in that list yet: a **bid** (one participant's proposal in one lot), a **buyer** institution, a
  **buyer–supplier relationship**, a **bidder relationship** (a co-bidding pair or group), and a **market** (a CPV
  category over an analysis window). These are entity kinds the signal is about — not views, not tables, and nothing
  that needs its own storage. Adding one is two edits plus a schema recreate.

  So: if `<ID>`'s subject is not in the list, **add it** — both declarations, recreate the schema, and write the
  `subjectKey` format for that subject into `README.md` so the next indicator with the same subject keys it the same
  way. What is not acceptable is the shortcut: attaching the decision to the nearest supported subject — writing a
  relationship signal as a `procurement` row, say — distorts counts and history.
- [ ] Does the parameter timeline need a scope dimension beyond `methods` / `objectTypes` (`ParameterScope` in
  `contracts.ts`, matching in `parameterScope.ts`)? If so, add the dimension and cover it in
  `test/risk/subjectFactsIndicator.test.ts`, where the shared resolution behaviour is tested.
- [ ] Does anything else in the shared machinery not fit — the `Decision` shape, the observation contract, the four
  states, `SubjectFacts`? Change it rather than working around it in the indicator, and note what changed and why.
  Re-run `npm test` afterwards: the shared tests are what tell you whether the change broke another indicator.
- [ ] Does the indicator need a stable shared SQL primitive (e.g. business-day counting)? A PostgreSQL function is
  justified only when all four §4.6 conditions hold; otherwise keep it in `collect.sql`.

## Phase 4 — `parameters.ts` — what the rules compare against

- [ ] Create the directory `modules/risk/indicators/<ID>/`.
- [ ] Write the Zod schema for the parameter values. Only constraints TypeScript cannot state earn their place
  (`.int()`, `.positive()`, `.min()`); the entries are typed literals, so shape is already checked.
- [ ] Write the **first effective-dated entry**: `{ validFrom, validTo: null, scope, values, source }`.
    - [ ] `source` is required and is public copy — a legal citation, the catalogue definition, or a review decision.
    - [ ] `note` only if a reader of the published timeline needs a caveat. Maintainer rationale goes in a code comment
      or `README.md`, never in these two fields.
    - [ ] `validFrom` is the date the threshold takes effect, not today's date. `2026-01-01` is the catalogue default
      when there is no legal effective date.
    - [ ] `scope: {}` applies to everything. If the rule should only judge certain procedure types, list them in
      `scope.methods` — subjects outside every scope then become `not_applicable`, which is the honest answer and
      strictly better than a suppressed trigger inside the rules.
- [ ] Confirm the timeline invariants the constructor enforces: entries sharing a scope are contiguous (`validTo` of one
  equals `validFrom` of the next, only the last is open-ended); concurrently valid entries have pairwise **disjoint**
  scopes.
- [ ] Every threshold the rules compare against is a parameter, not a literal in `rules.ts`. A number that a reviewer
  could ever argue about is a parameter.

## Phase 5 — `rules.ts` — how it decides

Written **before** the SQL, and testable with plain objects.

- [ ] Declare the facts type: `export type <Id>Facts = SubjectFacts & Readonly<{ … }>` — the extra columns
  `collect.sql` will return, in English, with the types PostgreSQL actually yields (dates as `string | null`).
- [ ] Write `export function <id>Decide(facts, parameters): Decision`.
    - [ ] It is **pure**: no database, no `Date.now()`, no clock, no I/O, no identity fields. The cutoff arrives as data
      if it is needed at all.
    - [ ] It is **total**: every possible fact row returns one of the four states.
    - [ ] It never handles missing parameters — it is only called when a reviewed entry admits the row.
    - [ ] `insufficient_data` branches come first and each names its `missingData` fields, using the **source** field
      names (`tiekejoKodas`, `procurementSource`) so a reader can find the gap in the data.
    - [ ] The trigger branch returns `rawValue` (what was measured), `threshold` (what it was compared against) and
      `evidence` (what a reviewer needs to verify it, including `source`).
    - [ ] `evidence` is attached to **every** state it returns, not only to triggers.
    - [ ] Values that end up in `evidence` are comparison-stable: the writer compares evidence for equality between
      runs, so timestamps are pre-rendered ISO-8601 UTC strings by `collect.sql`, never session-dependent.

## Phase 6 — `test/fixtures.ts` — the meeting point

Each fixture states **both** the source rows and the fact rows `collect.sql` must produce from them. This is what makes
the unit tests and the integration test meet on one value instead of two independent guesses.

- [ ] Define the fixture types (source shape + `facts: readonly <Id>Facts[]`).
- [ ] Reserve a distinct id block for this indicator's fixtures (LT-COM-01 uses `9000xx`) so parallel work does not
  collide in the shared test schema.
- [ ] Cover, at minimum:
    - [ ] a plain **triggered** case;
    - [ ] a plain **not_triggered** case;
    - [ ] the **exact boundary** — one subject just inside and one just outside the threshold;
    - [ ] each **`insufficient_data`** case from Phase 1, one fixture per missing field;
    - [ ] **cardinality**: a multi-lot / multi-supplier subject proving rows do not multiply;
    - [ ] **duplicate source rows** proving counts are not inflated;
    - [ ] a row recorded **after the cutoff** (`facts: []` — the statement must not see it);
    - [ ] a row recorded **before the parameter timeline begins** (collected, but `not_applicable`);
    - [ ] any fact row that cannot be constructed through the source tables, exported as a decision-only constant.
- [ ] If the rule does date arithmetic, add fixtures on a **DST boundary** and across a timezone offset.

## Phase 7 — `test/rules.test.ts` — decisions, no database

Runs on every `npm test`.

- [ ] Assert state, `rawValue` and `threshold` for the triggered and not-triggered fixtures.
- [ ] Assert exact threshold behaviour by calling the rules with two parameter values around one fact row.
- [ ] Assert each `insufficient_data` case and its exact `missingData` array.
- [ ] Assert `evidence` is present and identical in shape across states.
- [ ] Assert **totality**: loop over a small cross-product of field values, expect one of the four states every time.
- [ ] Assert **purity**: the same fact row returns a deeply equal decision on a second call.
- [ ] Do **not** test here: identity fields, parameter resolution, or `not_applicable` when no entry applies. Those
  belong to `SubjectFactsIndicator` and are tested once in `test/risk/subjectFactsIndicator.test.ts`.
- [ ] `npm test` is green before writing any SQL.

## Phase 8 — `collect.sql` — what is true

- [ ] One pure parameterised `SELECT`, one fact row per subject.
    - `$1` — the `data_as_of` cutoff (`timestamptz`).
    - `$2` — optional subject filter, `text[]` or `NULL` for a full run.
- [ ] Returns the `SubjectFacts` columns — `subjectKey`, `procurementSource`, `procurementId` — plus `method` /
  `objectType` if and only if a parameter entry scopes on them, plus the indicator's own measured columns.
- [ ] Naming: **everything left of an `AS` is the ingestion schema's and stays Lithuanian; everything right of it is the
  risk service's and is English.**
- [ ] Every time comparison goes through `$1`. No `now()`, `current_date`, `current_timestamp`, `localtimestamp`.
- [ ] It decides nothing: no state literal, no indicator id, no threshold, no `CASE` computing an outcome, no
  `jsonb_build_object` assembly.
- [ ] **No parameter value is bound into the SQL.** If a window or sample minimum seems needed here, collect the wider
  set and let the rules narrow it — the discarded rows usually belonged in `evidence` anyway.
- [ ] `count(DISTINCT …)` (or equivalent) wherever duplicate source rows are possible.
- [ ] Timestamps that reach `evidence` are rendered as ISO-8601 UTC text:
  `to_char(x AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.
- [ ] Header comment explains `$1`, `$2`, the unit of analysis, and any non-obvious definition (e.g. what "valid"
  means here).
- [ ] If the statement is heading past ~40 lines of real logic, re-read Phase 2 — it is probably an own `calculate()`
  or a missing shared view.

## Phase 9 — Test database schema

The integration tests run against the local `risk-dev` Postgres, never the real database.

- [ ] Does `migrations/risk/test/001_public_test_tables.sql` already contain every table the statement reads (through
  its views)? If not, add the tables with the **real column types** from `dbSchema/`
  (`npm run db:schema:dump`) — only the columns actually read, no FKs to unrelated tables, no triggers.
- [ ] Add any new table to `TEST_TABLES` in `test/risk/testPublicDb.ts` (order matters — children before parents, the
  list is truncated as one statement).
- [ ] Add any newly needed canonical view file to `VIEW_FILES` in the same file.
- [ ] `docker compose -f docker/risk/compose.yml up -d` and confirm the schema applies cleanly.

## Phase 10 — `test/collect.it.ts` — facts against a real PostgreSQL

Named `.it.ts`; run by `npm run test:integration`.

- [ ] Read `collect.sql` straight from disk (not through the definition), so a broken `sqlFile` wiring fails loudly
  instead of both halves agreeing on the wrong statement.
- [ ] `beforeAll` → `ensurePublicTestSchema()`; `beforeEach` → `truncateTestPublicTables()`; `afterAll` →
  `riskDb.end()`.
- [ ] For every fixture: insert its source rows and assert the returned rows **equal `fixture.facts`, column by
  column**.
- [ ] Assert exactly one row per subject across a multi-subject insert (the precondition `SubjectFactsIndicator`
  relies on).
- [ ] Assert the `$2` subject filter narrows the result.
- [ ] Assert a row after the cutoff is invisible, and visible at a later cutoff.
- [ ] Assert (on the comment-stripped SQL text) that it contains no `now()`, `current_date`, `current_timestamp`,
  `localtimestamp`.
- [ ] Assert (on the comment-stripped SQL text) that it contains no state literal and no indicator id.
- [ ] **End-to-end block** — the same call the run job makes,
  `indicator.evaluate({ runId, dataAsOf, subjects }, facts)`:
    - [ ] one complete observation asserted field by field, including `appliedParameters` and `dataAsOf`;
    - [ ] `not_applicable` with `appliedParameters: null`, `rawValue: null`, `threshold: null` before the timeline
      starts;
    - [ ] two evaluations at an unchanged cutoff and unchanged rows return deeply equal observations.
- [ ] For an own-`calculate()` indicator, add: the output is a deterministic function of the rows its SQL returned.

## Phase 11 — `definition.ts`, registration, README

- [ ] Write `definition.ts` exporting one `<id>v<n>` constant, constructed with `import.meta.url` as the second argument
  so `sqlFile` resolves against the indicator's own directory.
    - [ ] `key: { id: "<ID>", version: 1 }`
    - [ ] `lifecycle` — `'shadow'` unless the numbers have already been reviewed on real data (see Phase 12).
    - [ ] `subjectType`, `stage`
    - [ ] `references` — every code from the catalogue row
    - [ ] `sourceRelations` — the canonical views read; `requiredInputs` — the fields whose absence yields
      `insufficient_data`
    - [ ] `parameters`, `parameterSchema`, `sqlFile: "./collect.sql"`, `decide`
    - [ ] `standard: { name, url, page? }` — public URL, `https://`
    - [ ] `public: { titleLt, descriptionLt, formulaLt, limitationLt }` — **all four in Lithuanian**, written for a
      member of the public. `limitationLt` states the legitimate explanations for a trigger; a flag is a reason to
      review, not proof of wrongdoing.
    - [ ] Header comment naming the shape and, if `shadow`, why.
- [ ] Register in `modules/risk/deployedIndicators.ts`: import the constant and add it to the `deployedIndicators`
  array. `riskCatalogue` is derived from it — the methodology page needs no further step.
- [ ] If this version supersedes an earlier one, mark the earlier one `'retired'` **in the same commit** (exactly one
  `active` version per indicator; the registry throws otherwise).
- [ ] Write `README.md`: unit of analysis, where to look (file → question it answers), open questions, the reason the
  threshold is a parameter, known false positives, and any Phase 1 coverage caveat.

## Phase 12 — Validation

- [ ] `npm test` — green, including `test/risk/catalogue.test.ts` and `test/risk/registry.test.ts`.
- [ ] `npm run test:integration` — green (requires `docker/risk/compose.yml` up).
- [ ] `npm run check` — no new type errors.
- [ ] Import-time self-checks pass: an id outside `LT-`, empty public wording, a parameter value violating the schema,
  or a gapped/overlapping timeline all throw at import — a green test run already proves this, but confirm the indicator
  is genuinely in the registry (`riskIndicatorRegistry.all()` includes it).
- [ ] **Real-data sanity run**, read-only against the real database at a recent cutoff:
    - [ ] number of subjects evaluated, and the split across the four states;
    - [ ] the trigger rate — a rate near 0% or near 100% is a design smell, not a success;
    - [ ] spot-check 3–5 triggered subjects by hand against the source data and the public page;
    - [ ] spot-check the largest `insufficient_data` bucket — is it a real data gap or a broken join?
    - [ ] query plan and runtime on the full subject universe; note anything that will not scale in `README.md`.
- [ ] Write the sanity-run numbers into `README.md`, with the cutoff they were measured at.
- [ ] Lifecycle decision: keep `'shadow'` if any Phase 12 number is unexplained or a scope question is open; promote to
  `'active'` only once the numbers have been reviewed.

## Phase 13 — Hand off

- [ ] Re-read the diff as a reviewer: does `collect.sql` decide anything? does `rules.ts` touch a clock or a database?
  is any threshold a literal? does `parameters.ts` rewrite an existing entry instead of closing it?
- [ ] Summarise for the repo owner: what the indicator measures, unit of analysis, threshold and its source, the
  sanity-run numbers, chosen lifecycle, and anything left open.
- [ ] **Do not run `git commit`.** Leave the working tree ready and let the repo owner commit.
- [ ] If shared machinery had to change (Phase 3), say so explicitly and separately — it is a legitimate move in this
  phase, but the repo owner should see it as its own decision rather than find it inside an indicator diff.
- [ ] Deployment note, for when there is something to deploy: the service and the web application go out from **the
  same commit** (§7.2 step 9), so the site can describe an indicator before its first signal is published. Nothing is
  published yet, so this constrains nothing today.

---

## Definition of done

An indicator is done when all of these are true:

1. `modules/risk/indicators/<ID>/` contains `definition.ts`, `parameters.ts`, `rules.ts`, `collect.sql`, `README.md`
   and `test/{fixtures.ts, rules.test.ts, collect.it.ts}`.
2. The version is registered in `deployedIndicators.ts` and appears in `riskCatalogue`.
3. `npm test`, `npm run test:integration` and `npm run check` are green.
4. The real-data sanity numbers are recorded in `README.md` with their cutoff.
5. Its lifecycle is a deliberate choice, justified in `definition.ts` or `README.md`.
6. The only shared files changed are `deployedIndicators.ts`, `migrations/risk/test/001_public_test_tables.sql` and
   `test/risk/testPublicDb.ts` — **or** a Phase 3 shared-machinery change that is called out in the handoff rather
   than buried in the indicator diff.

## Recurring pitfalls

| Pitfall                                                                       | Where it bites                                                                                      |
|-------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| A threshold hard-coded in `rules.ts`                                          | Cannot be changed without a new implementation version                                              |
| A parameter bound into `collect.sql`                                          | Breaks the "SQL measures, TypeScript decides" boundary; policy becomes invisible to `git blame`     |
| `now()` anywhere in the statement                                             | Reruns at one cutoff stop being reproducible                                                        |
| A `timestamptz` returned raw and put in `evidence`                            | Session timezone changes the value; the writer sees a spurious change every run                     |
| Missing `DISTINCT` on a join that fans out                                    | Inflated counts; duplicate subject rows rejected by `validateObservations`                          |
| Suppressing a trigger inside the rules instead of scoping the parameter entry | Hides the fact that no reviewed threshold covers the subject; `not_applicable` is the honest answer |
| Rewriting an existing parameter entry                                         | Published observations stop being reproducible; CI rejects it                                       |
| Testing parameter resolution or identity fields in an indicator's own tests   | Duplicates what `subjectFactsIndicator.test.ts` already proves, and drifts                          |
| Two `active` versions of one indicator                                        | The registry throws at import — the whole service fails to start                                    |
| A subject type added to `contracts.ts` but not to the schema `CHECK` (or vice versa) | Rows are rejected at write time, after a full run                                            |
| Bending an indicator to fit shared machinery that does not fit it             | The catalogue is the requirement; the machinery is ours to change (see the ground rules)            |

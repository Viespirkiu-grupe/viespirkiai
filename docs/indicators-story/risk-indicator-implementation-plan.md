# Risk indicator implementation plan (reusable template)

One pass of this plan implements **one** `LT-*` indicator, from reading its catalogue row to a tested, registered
indicator ready for review. It is generic on purpose — copy it per indicator (`<ID>` = e.g. `LT-COM-04`) and hand the
copy to the implementing agent; do not edit this template in place.

Reference implementations: `modules/risk/indicators/LT-COM-01/`, `LT-COM-02/`, `LT-COM-03/` (procurement/lot grain,
existing subject types); `LT-COM-20/` (bid grain — also the reference for what introducing a *new* subject type
touches, see Phase 0a). Architecture: [`risk-service-architecture.md`](risk-service-architecture.md). Entities:
[`domain-model.md`](domain-model.md). Catalogue: [`indicators-canonical.md`](indicators-canonical.md).

## Phase 0 — Scope check

- [ ] Read `<ID>`'s row in `indicators-canonical.md` (indicator text, subject type, references, category, any Note).
  The subject type is the §4 subsection the row sits under (e.g. "Subject `bid`"), not a column on the row itself.
- [ ] Confirm the row is not marked "Cannot implement". If it is, stop — do not implement it.
- [ ] Confirm `<ID>`'s `subjectType` is one of the types `modules/risk/types.ts`'s `SubjectType` already admits
  (currently `procurement`, `lot`, `bid`, `contract`, `supplier`). If not, this is Phase 0a, not a stop condition —
  see below — but treat it as a scope decision to flag to the user before starting, since it is materially more work
  than a same-subject-type indicator.
- [ ] Confirm a decision base class exists for the subject type (e.g. `AProcurementIndicatorDecision`,
  `ALotIndicatorDecision`, `ABidIndicatorDecision` in `modules/risk/procurementLotDecision.ts`). If not, building it
  is part of Phase 0a below, not a prerequisite to raise and stop on — a missing base class merely means the subject
  type itself is new.

### Phase 0a — Only if `<ID>` needs a subject type not yet admitted

Skip this section entirely if Phase 0 found an existing, admitted subject type — the rest of the plan is unchanged.
Building a new subject type is real, multi-file infrastructure work, not a one-line addition; `LT-COM-20` (the `bid`
subject type) touched every file below. Do it once, deliberately, before Phase 1, rather than discovering pieces of
it mid-implementation:

- [ ] `modules/risk/types.ts` — add the new value to `SubjectType`; add the new `Subject` object (the equivalent of
  `LotSubject`) carrying the new evidence type plus its non-null parent(s); add it to the `Subject` union.
- [ ] `modules/risk/contracts.ts` — add the same value to `riskSignalSchema`'s `subjectType` enum. **This is a second,
  independent source of truth from `SubjectType` in `types.ts` — TypeScript will not catch a mismatch here; only a
  runtime signal actually being built (a decision test or an end-to-end engine test) will,** with a `ZodError` deep
  inside `signalFor`. Update it in the same commit as `types.ts`, don't wait to be told by a failing test.
- [ ] `migrations/risk/00N_<name>.sql` — a new migration (do not edit `001_risk.sql` in place) that drops and
  re-adds `signalsSubjectTypeCheck` with the new value included.
- [ ] `modules/risk/procurementLotDecision.ts` — add the new `A<X>IndicatorDecision` base class, following
  `ALotIndicatorDecision`'s shape: delegate `isEligible` to whichever existing Eligibility Decision the new subject's
  parent already has (extend `procurementEligibility.ts` only if the new subject genuinely needs its own rule, per
  Phase 2 below).
- [ ] `modules/risk/procurementReader.ts` — add the query that loads the new evidence at its own grain, and merge it
  onto its parent's field (e.g. `Lot.bids`). If the new subject's existence depends on evidence being present at all
  (unlike `Lot`, which exists as a subject whether or not anything was ever observed about it), load only rows that
  have a genuine identity — no subject is built for a row with no durable key.
- [ ] `modules/risk/riskDecisionEngine.ts` — add `evaluate<X>` plus a `subjectFor<X>` following `evaluateLot`'s
  shape, and wire it into `evaluateAll`'s walk. Only walk the new grain when at least one indicator of that
  subjectType is registered (see `LT-COM-20`'s `this.bidIndicators.length > 0` guard) — the new query still always
  runs (shared, like `LotParticipation`), but building thousands of subjects nothing will judge is wasted work.
- [ ] **Ripple effect on shared test fixtures**: adding a required field to an existing type (e.g. `Lot.bids`) breaks
  every test file that builds a literal of that type. Grep for the type's other constructors — reference
  implementations' own `test/decision.test.ts` files, `test/risk/riskDecisionEngine.test.ts`, and any
  `*.test.ts`/`*.it.ts` building the same object — and add the new field to each. `npm run check` after this step is
  the fast way to find every site the compiler still disagrees with; do not rely on `npm test` alone; a field typed
  as `readonly X[]` rather than `X[] | null` still needs a default in every literal even where the test doesn't care
  about it.
- [ ] If the new evidence needs a warehouse column the shared view doesn't expose yet (a new field, not just a new
  subject), see Phase 3's view-sync and test-fixture-table bullets — the same file list applies.

## Phase 1 — Understand the data

- [ ] Read the domain-model entity/entities `<ID>` reads ([`domain-model.md`](domain-model.md) §1–§4): grain, key,
  columns actually available.
- [ ] Check the relevant warehouse view(s) under `modules/mcp/analyst/views/*.sql` (or the risk service's own `_v2`
  copies) for the exact columns on offer.
- [ ] If the indicator needs a value not yet exposed by an existing view/reader query, note the smallest addition
  required (new column on a view, new field on the reader's merged shape) — do not silently reinterpret the
  indicator to fit what's convenient.
- [ ] **Before settling on a column, look past what the view already exposes.** Query the underlying warehouse
  table(s) directly (`\d "tableName"`) for a structured, dictionary-backed column (an `*Id` foreign key into a small
  lookup table) that says the same thing the catalogue concept needs, rather than defaulting to whatever free-text
  column is already wired into the view. `LT-COM-20` initially looked like it had to pattern-match free text
  (`atmetimoPriezastis`, ~4 usable rows nationwide) until a sibling column on the same source table
  (`xlsxPPAatmestiPasiulymai.statusasId` → a real status dictionary) turned out to carry the same fact structurally,
  at 20x the coverage. Ten minutes of `\d` on the source tables is cheaper than building a formula on a fragile
  regex.
- [ ] **Quantify the candidate field's actual coverage before committing to it as the formula's basis** — `count(*)`
  matching your intended condition against the total population it's drawn from, not just "does the column exist".
  A field that is technically present but populated for a handful of rows nationwide is a sign to keep looking (per
  the bullet above) or to scope the indicator's `limitationLt` honestly around that scarcity, not to build the
  formula and hope.
- [ ] Sanity-check real data (row counts, null rates, distinct values) for the columns the formula depends on — don't
  assume a column means what its name suggests.

## Phase 2 — Design the decision

- [ ] Write the formula in one sentence: what is compared against what threshold, at what grain.
- [ ] Decide `requiredInputs` — the fields whose absence means `insufficient_data`, not `not_triggered`. This is
  usually *not* the same test as "is this specific field null": a field can be null and still mean something
  definite (e.g. a bid's rejection-status column being null, when its ranking column is populated, positively means
  "not withdrawn" — `not_triggered`, not `insufficient_data`). Write `hasRequiredData()` around "do we have *any*
  evidence of an outcome for this subject", not around one field's nullability, and reserve `requiredInputs`/
  `missingDataWhenAbsent` for the case where the subject carries no evidence at all.
- [ ] Decide the eligibility gate: reuse the shared Eligibility Decision for the subject type unless `<ID>` genuinely
  needs an extra rule (see `procurementEligibility.ts` / `lotEligibility.ts`).
- [ ] Decide the parameter(s) — thresholds are parameters with an effective-dated timeline, never literals in
  `decision.ts`. A parameter isn't only a numeric threshold: a small list of matched labels/statuses (see
  `LT-COM-20`'s `withdrawalStatuses`) belongs in `parameters` too, for the same reason — the source dictionary can
  gain another label without a new indicator version.
- [ ] Decide `sourceRelations` — the view(s) this version reads, for provenance.
- [ ] Look up `standard.name`/`standard.url` from `docs/indicators-story/indicators/<source>.md` (the file named in
  `indicators-canonical.md` §1's prefix table for `<ID>`'s reference codes) rather than reusing a sibling
  indicator's standard by habit — a reference-implementation neighbour may cite a different source than `<ID>` does.

## Phase 3 — Implement

Directory: `modules/risk/indicators/<ID>/`.

- [ ] `definition.ts` — `RiskIndicatorDefinition`: `key`, `subjectType`, `stage`, `references`, `sourceRelations`,
  `requiredInputs`, `parameters` (with `validFrom`/`validTo`/`source`), `standard`, `public` (`titleLt`,
  `descriptionLt`, `formulaLt`, `limitationLt`). Pure data — no import of `ARiskIndicatorDecision`.
- [ ] `decision.ts` — subclass the subject type's base decision class; implement `hasRequiredData()` and
  `assessRisk()`. Every `RiskSignal` returned carries `rawValue`, `threshold`, `appliedParameters` for `triggered`
  and `not_triggered` states.
- [ ] Wire any new reader/query changes needed for Phase 1's data gap (e.g. `procurementReader.ts`), keeping it
  shared across indicators at the same grain rather than indicator-private.
- [ ] If Phase 1 found the value on a view (`modules/mcp/analyst/views/*.sql`), and the risk service reads a `_v2`
  copy of it (`procurementPublicViews.ts`'s header explains why the copies exist), **edit both the shared view and
  its `_v2` copy by hand, in the same change** — they are not generated from one source, and only the `_v2` copy is
  what the Procurement Reader and its integration tests actually run.
- [ ] `README.md` — one paragraph on unit of analysis, a "where to look" table for the files, and any known
  limitation the public `limitationLt` text should already be saying in Lithuanian. If Phase 1 measured a data
  coverage number that shaped the formula (see Phase 1's coverage bullet), record the measurement and its date here
  so a future re-check knows what to compare against.

## Phase 4 — Register

- [ ] Add the decision class to `deployedIndicatorClasses` in `modules/risk/deployedIndicators.ts`.
- [ ] Confirm `npm test` still passes `test/risk/registry.test.ts` and `test/risk/catalogue.test.ts` (no duplicate
  key, catalogue projection includes the new entry). Note these two tests do **not** exercise `contracts.ts`'s
  runtime schema — a `subjectType` missing from it (Phase 0a) only surfaces once a signal is actually built, in
  Phase 5's decision/engine tests.

## Phase 5 — Test

- [ ] `test/fixtures.ts` — named scenarios covering: the plain triggered case, the plain not-triggered case, the
  boundary at the threshold, and the `insufficient_data` case(s) from `hasRequiredData`.
- [ ] `test/decision.test.ts` — unit-test `assessRisk()` directly against fixtures (no database), plus an
  "end to end" block through `RiskDecisionEngine` covering the eligibility gate.
- [ ] If Phase 3 added or changed a reader query, add/extend an integration test (`*.it.ts`, requires a live DB —
  `npm run test:integration`) proving the query itself produces the shapes the fixtures assume — reading real rows,
  since there is no fixture schema to write into. **If a local database isn't reachable in the current
  environment**, write the test
  anyway — it documents and will verify the query's contract once run — but say so explicitly in the Phase 8
  handoff rather than silently skipping it; don't report `npm run test:integration` as green without having run it.
- [ ] `npm test` and, if touched, `npm run test:integration` both green.
- [ ] If Phase 0a added a subject type, or any earlier phase added a required field to a shared type (`Lot`,
  `Procurement`, …), grep the repo for every other literal of that type and confirm each still compiles — see Phase
  0a's ripple-effect bullet. `npm run check`'s error count going up by more than one *new kind* of error (as opposed
  to one more instance of a pre-existing, unrelated one) is the signal something was missed.

## Phase 6 — Validate against real data

Unit tests only prove the formula matches fixtures you invented; they cannot catch a formula that's technically
correct but empirically vacuous (or absurdly over-firing) against the real population. Before treating the indicator
as done:

- [ ] Write a small throwaway script — a `describe`/`it` block placed under `test/risk/` so it can import the real
  `postgres` pool and the indicator's own class (delete it before finishing; it is not part of the suite) — that
  runs `ProcurementReader` + `RiskDecisionEngine` with just this indicator against a real, non-trivial sample of
  subjects (tens of procurements, not one), and prints the resulting state distribution
  (`triggered`/`not_triggered`/`insufficient_data`/`not_applicable` counts) plus a few example `triggered` signals.
  This reads real `public` data but never writes to `risk."signals"` (skip `SignalWriter` entirely) — safe to run
  without the local risk Postgres.
- [ ] Look at the `triggered` examples by hand: do they look like genuine instances of the catalogue concept, not an
  artifact of the query (duplicate rows, a wrong join, a threshold that's trivially always true)?
- [ ] If `triggered` never fires across the sample, and the indicator isn't inherently rare (Phase 1's coverage
  measurement should already tell you which to expect), that is a signal to re-check the formula before handoff, not
  something to wave away.
- [ ] Delete the throwaway script — `git status` should show no trace of it — and fold anything worth keeping into
  Phase 8's handoff summary instead.

## Phase 7 — Validate against the catalogue

- [ ] `public.titleLt`/`descriptionLt`/`formulaLt` match the canonical indicator's intent, not a paraphrase of the
  reference source's formula.
- [ ] `limitationLt` states the genuine caveat a reviewer needs (narrow market, legitimate single-supplier procedure,
  data coverage gap, etc.) — not boilerplate.
- [ ] `references` match `indicators-canonical.md`'s Reference indicators column for `<ID>`.
- [ ] `npm run check` passes. If it already fails on the base branch for unrelated reasons, confirm the *count* of
  errors only grew by exactly the new, already-known instances (Phase 5's last bullet) — diff the error list against
  a clean checkout if in doubt, don't assume every new-looking error is pre-existing.

## Phase 8 — Handoff

- [ ] Summarize what was implemented, any data-gap workaround taken in Phase 1, and any follow-up left open (e.g. a
  view/reader change that should eventually move upstream, or — per Phase 0a — new subject-type infrastructure now
  available to the next indicator on that grain).
- [ ] Call out anything you could not actually run in this environment (integration tests without Docker, a write-
  path run without the local risk Postgres, etc.) rather than reporting it as verified.
- [ ] Leave the working tree uncommitted for the repo owner to review and commit.

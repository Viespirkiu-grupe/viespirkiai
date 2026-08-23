# Risk indicator implementation plan (reusable template)

One pass of this plan implements **one** `LT-*` indicator, from reading its catalogue row to a tested, registered
indicator ready for review. It is generic on purpose — copy it per indicator (`<ID>` = e.g. `LT-COM-04`) and hand the
copy to the implementing agent; do not edit this template in place.

Reference implementations: `modules/risk/indicators/LT-COM-01/`, `LT-COM-02/`, `LT-COM-03/`. Architecture:
[`risk-service-architecture.md`](risk-service-architecture.md). Entities: [`domain-model.md`](domain-model.md).
Catalogue: [`indicators-canonical.md`](indicators-canonical.md).

## Phase 0 — Scope check

- [ ] Read `<ID>`'s row in `indicators-canonical.md` (indicator text, subject type, references, category, any Note).
- [ ] Confirm the row is not marked "Cannot implement". If it is, stop — do not implement it.
- [ ] Confirm `<ID>`'s `subjectType` is one of the types `modules/risk/types.ts`'s `SubjectType` already admits
  (currently `procurement`, `lot`, `contract`, `supplier`). If not, stop and raise it — a new subject type needs a
  migration (`risk_signals_subject_type_check`) and reader support before any indicator on it can be built.
- [ ] Confirm a decision base class exists for the subject type (e.g. `AProcurementIndicatorDecision`,
  `ALotIndicatorDecision` in `modules/risk/procurementLotDecision.ts`). If not, that's a prerequisite, not part of
  this indicator's work.

## Phase 1 — Understand the data

- [ ] Read the domain-model entity/entities `<ID>` reads ([`domain-model.md`](domain-model.md) §1–§4): grain, key,
  columns actually available.
- [ ] Check the relevant warehouse view(s) under `modules/mcp/analyst/views/*.sql` (or the risk service's own `_v2`
  copies) for the exact columns on offer.
- [ ] If the indicator needs a value not yet exposed by an existing view/reader query, note the smallest addition
  required (new column on a view, new field on the reader's merged shape) — do not silently reinterpret the
  indicator to fit what's convenient.
- [ ] Sanity-check real data (row counts, null rates, distinct values) for the columns the formula depends on — don't
  assume a column means what its name suggests.

## Phase 2 — Design the decision

- [ ] Write the formula in one sentence: what is compared against what threshold, at what grain.
- [ ] Decide `requiredInputs` — the fields whose absence means `insufficient_data`, not `not_triggered`.
- [ ] Decide the eligibility gate: reuse the shared Eligibility Decision for the subject type unless `<ID>` genuinely
  needs an extra rule (see `procurementEligibility.ts` / `lotEligibility.ts`).
- [ ] Decide the parameter(s) — thresholds are parameters with an effective-dated timeline, never literals in
  `decision.ts`.
- [ ] Decide `sourceRelations` — the view(s) this version reads, for provenance.

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
- [ ] `README.md` — one paragraph on unit of analysis, a "where to look" table for the files, and any known
  limitation the public `limitationLt` text should already be saying in Lithuanian.

## Phase 4 — Register

- [ ] Add the decision class to `deployedIndicatorClasses` in `modules/risk/deployedIndicators.ts`.
- [ ] Confirm `npm test` still passes `test/risk/registry.test.ts` and `test/risk/catalogue.test.ts` (no duplicate
  key, catalogue projection includes the new entry).

## Phase 5 — Test

- [ ] `test/fixtures.ts` — named scenarios covering: the plain triggered case, the plain not-triggered case, the
  boundary at the threshold, and the `insufficient_data` case(s) from `hasRequiredData`.
- [ ] `test/decision.test.ts` — unit-test `assessRisk()` directly against fixtures (no database), plus an
  "end to end" block through `RiskDecisionEngine` covering the eligibility gate.
- [ ] If Phase 3 added or changed a reader query, add/extend an integration test (`*.it.ts`, requires a live DB —
  `npm run test:integration`) proving the query itself produces the shapes the fixtures assume.
- [ ] `npm test` and, if touched, `npm run test:integration` both green.

## Phase 6 — Validate against the catalogue

- [ ] `public.titleLt`/`descriptionLt`/`formulaLt` match the canonical indicator's intent, not a paraphrase of the
  reference source's formula.
- [ ] `limitationLt` states the genuine caveat a reviewer needs (narrow market, legitimate single-supplier procedure,
  data coverage gap, etc.) — not boilerplate.
- [ ] `references` match `indicators-canonical.md`'s Reference indicators column for `<ID>`.
- [ ] `npm run check` passes.

## Phase 7 — Handoff

- [ ] Summarize what was implemented, any data-gap workaround taken in Phase 1, and any follow-up left open (e.g. a
  view/reader change that should eventually move upstream).
- [ ] Leave the working tree uncommitted for the repo owner to review and commit.

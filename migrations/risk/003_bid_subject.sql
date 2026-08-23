-- Adds 'bid' to the set of subject types risk.risk_signals accepts — the
-- Bid / bidder participation subject (docs/indicators-story/
-- indicators-canonical.md §4, "Subject `bid`"), grain
-- (pirkimoNumeris, daliesNumeris, tiekejoKodas), first used by LT-COM-20.
-- See modules/risk/types.ts's SubjectType and Subject (BidSubject).

ALTER TABLE risk.risk_signals DROP CONSTRAINT IF EXISTS risk_signals_subject_type_check;

ALTER TABLE risk.risk_signals ADD CONSTRAINT risk_signals_subject_type_check
    CHECK (subject_type IN ('procurement', 'lot', 'bid', 'contract', 'supplier'));

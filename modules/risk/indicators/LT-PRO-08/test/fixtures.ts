// Named (paskelbimoData, pasiulymuPateikimoTerminas) scenarios shared by
// decision.test.ts. Both fields come straight from
// Subject.procurement.{paskelbimoData,pasiulymuPateikimoTerminas} — no
// merged reader shape to describe (unlike LT-COM-03's participation
// fixtures), since the Procurement Reader already loads these columns for
// every procurement subject (see README.md).

// Every scenario below is published on the same day.
export const PUBLISHED = "2026-01-01";

// 2 days after PUBLISHED — well below minimumDays: 5, the plain triggered
// case.
export const DEADLINE_SHORT = "2026-01-03";

// Exactly 5 days after PUBLISHED — 5 is not "strictly below" minimumDays: 5,
// so this is the not_triggered boundary case.
export const DEADLINE_AT_BOUNDARY = "2026-01-06";

// 14 days after PUBLISHED — comfortably inside the not-anomalous range, the
// plain not_triggered case.
export const DEADLINE_ORDINARY = "2026-01-15";

// Same calendar day as PUBLISHED — a zero-day period, excluded as
// implausible (see README.md) rather than counted as "even shorter than
// short".
export const DEADLINE_SAME_DAY = "2026-01-01";

// Before PUBLISHED — a negative period, the same implausible-pairing family
// as DEADLINE_SAME_DAY.
export const DEADLINE_BEFORE_PUBLISHED = "2025-12-20";

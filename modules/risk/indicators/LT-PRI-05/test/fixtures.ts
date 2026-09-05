// Named numatomaVerteEUR scenarios shared by decision.test.ts. The value
// itself comes straight from Subject.procurement.numatomaVerteEUR — no
// merged reader shape to describe (unlike LT-COM-03's participation
// fixtures), since the Procurement Reader already loads this column for
// other indicators' use (see README.md).

// Well below the minimumValueEUR: 1_400_000 default — the plain
// not_triggered case.
export const lowValue = 55_537.19;

// Exactly at the boundary — minimumValueEUR: 1_400_000 does not trigger on
// numatomaVerteEUR === 1_400_000 (strictly greater than, not
// greater-or-equal).
export const boundaryValue = 1_400_000;

// Just above the boundary — the plain triggered case.
export const highValue = 1_708_705.53;

// Far above the boundary — a large, clearly triggered case.
export const veryHighValue = 12_000_000;

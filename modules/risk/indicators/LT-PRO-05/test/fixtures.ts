// Named pirkimoBudas scenarios shared by decision.test.ts. The value comes
// straight from Subject.procurement.pirkimoBudas — no merged reader shape
// to describe (unlike LT-COM-03's participation fixtures), since the
// Procurement Reader already loads this column for procurementEligibility()
// itself (see README.md).

// An accelerated open-competition label — the plain triggered case.
export const acceleratedOpenProcedure = "Atviras konkursas (pagreitinta procedūra)";

// A second, distinct accelerated-procedure label — proves the match is a
// list, not a single literal.
export const acceleratedRestrictedProcedure = "Ribotas konkursas (pagreitinta procedūra) pagal VPĮ/GSPĮ";

// The plain (non-accelerated) open-competition label — the plain
// not_triggered case.
export const openProcedure = "Atviras konkursas";

// A negotiated-procedure label that is not the accelerated variant — also
// not_triggered: negotiated but not accelerated are two independent axes.
export const negotiatedProcedure = "Skelbiamos derybos pagal VPĮ";

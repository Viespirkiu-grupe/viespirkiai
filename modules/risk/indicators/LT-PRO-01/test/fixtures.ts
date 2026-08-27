// Named pirkimoBudas scenarios shared by decision.test.ts. The value comes
// straight from Subject.procurement.pirkimoBudas — no merged reader shape
// to describe (unlike LT-COM-03's participation fixtures), since the
// Procurement Reader already loads this column for procurementEligibility()
// itself (see README.md).

// A negotiated-procedure label — the plain triggered case.
export const negotiatedProcedure = "Skelbiamos derybos pagal VPĮ";

// A second, distinct negotiated-procedure label — proves the match is a
// list, not a single literal.
export const negotiatedSurveyProcedure = "Skelbiama apklausa su derybomis";

// An open-competition label — the plain not_triggered case.
export const openProcedure = "Atviras konkursas";

// A restricted-competition label — also not_triggered: two-stage but still
// competitive by design, not a negotiated exception route.
export const restrictedProcedure = "Ribotas konkursas pagal VPĮ/PĮ/GSPĮ/KĮ";

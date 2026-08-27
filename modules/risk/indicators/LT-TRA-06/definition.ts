import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-TRA-06 — Procurement decision or reason not documented (Pirkimo
// procedūros sprendimas ar jo priežastis nedokumentuoti).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export type LtTra06Parameters = BaseParameters;

export const ltTra06Definition: RiskIndicatorDefinition<LtTra06Parameters> = {
    key: { id: "LT-TRA-06", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["STT-I15", "OLAF-CA06"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["proceduruPabaiga"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        source:
            "STT korupcijos rizikos analizės (STT-I15 — neišsami pirkimo dokumentacija ar sprendimai), broadened by " +
            "the OLAF-supported \"Red Flags\" booklet's item II.6 (\"Unsuccessful procedure without statement of " +
            "reason\", OLAF-CA06) to any procedure-ending decision, not only an unsuccessful one: tested against the " +
            "ATN-1/PPA report's own \"Sprendimo priežastys\" free-text field for each lot's procedure-ending " +
            "decision, present or absent regardless of which outcome label the lot carries.",
    },
    standard: {
        name: "STT korupcijos rizikos analizės (STT-I15 — neišsami pirkimo dokumentacija ar sprendimai)",
        url: "https://www.stt.lt/korupcijos-prevencija/korupcijos-rizikos-analizes/7470",
    },
    public: {
        titleLt: "Pirkimo procedūros sprendimas ar jo priežastis nedokumentuoti",
        descriptionLt:
            "Bent vienoje pirkimo dalyje ATN-1 (PPA) ataskaitoje nurodyta pirkimo procedūros pabaigos priežastis, " +
            "tačiau nenurodyta, kuo šis sprendimas buvo pagrįstas (\"Sprendimo priežastys\" laukas tuščias).",
        formulaLt: "egzistuoja pirkimo dalis: procedūros pabaigos priežastis ≠ NULL IR sprendimo priežastys = NULL",
        limitationLt:
            "Rodiklis remiasi tik ATN-1 (PPA) ataskaitos laisvo teksto lauku „Sprendimo priežastys“ — tuščias " +
            "laukas gali reikšti, kad ataskaitą pildęs asmuo pagrindimą tiesiog praleido pildydamas formą, o ne kad " +
            "sprendimas realybėje visai nebuvo pagrįstas ar dokumentuotas kitur (pvz., protokole, kuris į šią " +
            "ataskaitą nepatenka). ATN-1 ataskaitos teikiamos ne visiems pirkimo būdams, todėl žemos vertės " +
            "apklausos dažnai lieka be duomenų (žr. README.md).",
    },
};

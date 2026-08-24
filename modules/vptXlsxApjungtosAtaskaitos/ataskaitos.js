import { irasyti, zodynas } from "./db.js";
import { atsakymas, pirma, sveikas, tekstas } from "./reiksmes.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

/** Ataskaitų antraščių lapai kiekvienoje šeimoje. */
export const ANTRASCIU_LAPAI = [
    { failas: "ATN1_XLSX.xlsx", lapas: "ATN1_XLSX", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "I.–III.", seima: "gppa" },
    { failas: "Projekto konkursai.xlsx", lapas: "I.–II., IV.", seima: "design_contest" },
    { failas: "Koncesijos.xlsx", lapas: "I.", seima: "concession" },
];

const PIRKIMO_BUDAS_ATN1 = "1. Pirkimo būdo pavadinimas";
const PIRKIMO_BUDAS_KITI = "1. Pirkimo būdo pavadinimas  / (pasirinkite iš sąrašo)";

/** @param {Record<string, unknown>} eilute */
function pirkimoBudas(eilute, seima) {
    return tekstas(seima === "atn1" ? eilute[PIRKIMO_BUDAS_ATN1] : eilute[PIRKIMO_BUDAS_KITI]);
}

/** @param {Record<string, unknown>} eilute */
function objektoRusis(eilute) {
    const reiksme = tekstas(pirma(eilute,
        "3. Pirkimo objekto rūšis",
        "2. Pirkimo objekto rūšis / (pasirinkti iš sąrašo)"))?.toLowerCase();
    if (reiksme === "prekės") return "goods";
    if (reiksme === "paslaugos") return "services";
    if (reiksme === "darbai") return "works";
    return "unknown";
}

/**
 * Įrašo ataskaitų antraštes (submission) ir jų tipines dalis.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilutes: Record<string, unknown>[]}[]} saltiniai
 */
export async function importuotiAtaskaitas(client, kontekstas, saltiniai) {
    const visosEilutes = saltiniai.flatMap(({ seima, eilutes }) =>
        eilutes
            .filter((eilute) => eilute[SALTINIO_ID] !== null)
            .map((eilute) => ({ seima, eilute })));

    const pagrindai = await zodynas(client, "legal_basis", "name",
        visosEilutes.map(({ eilute }) => tekstas(eilute["TEISINIS PAGINDAS"])).filter(Boolean));

    const ataskaitos = await irasyti(client, "submission", [
        "family", "source_record_id", "report_type", "report_number", "legal_basis_id",
        "source_file_name", "responsible_person_name", "responsible_phone",
        "responsible_email", "signatory_name", "signatory_position",
        "additional_information", "updated_at",
    ], visosEilutes.map(({ seima, eilute }) => [
        seima,
        eilute[SALTINIO_ID],
        tekstas(eilute["ATASKAITOS TIPAS"]) ?? "Koncesijos procedūrų ataskaita",
        tekstas(eilute["Ataskaitos Nr."]),
        pagrindai.get(tekstas(eilute["TEISINIS PAGINDAS"])) ?? null,
        tekstas(pirma(eilute, "Failo pavadinimas", "Ataskaitos Nr.")),
        tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą vardas, pavardė"]),
        tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą telefono numeris"]),
        tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą elektroninio pašto adresas"]),
        tekstas(eilute["Ataskaitą pasirašančio asmens vardas, pavardė"]),
        tekstas(eilute["Ataskaitą pasirašančio asmens asmens pareigų pavadinimas"]),
        tekstas(pirma(eilute, "Papildoma informacija", "Kita informacija")),
        new Date(),
    ]), {
        konfliktas: "(family, source_record_id)",
        atnaujinti: [
            "report_type", "report_number", "legal_basis_id", "source_file_name",
            "responsible_person_name", "responsible_phone", "responsible_email",
            "additional_information", "updated_at",
        ],
        grazinti: "id, family, source_record_id",
    });

    for (const row of ataskaitos) {
        kontekstas.ataskaitos.set(`${row.family}:${row.source_record_id}`, Number(row.id));
    }

    await importuotiPirkimoAtaskaitas(client, kontekstas, visosEilutes);
    await importuotiKoncesijuAtaskaitas(client, kontekstas, visosEilutes);
}

/**
 * ATN1, GPPA ir projekto konkursų antraštės → procurement_report.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} visosEilutes
 */
async function importuotiPirkimoAtaskaitas(client, kontekstas, visosEilutes) {
    const pirkimai = visosEilutes.filter(({ seima }) => seima !== "concession");
    if (!pirkimai.length) return;

    const budai = await zodynas(client, "procedure_method", "name",
        pirkimai.map(({ seima, eilute }) => pirkimoBudas(eilute, seima)).filter(Boolean));

    await irasyti(client, "procurement_report", [
        "submission_id", "procurement_number", "object_name", "procurement_value_class",
        "object_kind", "related_to_funded_project", "funded_from_eu_structural_funds",
        "registered_in_sfmis", "electronic_procurement", "non_electronic_reason",
        "authorization_delegated", "framework_agreement", "dynamic_purchasing_system",
        "lot_count", "procedure_method_id", "procedure_method_reason",
        "turnover_requirement_applied", "turnover_requirement_reason",
        "claims_submitted", "lawsuits_submitted", "conflict_of_interest",
        "conflict_measures", "preparation_participant", "competition_measures",
        "classified_information", "classified_during_procedure",
        "classified_during_execution", "classified_other_use", "highest_classification",
    ], pirkimai.map(({ seima, eilute }) => {
        const sfmis = atsakymas(eilute["4.1. Ar Finansuojamas iš Europos Sąjungos struktūrinių fondų lėšų ir projektas yra registruotas SFMIS?"]);
        return [
            kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`),
            tekstas(pirma(eilute, "1.1. Pirkimo numeris", "1. Pirkimo numeris")),
            tekstas(pirma(eilute, "2.1. Pirkimo objekto pavadinimas", "2. Pirkimo objekto pavadinimas")) ?? "",
            tekstas(pirma(eilute, "3. Pirkimo vertė", "3. Pirkimo vertė / (pasirinkti iš sąrašo)")),
            objektoRusis(eilute),
            atsakymas(eilute["4. Ar pirkimas yra susijęs su projektu ir / arba programa, finansuojama Europos Sąjungos ar kitų šalių fondų lėšomis?"]),
            sfmis,
            sfmis,
            atsakymas(eilute["5. Ar pirkimas atliekamas Centrinės viešųjų pirkimų informacinės sistemos priemonėmis (elektroninis pirkimas)"]),
            tekstas(eilute["5.1. Priežastys, dėl kurių nuspręsta paraiškų dėl kvalifikavimo pagal kvalifikacijos vertinimo sistemą (tik pagal Komunalinio sektoriaus pirkimų įstatymą), paraiškų, pasiūlymų, sprendinių, projekto konkursų planų ir projektų pateikimui naudoti kitas nei Centrinės viešųjų pirkimų informacinės sistemos ar kitas elektronines priemones (pildyti, jeigu naudojamos kitos nei centrinės viešųjų pirkimų informacinės sistemos ar kitos elektroninės priemonės)"]),
            atsakymas(eilute["1 . Ar pirkimo įgaliojimai buvo suteikti kitai perkančiajai organizacijai arba kitam perkančiajam subjektui, ar pirkimą atliko centrinė perkančioji organizacija?"]),
            atsakymas(eilute["1. Ar šis pirkimas atliktas siekiant sudaryti preliminariąją sutartį?"]),
            atsakymas(eilute["2. Ar šis pirkimas atliktas siekiant sukurti dinaminę pirkimo sistemą?"]),
            sveikas(pirma(eilute,
                "5. Pirkimo objektų dalys, dėl kurių tiekėjai buvo prašomi pateikti atskirus pasiūlymus (dalių skaičius pirkime)",
                "4. Pirkimo objektų dalių kiekis")),
            budai.get(pirkimoBudas(eilute, seima)) ?? null,
            tekstas(eilute["2. Pirkimo būdo pasirinkimo pagrindimas"]),
            atsakymas(eilute["2.1. Ar taikomas Viešųjų pirkimų įstatymo 47 straipsnio 3 dalies 1 punkte įtvirtintas kvalifikacijos reikalavimas, kuriuo nustatyta tiekėjo veiklos pajamų suma daugiau kaip du kartus didesnė už numatomą atliekamo pirkimo vertę"]),
            tekstas(eilute["2.2. Priežastys, jeigu pirkimo dokumentuose reikalaujama metinė tiekėjo veiklos pajamų suma yra daugiau kaip du kartus didesnė už numatomą atliekamo pirkimo vertę, kaip nustatyta Viešųjų pirkimų įstatymo 47 straipsnio 3 dalies 1 punkte"]),
            atsakymas(eilute["1. Pretenzijos: Ar buvo pateikta (-os) pretenzija (-os) perkančiajai organizacijai arba perkančiajam subjektui?"]),
            atsakymas(eilute["2. Ieškiniai teismui: Ar buvo pateiktas (-i) ieškinys (-iai) teismui?"]),
            atsakymas(eilute["3.1. Interesų konfliktai: Ar buvo nustatytas interesų konfliktas?"]),
            tekstas(eilute["3.2. Interesų konfliktai: Priemonės, kurių ėmėsi perkančioji organizacija arba perkantysis subjektas, dėl nustatyto interesų konflikto"]),
            atsakymas(eilute["4.1. Priemonės, siekiant išvengti konkurencijos iškraipymų: Ar pirkimo procedūrose dalyvavo kandidatas ar dalyvis, kuris pats ar su juo bendradarbiaujantis ūkio subjektas padėjo pasirengti pirkimui?"]),
            tekstas(eilute["4.2. Priemonės, siekiant išvengti konkurencijos iškraipymų: Priemonės, kurių ėmėsi perkančioji organizacija arba perkantysis subjektas, kad nebūtų pažeista konkurencija ir būtų užtikrintas tiekėjų lygiateisiškumo principo laikymasis"]),
            atsakymas(eilute["1. Ar pirkimas susijęs su įslaptinta informacija?"]),
            atsakymas(eilute["1.1 Pirkimo procedūrų metu naudota (bus naudojama) įslaptinta informacija"]),
            atsakymas(eilute["1.1 Sutarties vykdymo metu naudota (bus naudojama) įslaptinta informacija"]),
            tekstas(eilute["1.1 Įslaptinta informacija naudota (bus naudojama) / KITA (įrašykite)"]),
            tekstas(eilute["1.2. Įslaptintos informacijos aukščiausia slaptumo žyma / (pasirinkti iš sąrašo)"]),
        ];
    }), {
        konfliktas: "(submission_id)",
        atnaujinti: [
            "procurement_number", "object_name", "procurement_value_class",
            "procedure_method_id",
        ],
    });

    const konkursai = pirkimai
        .filter(({ seima }) => seima === "design_contest")
        .map(({ seima, eilute }) => [kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`)]);
    await irasyti(client, "design_contest_report", ["submission_id"], konkursai,
        { konfliktas: "(submission_id)" });
}

/**
 * Koncesijų antraštės → concession_report.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} visosEilutes
 */
async function importuotiKoncesijuAtaskaitas(client, kontekstas, visosEilutes) {
    const koncesijos = visosEilutes.filter(({ seima }) => seima === "concession");
    if (!koncesijos.length) return;

    await irasyti(client, "concession_report", [
        "submission_id", "concession_number", "concession_name", "concession_value_class",
        "related_to_funded_project", "granting_authority_count",
    ], koncesijos.map(({ eilute }) => [
        kontekstas.ataskaitos.get(`concession:${eilute[SALTINIO_ID]}`),
        tekstas(eilute["1.1. Koncesijos numeris"]),
        tekstas(eilute["2.1. Koncesijos pavadinimas"]) ?? "",
        tekstas(eilute["3. Koncesijos vertė / (pasirinkti iš sąrašo)"]),
        atsakymas(eilute["4. Ar koncesija yra susijusi su projektu ir / arba programa, finansuojama Europos Sąjungos ar kitų šalių fondų lėšomis?"]),
        sveikas(eilute["Suteikiančiųjų institucijų skaičius"]),
    ]), {
        konfliktas: "(submission_id)",
        atnaujinti: ["concession_number", "concession_name", "concession_value_class"],
    });
}

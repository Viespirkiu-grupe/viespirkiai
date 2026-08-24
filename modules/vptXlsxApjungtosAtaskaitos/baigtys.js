import { irasyti, zodynas } from "./db.js";
import { atsakymas, data, dalys as skaidyti, pirma, skaicius, sveikas, tekstas } from "./reiksmes.js";
import { irasytiSubjektus, rastiSubjekta } from "./subjektai.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

/** Procedūrų pabaigos lapai. */
export const PABAIGU_LAPAI = [
    { failas: "ATN1_XLSX_END_OF_PROC.xlsx", lapas: "ATN1_XLSX_END_OF_PROC", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "VIII.", seima: "gppa" },
    { failas: "Projekto konkursai.xlsx", lapas: "X.", seima: "design_contest" },
    { failas: "Koncesijos.xlsx", lapas: "VII.1-2", seima: "concession" },
];

/** Sutarčių lapai. */
export const SUTARCIU_LAPAI = [
    { failas: "ATN1_XLSX_CONTRACT_LIST.xlsx", lapas: "ATN1_XLSX_CONTRACT_LIST", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "IX.", seima: "gppa" },
    { failas: "Projekto konkursai.xlsx", lapas: "XII.", seima: "design_contest" },
    { failas: "Koncesijos.xlsx", lapas: "VII.3", seima: "concession" },
];

const TRANSPORTO_ANTRASTE = /^(Visų|Netaršių|Visai netaršių) (N[1-3]|M[1-3]) kategorijos/;

/** Vaidmuo sutartyje pagal ataskaitos šeimą. */
const SUTARTIES_VAIDMUO = {
    design_contest: "winner",
    concession: "concessionaire",
};

/**
 * Procedūrų pabaigos → procedure_outcome (+ dalys).
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiPabaigas(client, kontekstas, eilutes) {
    const paruostos = eilutes.map(({ seima, eilute }) => ({
        ataskaitosId: kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`),
        vaikoId: sveikas(pirma(eilute, "ID2_X", "ID2", "ID_VII1")),
        pabaiga: tekstas(pirma(eilute,
            "Pirkimo (projekto konkurso) procedūrų pabaiga",
            "Pirkimo (projekto konkurso) procedūrų pabaiga / (pasirinkti iš sąrašo)",
            "Koncesijos procedūrų pabaiga / (pasirinkti iš sąrašo)")),
        eilute,
    })).filter((p) => p.ataskaitosId && p.pabaiga);

    const tipai = await zodynas(client, "procedure_end_type", "name",
        paruostos.map((p) => p.pabaiga));

    const pabaigos = await irasyti(client, "procedure_outcome", [
        "submission_id", "source_record_id", "end_type_id", "decision_date",
        "decision_reason", "termination_reason",
    ], paruostos.map((p) => [
        p.ataskaitosId, p.vaikoId, tipai.get(p.pabaiga),
        data(pirma(p.eilute, "Sprendimo priėmimo data", "Spendimo priėmimo data")),
        tekstas(p.eilute["Sprendimą nulėmusios priežastys"]),
        tekstas(pirma(p.eilute,
            "Priežastys, dėl kurių buvo nutrauktos pirkimo procedūros ar buvo nesukurta dinaminė pirkimo sistema (kai ją buvo numatoma sukurti)",
            "Priežastys, dėl kurių buvo nutrauktos pirkimo procedūros ar buvo nesukurta dinaminė pirkimo sistema (kai ją buvo numatoma sukurti) (pasirinkti iš sąrašo)",
            "Priežastys, dėl kurių buvo nutrauktos pirkimo (projekto konkurso) procedūros ar buvo nesukurta dinaminė pirkimo sistema (kai ją buvo numatoma sukurti) / (pasirinkti iš sąrašo)",
            "Priežastys, dėl kurių buvo nutrauktos koncesijos suteikimo procedūros (pasirinkti iš sąrašo)")),
    ]), {
        konfliktas: "(submission_id, source_record_id)",
        atnaujinti: ["end_type_id", "decision_date", "decision_reason"],
        grazinti: "id, submission_id, source_record_id",
    });

    const pagalRakta = new Map(pabaigos.map((row) =>
        [`${row.submission_id}:${row.source_record_id}`, Number(row.id)]));
    const rysiai = new Set();

    for (const p of paruostos) {
        const pabaigosId = pagalRakta.get(`${p.ataskaitosId}:${p.vaikoId}`);
        if (!pabaigosId) continue;
        for (const dalis of skaidyti(pirma(p.eilute,
            "Pirkimo objekto dalies (-ių)  numeris (-iai)",
            "Projektuojamo objekto dalies (-ių)  numeris (-iai)",
            "Koncesijos dalies (-ių)  numeris (-iai)"))) {
            const dalisId = kontekstas.dalys.get(`${p.ataskaitosId}:${sveikas(dalis)}`);
            if (dalisId) rysiai.add(`${pabaigosId}:${dalisId}`);
        }
    }

    await irasyti(client, "procedure_outcome_lot", ["outcome_id", "lot_id"],
        [...rysiai].map((raktas) => raktas.split(":").map(Number)),
        { konfliktas: "(outcome_id, lot_id)" });
}

/**
 * Sutartys, jų šalys, dalys ir transporto priemonių rodikliai.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiSutartis(client, kontekstas, eilutes) {
    const paruostos = eilutes.map(({ seima, eilute }) => ({
        seima,
        ataskaitosId: kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`),
        vaikoId: sveikas(pirma(eilute, "ID2_XI", "ID2", "ID_VII3")),
        kodas: tekstas(pirma(eilute, "Tiekėjo kodas", "Laimėtojo kodas", "Koncesininko kodas")),
        vardas: tekstas(pirma(eilute,
            "Tiekėjo pavadinimas", "Laimėtojo pavadinimas",
            "Koncesininko pavadinimas (jeigu koncesijos sutartis sudaroma su ekonominės veiklos vykdytojų grupe, celėje nurodomas grupės pavadinimas ir išvardinami visi grupės nariai)")),
        eilute,
    })).filter((p) => p.ataskaitosId);

    await irasytiSubjektus(client, kontekstas.subjektai,
        paruostos.filter((p) => p.vardas).map((p) => ({ kodas: p.kodas, vardas: p.vardas })));

    const sutartys = await irasyti(client, "contract", [
        "submission_id", "source_record_id", "contract_number", "signed_on", "valid_until",
        "estimated_value", "value_is_estimated", "award_value", "subcontracting_planned",
        "known_subcontractor_information", "centralized", "green_procurement",
        "energy_list_item", "energy_efficiency_requirements", "innovative_product",
        "clean_vehicle_rules_apply",
    ], paruostos.map((p) => sutartiesReiksmes(p)), {
        konfliktas: "(submission_id, source_record_id)",
        atnaujinti: ["signed_on", "valid_until", "estimated_value"],
        grazinti: "id, submission_id, source_record_id",
    });

    const pagalRakta = new Map(sutartys.map((row) =>
        [`${row.submission_id}:${row.source_record_id}`, Number(row.id)]));
    for (const [raktas, id] of pagalRakta) kontekstas.sutartys.set(raktas, id);

    const salys = [];
    const daliuRysiai = new Set();
    const transportas = [];

    for (const p of paruostos) {
        const sutartiesId = pagalRakta.get(`${p.ataskaitosId}:${p.vaikoId}`);
        if (!sutartiesId) continue;

        const subjektoId = p.vardas
            ? rastiSubjekta(kontekstas.subjektai, p.kodas, p.vardas)
            : null;
        if (subjektoId) {
            salys.push([
                sutartiesId, subjektoId,
                SUTARTIES_VAIDMUO[p.seima] ?? "supplier", p.vardas,
            ]);
        }

        for (const dalis of skaidyti(pirma(p.eilute,
            "Pirkimo objekto dalies (-ių) numeris (-iai)",
            "Projektuojamo objekto dalies (-ių)  numeris (-iai)",
            "Koncesijos dalies (-ių) numeris (-iai)"))) {
            const dalisId = kontekstas.dalys.get(`${p.ataskaitosId}:${sveikas(dalis)}`);
            if (dalisId) daliuRysiai.add(`${sutartiesId}:${dalisId}`);
        }

        transportas.push(...transportoRodikliai(sutartiesId, p.eilute));
    }

    await irasyti(client, "contract_party",
        ["contract_id", "party_id", "role", "name_as_reported"], salys,
        { konfliktas: "" });

    await irasyti(client, "contract_lot", ["contract_id", "lot_id"],
        [...daliuRysiai].map((raktas) => raktas.split(":").map(Number)),
        { konfliktas: "(contract_id, lot_id)" });

    await irasyti(client, "contract_vehicle_count",
        ["contract_id", "vehicle_category", "cleanliness", "vehicle_count"], transportas,
        { konfliktas: "(contract_id, vehicle_category, cleanliness)", atnaujinti: ["vehicle_count"] });
}

/** @param {object} p */
function sutartiesReiksmes(p) {
    const eilute = p.eilute;
    return [
        p.ataskaitosId, p.vaikoId,
        tekstas(eilute["Koncesijos sutarties eilės numeris"]),
        data(pirma(eilute, "Sutarties sudarymo data",
            "Pirkimo sutarties (preliminariosios sutarties) sudarymo data",
            "Koncesijos sutarties sudarymo data")),
        data(pirma(eilute, "Sutarties galiojimo terminas",
            "Numatoma pirkimo sutarties galiojimo pabaigos data",
            "Koncesijos sutarties galiojimo terminas (data)")),
        skaicius(pirma(eilute, "Bendra numatoma sutarties vertė (Eur)",
            "Sutartyje nustatyta bendra pirkimo objekto dalies (-ių) vertė/ Bendra numatoma sutarties vertė (Eur)",
            "Pirkimo sutartyje (preliminariojoje sutartyje) nustatyta bendra pirkimo objekto dalies (-ių) vertė (Eur)",
            "Koncesijos vertė (Eur)")),
        atsakymas(eilute["Ar sutarties vertė yra orientacinė?"]),
        skaicius(eilute["Apdovanojimo vertė (Eur)"]),
        atsakymas(pirma(eilute,
            "XI.2.1 Ar ketinama sudaryti subrangos, subtiekimo ar subteikimo sutartį?",
            "IX.2.1 Ar ketinama sudaryti subrangos, subtiekimo ar subteikimo sutartį?")),
        tekstas(pirma(eilute,
            'Jei XI.2.1 pažymėta "Taip" arba "Nežinoma", nurodykite subrangovų informaciją, kuri yra žinoma',
            'Jei XI.2.1 pažymėta "Taip", nurodykite subrangovų informaciją, kuri yra žinoma (subrangovų, subtiekėjų, subteikėjų kodai, pavadinimai, šalys, ir subrangos apimtis)')),
        atsakymas(eilute["XI.2.2 Ar buvo atliktas centralizuotas pirkimas, ar pagal įgaliojimą, ar bendrai atliktas pirkimas, ar skirtingų valstybių narių perkančiųjų organizacijų ar perkančiųjų subjektų bendrai atliktas pirkimas?"]),
        atsakymas(pirma(eilute, "XI.2.3 Ar buvo vykdomas žaliasis pirkimas?",
            "Ar buvo vykdomas žaliasis pirkimas?")),
        atsakymas(eilute["XI.2.4 Ar buvo perkama prekė (-ės), nurodyta (-os) Lietuvos Respublikos energetikos ministro įsakymu patvirtintame prekių, išskyrus kelių transporto priemones, kurioms viešųjų pirkimų metu taikomi energijos vartojimo efektyvumo reikalavimai, sąraše? Paslaugų pirkimo atveju, perkamai paslaugai teikti bus naudojama prekė, kuri įsigyta iš minėto sąrašo."]),
        atsakymas(pirma(eilute,
            'Pildoma, jei 2.4.1. pažymėta "Taip": / Ar buvo taikomi energijos vartojimo efektyvumo reikalavimai?',
            "Ar buvo taikomi energijos vartojimo efektyvumo reikalavimai?")),
        atsakymas(pirma(eilute, "XI.2.6 Ar vykdant pirkimą buvo įsigytas inovatyvus produktas?",
            "Ar vykdant pirkimą buvo įsigytas inovatyvus produktas?")),
        atsakymas(eilute["XI.2.5 Ar perkamos kelių transporto priemonės arba kelių transporto priemonėmis teikiamos viešojo kelių transporto, specialiojo keleivinio kelių transporto, nereguliaraus keleivinio transporto, atliekų rinkimo, pašto siuntų vežimo keliais, siuntinių vežimo, pašto pristatymo ir siuntinių pristatymo paslaugos, kurioms taikomos Lietuvos Respublikos alternatyviųjų degalų įstatymo nuostatos?"]),
    ];
}

/**
 * ATN1 XI skiltyse išbarstyti transporto priemonių kiekiai.
 *
 * @param {number} sutartiesId
 * @param {Record<string, unknown>} eilute
 */
function transportoRodikliai(sutartiesId, eilute) {
    const irasai = [];
    for (const [antraste, reiksme] of Object.entries(eilute)) {
        const atitikmuo = TRANSPORTO_ANTRASTE.exec(antraste);
        if (!atitikmuo) continue;
        const kiekis = sveikas(reiksme);
        if (kiekis === null || kiekis < 0) continue;
        const svara = antraste.startsWith("Visai netaršių")
            ? "zero_emission"
            : antraste.startsWith("Netaršių") ? "clean" : "all";
        const kategorija = atitikmuo[2];
        // Schemos apribojimas: „visai netaršios“ kategorijos tik N2, N3, M3.
        if (svara === "zero_emission" && !["N2", "N3", "M3"].includes(kategorija)) continue;
        irasai.push([sutartiesId, kategorija, svara, kiekis]);
    }
    return irasai;
}

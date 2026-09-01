import { irasyti, zodynas } from "./db.js";
import { atnaujinti } from "./kriterijai.js";
import { atsakymas, skaicius, sveikas, tekstas } from "./reiksmes.js";
import { importuotiBvpz } from "./institucijos.js";
import { irasytiSubjektus, rastiSubjekta } from "./subjektai.js";
import { SALTINIO_ID, lapas } from "./xlsxSkaitymas.js";

const INSTITUCIJA = {
    kodas: "Suteikiančiosios institucijos kodas",
    vardas: "Suteikiančiosios institucijos pavadinimas",
    adresas: "Suteikiančiosios institucijos adresas",
    tipas: "Suteikiančiosios institucijos tipas pagal Koncesijų įstatymo (KĮ) 15 str. 1 dalį (pasirinkite iš sąrašo KĮ str., dalį, punktą) / (pasirinkti iš sąrašo)",
};

/**
 * Koncesijų ataskaitų papildomi lapai (II.–VIII.).
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {Map<string, Record<string, unknown>[]>} lapai - Koncesijos.xlsx lapai.
 */
export async function importuotiKoncesijas(client, kontekstas, lapai) {
    await suteikianciosiosInstitucijos(client, kontekstas, lapas(lapai, "II."));
    await koncesijosDalykas(client, kontekstas, lapas(lapai, "II.1–III."));
    await suteikimoBudas(client, kontekstas, lapas(lapai, "IV."));
    await dalyviuEtapai(client, kontekstas, lapas(lapai, "V."));
    await ataskaitosPapildymai(client, kontekstas, lapai);
    await koncesijuSutartys(client, kontekstas, lapas(lapai, "VII.3"));
}

/** @param {Record<string, unknown>} eilute */
function ataskaitosId(kontekstas, eilute) {
    return kontekstas.ataskaitos.get(`concession:${eilute[SALTINIO_ID]}`);
}

/** II. lapas – suteikiančiosios institucijos. */
async function suteikianciosiosInstitucijos(client, kontekstas, eilutes) {
    const paruostos = eilutes.map((eilute) => ({
        ataskaitosId: ataskaitosId(kontekstas, eilute),
        kodas: tekstas(eilute[INSTITUCIJA.kodas]),
        vardas: tekstas(eilute[INSTITUCIJA.vardas]),
        tipas: tekstas(eilute[INSTITUCIJA.tipas]),
        eilute,
    })).filter((p) => p.ataskaitosId && p.kodas && p.vardas);

    await irasytiSubjektus(client, kontekstas.subjektai, paruostos);
    const tipai = await zodynas(client, "organization_type", "name",
        paruostos.map((p) => p.tipas));

    const eilesNumeriai = new Map();
    const irasai = paruostos.map((p) => {
        const numeris = (eilesNumeriai.get(p.ataskaitosId) ?? 0) + 1;
        eilesNumeriai.set(p.ataskaitosId, numeris);
        return [
            p.ataskaitosId,
            rastiSubjekta(kontekstas.subjektai, p.kodas, p.vardas),
            "granting_authority",
            p.tipas ? tipai.get(p.tipas) ?? null : null,
            tekstas(p.eilute[INSTITUCIJA.adresas]),
            p.vardas,
            tekstas(p.eilute["Kita informacija"]),
            numeris,
        ];
    }).filter((eilute) => eilute[1] !== null);

    await irasyti(client, "report_party", [
        "submission_id", "party_id", "role", "organization_type_id", "address",
        "name_as_reported", "other_information", "ordinal",
    ], irasai, {
        konfliktas: "(submission_id, role, ordinal)",
        atnaujinti: ["party_id", "organization_type_id", "address"],
    });
}

/** II.1–III. lapas – koncesijos dalykas, įgaliotoji institucija ir BVPŽ. */
async function koncesijosDalykas(client, kontekstas, eilutes) {
    const paruostos = eilutes.map((eilute) => ({
        ataskaitosId: ataskaitosId(kontekstas, eilute),
        kodas: tekstas(eilute[INSTITUCIJA.kodas]),
        vardas: tekstas(eilute[INSTITUCIJA.vardas]),
        eilute,
    })).filter((p) => p.ataskaitosId);

    await irasytiSubjektus(client, kontekstas.subjektai,
        paruostos.filter((p) => p.kodas && p.vardas));

    const irasai = paruostos.map((p) => [
        p.ataskaitosId,
        p.kodas ? rastiSubjekta(kontekstas.subjektai, p.kodas, p.vardas) : null,
        "authorized_authority",
        tekstas(p.eilute[INSTITUCIJA.adresas]),
        p.vardas,
        tekstas(p.eilute["Kita informacija"]),
    ]).filter((eilute) => eilute[1] !== null);

    await irasyti(client, "report_party", [
        "submission_id", "party_id", "role", "address", "name_as_reported",
        "other_information",
    ], irasai, {
        konfliktas: "(submission_id, role, ordinal)",
        atnaujinti: ["party_id", "address"],
    });

    for (const p of paruostos) {
        await atnaujinti(client, "concession_report", "submission_id", p.ataskaitosId, {
            authorization_delegated: atsakymas(p.eilute["1 . Ar koncesijos suteikimo procedūros atlikimo įgaliojimai buvo suteikti kitai suteikiančiai institucijai?"]),
            contract_type: tekstas(p.eilute["2. Koncesijos sutarties tipas"]),
            lot_count: sveikas(p.eilute["3. Koncesijos dalyko dalių kiekis"]),
        });
    }

    await importuotiBvpz(client, paruostos.flatMap((p) => [
        {
            ataskaitosId: p.ataskaitosId, sritis: "main",
            reiksme: p.eilute["1. Pagrindinis koncesijos dalyko kodas pagal BVPŽ / (pasirinkti iš sąrašo)"],
        },
        {
            ataskaitosId: p.ataskaitosId, sritis: "additional",
            reiksme: p.eilute["Papildomas (-i) koncesijos kodas (-ai) pagal BVPŽ (kodus atskirkite kableliu)"],
        },
    ]), "concession_cpv");
}

/** IV. lapas – koncesijos suteikimo būdas. */
async function suteikimoBudas(client, kontekstas, eilutes) {
    const paruostos = eilutes.map((eilute) => ({
        ataskaitosId: ataskaitosId(kontekstas, eilute),
        budas: tekstas(eilute["1. Koncesijos suteikimo būdo pavadinimas / (pasirinkite iš sąrašo)"]),
        eilute,
    })).filter((p) => p.ataskaitosId);

    const budai = await zodynas(client, "procedure_method", "name",
        paruostos.map((p) => p.budas));

    for (const p of paruostos) {
        await atnaujinti(client, "concession_report", "submission_id", p.ataskaitosId, {
            procedure_method_id: p.budas ? budai.get(p.budas) ?? null : null,
            procedure_method_reason: tekstas(p.eilute["2. Koncesijos suteikimo būdo pasirinkimo pagrindimas (nurodomas atitinkamas Koncesijų įstatymo straipsnis, straipsnio dalis ir dalies punktas, kuriuo vadovaujantis pasirinktas koncesijų suteikimo būdas: be konkurso, buvo vykdomas konkurencinis dialogas)"]),
            no_notice_reason: tekstas(p.eilute["3. Koncesijos suteikimo neskelbiant apie koncesiją pagrindimas (nurodomas atitinkamas Koncesijų įstatymo straipsnis, straipsnio dalis ir dalies punktas, kuriuo vadovaujantis nebuvo paskelbta apie koncesiją)"]),
        });
    }
}

/** V. lapas – dalyvių dalyvavimo etapai. */
async function dalyviuEtapai(client, kontekstas, eilutes) {
    const irasai = eilutes.map((eilute) => {
        const ataskaita = ataskaitosId(kontekstas, eilute);
        const dalyvioId = kontekstas.dalyviai.get(`${ataskaita}:${sveikas(eilute["ID_V"])}`);
        if (!dalyvioId) return null;
        return [
            dalyvioId,
            atsakymas(eilute["Pateikė paraišką / (taip / ne)"]),
            atsakymas(eilute["Pateikė preliminarų neįsipareigojamąjį pasiūlymą (konkurencinio dialogo atveju – pateikė sprendinius) / (taip / ne)"]),
            tekstas(eilute["Priežastys, jeigu nepateikė neįsipareigojamojo pasiūlymo (konkurencinio dialogo atveju – nepateikė sprendinių) / (pasirinkite iš sąrašo)"]),
            atsakymas(eilute["Pateikė išsamų įsipareigojamąjį pasiūlymą"]),
            tekstas(eilute["Priežastys, jeigu nepateikė išsamaus įsipareigojamojo pasiūlymo / (pasirinkite iš sąrašo)"]),
            atsakymas(eilute["Po vykdytų derybų pateikė galutinį pasiūlymą (po vykdyto konkurencinio dialogo pateikė galutinį pasiūlymą)"]),
            tekstas(eilute["Priežastys, jeigu po vykdytų derybų nepateikė galutinio pasiūlymo (po vykdyto konkurencinio dialogo nepateikė galutinio pasiūlymo) / (pasirinkite iš sąrašo)"]),
            atsakymas(eilute["Ar dalyvis (-iai) buvo pašalintas (-ti) iš koncesijos suteikimo procedūros dėl jo (jų) atitikties suteikiančiosios institucijos nustatytiems pašalinimo pagrindams? / (taip / ne)"]),
            tekstas(eilute["Pašalinimo pagrindai: / Koncesijų įstatymo straipsnis, dalis, punktas"]),
        ];
    }).filter(Boolean);

    await irasyti(client, "concession_candidate_stage", [
        "participation_id", "applied", "preliminary_offer_submitted",
        "preliminary_offer_missing_reason", "binding_offer_submitted",
        "binding_offer_missing_reason", "final_offer_submitted",
        "final_offer_missing_reason", "excluded", "exclusion_legal_basis",
    ], irasai, { konfliktas: "(participation_id)" });
}

/** V.4, VI. ir VIII. lapai – likę ataskaitos laukai. */
async function ataskaitosPapildymai(client, kontekstas, lapai) {
    for (const eilute of lapas(lapai, "V.4")) {
        const ataskaita = ataskaitosId(kontekstas, eilute);
        if (!ataskaita) continue;
        await atnaujinti(client, "concession_report", "submission_id", ataskaita, {
            turnover_requirement_applied: atsakymas(eilute["4.1 Ar buvo taikomas Koncesijų įstatymo 43 straipsnio 1 dalies 1 punkte įtvirtintas kvalifikacijos reikalavimas, kuriuo nustatyta reikalaujama metinė dalyvio veiklos pajamų suma daugiau kaip du kartus didesnė už numatomą koncesijos vertę (jeigu pažymima „TAIP“, pildomas 4.2 papunktis)"]),
            turnover_requirement_reason: tekstas(eilute["4.2 Priežastys, jeigu koncesijos dokumentuose reikalaujama metinė dalyvio veiklos pajamų suma yra daugiau kaip du kartus didesnė už numatomą koncesijos vertę, kaip nustatyta Koncesijų įstatymo 43 straipsnio 1 dalies 1 punkte"]),
        });
    }

    for (const eilute of lapas(lapai, "VI.")) {
        const ataskaita = ataskaitosId(kontekstas, eilute);
        if (!ataskaita) continue;
        await atnaujinti(client, "concession_report", "submission_id", ataskaita, {
            claims_submitted: atsakymas(eilute["1. Pretenzijos: Ar buvo pateikta (-os) pretenzija (-os) suteikiančiai institucijai?"]),
            lawsuits_submitted: atsakymas(eilute["2. Ieškiniai teismui: Ar buvo pateiktas (-i) ieškinys (-iai) teismui?"]),
        });
    }

    for (const eilute of lapas(lapai, "VIII.")) {
        const ataskaita = ataskaitosId(kontekstas, eilute);
        if (!ataskaita) continue;
        await atnaujinti(client, "submission", "id", ataskaita, {
            responsible_person_name: tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą vardas, pavardė"]),
            responsible_phone: tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą telefono numeris"]),
            responsible_email: tekstas(eilute["Asmens, atsakingo už ataskaitos pildymą elektroninio pašto adresas"]),
        });
    }
}

/** VII.3 lapas – koncesijos sutarties papildomi laukai. */
async function koncesijuSutartys(client, kontekstas, eilutes) {
    const irasai = eilutes.map((eilute) => {
        const ataskaita = ataskaitosId(kontekstas, eilute);
        const sutartiesId = kontekstas.sutartys.get(`${ataskaita}:${sveikas(eilute["ID_VII3"])}`);
        if (!sutartiesId) return null;
        return [
            sutartiesId,
            sveikas(eilute["Koncesijos sutarties eilės numeris"]),
            skaicius(eilute["Koncesijos vertė (Eur)"]),
        ];
    }).filter(Boolean);

    await irasyti(client, "concession_contract",
        ["contract_id", "contract_sequence", "concession_value"], irasai, {
            konfliktas: "(contract_id)",
            atnaujinti: ["contract_sequence", "concession_value"],
        });
}

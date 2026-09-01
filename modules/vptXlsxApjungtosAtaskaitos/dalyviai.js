import { irasyti } from "./db.js";
import { atsakymas, dalys as skaidyti, pirma, skaicius, sveikas, tekstas } from "./reiksmes.js";
import { irasytiSubjektus, rastiSubjekta } from "./subjektai.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

/** Kandidatų ir dalyvių lapai. */
export const DALYVIU_LAPAI = [
    { failas: "ATN1_XLSX_CONTRACTED_CAND_LIST.xlsx", lapas: "ATN1_XLSX_CONTRACTED_CAND_LIST", seima: "atn1" },
    { failas: "ATN1_XLSX_REJECTED_CAND_LIST.xlsx", lapas: "ATN1_XLSX_REJECTED_CAND_LIST", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "V.", seima: "gppa" },
    { failas: "GPPA.xlsx", lapas: "VI.2", seima: "gppa" },
    { failas: "GPPA.xlsx", lapas: "VI.3", seima: "gppa" },
    { failas: "Projekto konkursai.xlsx", lapas: "VI.", seima: "design_contest" },
    { failas: "Projekto konkursai.xlsx", lapas: "VIII.1", seima: "design_contest" },
    { failas: "Projekto konkursai.xlsx", lapas: "VIII.2", seima: "design_contest" },
    { failas: "Koncesijos.xlsx", lapas: "V.", seima: "concession" },
    { failas: "Koncesijos.xlsx", lapas: "V.5", seima: "concession" },
];

/** Lapai, kuriuose be dalyvio yra ir pasiūlymo duomenys. */
const PASIULYMU_LAPAI = new Set([
    "ATN1_XLSX_CONTRACTED_CAND_LIST", "ATN1_XLSX_REJECTED_CAND_LIST",
    "VI.2", "VI.3", "VIII.1", "VIII.2", "V.5",
]);

/** Lapai, kuriuose pasiūlymas yra atmestas. */
const ATMESTU_LAPAI = new Set(["ATN1_XLSX_REJECTED_CAND_LIST", "VI.2", "VIII.1"]);

/** Lapai, kuriuose fiksuojami kandidatai (o ne dalyviai). */
const KANDIDATU_LAPAI = new Set(["V.", "VI."]);

/** @param {Record<string, unknown>} eilute */
function vaikoId(eilute) {
    return sveikas(pirma(eilute, "ID2", "ID2_VII_2", "ID2_VII_3", "ID_V", "ID_V4"));
}

/** @param {Record<string, unknown>} eilute */
function dalyvioKodas(eilute) {
    return tekstas(pirma(eilute,
        "Dalyvio (kandidato) kodas (nepildoma fiziniams asmenims)",
        "Dalyvio kodas (nepildoma fiziniams asmenims)",
        "Kandidato kodas (nepildoma fiziniams asmenims)",
        "Koncesijos dalyvio kodas (nepildoma fiziniams asmenims)"));
}

/** @param {Record<string, unknown>} eilute */
function dalyvioVardas(eilute) {
    return tekstas(pirma(eilute,
        "Dalyvio (kandidato) pavadinimas",
        "Dalyvio pavadinimas",
        "Kandidato pavadinimas",
        "Koncesijos dalyvio pavadinimas"));
}

/** @param {Record<string, unknown>} eilute */
function kainosIsraiska(eilute) {
    return tekstas(pirma(eilute,
        "Pasiūlymo kainos / sąnaudų išraiška",
        "Pasiūlymo kainos išraiška (pasirinkti iš sąrašo)"));
}

/**
 * Kandidatai, dalyviai ir jų pasiūlymai.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, lapas: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiDalyvius(client, kontekstas, eilutes) {
    const paruostos = [];
    for (const { seima, lapas, eilute } of eilutes) {
        const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
        const vardas = dalyvioVardas(eilute);
        if (!ataskaitosId || !vardas) continue;
        paruostos.push({
            ataskaitosId, lapas, eilute, vardas,
            kodas: dalyvioKodas(eilute),
            vaikoId: vaikoId(eilute),
            fizinis: atsakymas(eilute["Ar dalyvis yra fizinis asmuo?"]) === "yes",
        });
    }

    await irasytiSubjektus(client, kontekstas.subjektai, paruostos.map((p) => ({
        kodas: p.kodas,
        vardas: p.vardas,
        tipas: p.fizinis ? "natural_person" : p.kodas ? "legal_entity" : "unknown",
    })));

    const dalyviai = await irasyti(client, "participation", [
        "submission_id", "source_record_id", "party_id", "role", "name_as_reported",
        "name_clarification", "address_as_reported", "country_as_reported",
        "group_name", "selection_reason",
    ], paruostos.map((p) => [
        p.ataskaitosId, p.vaikoId,
        rastiSubjekta(kontekstas.subjektai, p.kodas, p.vardas),
        KANDIDATU_LAPAI.has(p.lapas) ? "candidate" : "participant",
        p.vardas,
        tekstas(p.eilute["Dalyvio (kandidato) pavadinimo patikslinimas"]),
        tekstas(p.eilute["Dalyvio adresas (nepildoma fiziniams asmenims)"]),
        tekstas(p.eilute["Dalyvio šalis"]),
        tekstas(p.eilute["Grupė"]),
        tekstas(p.eilute["Atrinktų kandidatų pasirinkimo priežastys"]),
    ]).filter((eilute) => eilute[2] !== null), {
        konfliktas: "(submission_id, source_record_id)",
        atnaujinti: ["party_id", "role", "name_as_reported"],
        grazinti: "id, submission_id, source_record_id",
    });

    for (const row of dalyviai) {
        kontekstas.dalyviai.set(
            `${row.submission_id}:${row.source_record_id}`, Number(row.id));
    }

    await importuotiPasiulymus(client, kontekstas,
        paruostos.filter((p) => PASIULYMU_LAPAI.has(p.lapas)));
}

/**
 * Pasiūlymai, jų dalys ir atmetimo priežastys.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {object[]} paruostos
 */
async function importuotiPasiulymus(client, kontekstas, paruostos) {
    const pasiulymai = await irasyti(client, "offer", [
        "submission_id", "source_record_id", "participation_id", "state", "rank",
        "quality_price_score", "economic_advantage", "amount", "amount_basis",
        "currency_code", "amount_expression", "ranking_characteristics",
    ], paruostos.map((p) => {
        const israiska = kainosIsraiska(p.eilute);
        const eile = sveikas(pirma(p.eilute,
            "Pasiūlymo eilės numeris",
            "Projekto eilės numeris",
            "Dalyvio eilės numeris sąraše, sudarytame pagal suteiktų vertinimų eiliškumą"));
        return [
            p.ataskaitosId, p.vaikoId,
            kontekstas.dalyviai.get(`${p.ataskaitosId}:${p.vaikoId}`) ?? null,
            ATMESTU_LAPAI.has(p.lapas) ? "rejected" : "ranked",
            eile && eile > 0 ? eile : null,
            skaicius(p.eilute["Pasiūlymo kainos ar sąnaudų ir kokybės santykis"]),
            skaicius(p.eilute["Pasiūlymo ekonominis naudingumas"]),
            skaicius(pirma(p.eilute,
                "Pasiūlymo kaina / sąnaudos",
                "Pasiūlymo (pasiūlymo dalies) kaina / sąnaudos",
                "Pasiūlymo (pasiūlymo dalies) kaina",
                "Pasiūlymo kaina")),
            tekstas(pirma(p.eilute, "Kaina / sąnaudos",
                "Pasiūlymo (pasiūlymo dalies) kaina / sąnaudos")),
            israiska === "EUR" ? "EUR" : null,
            israiska,
            tekstas(p.eilute["Pasiūlymo charakteristikos, lėmusios pasiūlymui suteiktą vietą eilėje"]),
        ];
    }), {
        konfliktas: "(submission_id, source_record_id)",
        atnaujinti: ["state", "rank", "amount", "participation_id"],
        grazinti: "id, submission_id, source_record_id, state",
    });

    const pagalRakta = new Map(pasiulymai.map((row) =>
        [`${row.submission_id}:${row.source_record_id}`, row]));
    for (const [raktas, row] of pagalRakta) {
        kontekstas.pasiulymai.set(raktas, Number(row.id));
    }

    const daliuRysiai = new Set();
    const atmetimai = [];

    for (const p of paruostos) {
        const pasiulymas = pagalRakta.get(`${p.ataskaitosId}:${p.vaikoId}`);
        if (!pasiulymas) continue;

        for (const dalis of skaidyti(pirma(p.eilute,
            "Pirkimo dalies numeris",
            "Pirkimo dalies (-ių) numeris (-iai)",
            "Projektuojamo objekto dalies numeris",
            "Koncesijos dalies numeris"))) {
            const dalisId = kontekstas.dalys.get(`${p.ataskaitosId}:${sveikas(dalis)}`);
            if (dalisId) daliuRysiai.add(`${pasiulymas.id}:${dalisId}`);
        }

        if (pasiulymas.state === "rejected") {
            atmetimai.push([
                Number(pasiulymas.id),
                tekstas(p.eilute["Priežastys, dėl kurių kandidatas nebuvo pakviestas teikti pasiūlymo"]),
                tekstas(p.eilute["Priežastys, dėl kurių dalyvis atsiėmė pasiūlymą iki pasiūlymo eilės sudarymo"]),
                tekstas(p.eilute["Pasiūlymų (galutinių pasiūlymų) atmetimo priežastys"]),
            ]);
        }
    }

    await irasyti(client, "offer_lot", ["offer_id", "lot_id"],
        [...daliuRysiai].map((raktas) => raktas.split(":").map(Number)),
        { konfliktas: "(offer_id, lot_id)" });

    await irasyti(client, "offer_rejection",
        ["offer_id", "not_invited_reason", "withdrawal_reason", "rejection_reason"],
        atmetimai, {
            konfliktas: "(offer_id)",
            atnaujinti: ["rejection_reason"],
        });
}

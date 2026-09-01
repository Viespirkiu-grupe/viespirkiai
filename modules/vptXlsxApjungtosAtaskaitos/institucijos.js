import { irasyti } from "./db.js";
import { bvpz, dalys, pirma, tekstas } from "./reiksmes.js";
import { irasytiSubjektus, rastiSubjekta } from "./subjektai.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

const PERKANCIOJI = {
    kodas: "Perkančiosios organizacijos arba perkančiojo subjekto kodas",
    vardas: "Perkančiosios organizacijos arba perkančiojo subjekto pavadinimas",
    adresas: "Perkančiosios organizacijos arba perkančiojo subjekto adresas",
};

const IGALIOTOJI = {
    kodas: "Įgaliotosios perkančiosios organizacijos, įgaliotojo perkančiojo subjekto arba centrinės perkančiosios organizacijos kodas",
    vardas: "Įgaliotosios perkančiosios organizacijos, įgaliotojo perkančiojo subjekto arba centrinės perkančiosios organizacijos pavadinimas",
    adresas: "Įgaliotosios perkančiosios organizacijos, įgaliotojo perkančiojo subjekto arba centrinės perkančiosios organizacijos adresas",
};

const PROJEKTO_ANTRASTE = "Nurodykite projekto kodą ir projekto pavadinimą";

/**
 * Perkančiosios ir įgaliotosios organizacijos → party + report_party.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiInstitucijas(client, kontekstas, eilutes) {
    const pirkimai = eilutes.filter(({ seima }) => seima !== "concession");

    for (const [laukai, vaidmuo] of [[PERKANCIOJI, "contracting_authority"],
        [IGALIOTOJI, "authorized_authority"]]) {
        const kandidatai = pirkimai.map(({ eilute }) => ({
            kodas: tekstas(eilute[laukai.kodas]),
            vardas: tekstas(eilute[laukai.vardas]),
        })).filter(({ kodas, vardas }) => kodas && vardas);

        await irasytiSubjektus(client, kontekstas.subjektai, kandidatai);

        const irasai = [];
        for (const { seima, eilute } of pirkimai) {
            const kodas = tekstas(eilute[laukai.kodas]);
            const subjektoId = kodas
                ? rastiSubjekta(kontekstas.subjektai, kodas, null)
                : null;
            const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
            if (!subjektoId || !ataskaitosId) continue;
            irasai.push([
                ataskaitosId, subjektoId, vaidmuo,
                tekstas(eilute[laukai.adresas]), tekstas(eilute[laukai.vardas]),
            ]);
        }

        await irasyti(client, "report_party",
            ["submission_id", "party_id", "role", "address", "name_as_reported"],
            irasai, {
                konfliktas: "(submission_id, role, ordinal)",
                atnaujinti: ["party_id", "address", "name_as_reported"],
            });
    }
}

/**
 * ES lėšomis finansuojami projektai → funded_project + submission_project.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiProjektus(client, kontekstas, eilutes) {
    const susieti = eilutes
        .map(({ seima, eilute }) => ({
            ataskaitosId: kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`),
            pavadinimas: tekstas(eilute[PROJEKTO_ANTRASTE]),
        }))
        .filter(({ ataskaitosId, pavadinimas }) => ataskaitosId && pavadinimas);
    if (!susieti.length) return;

    const pavadinimai = [...new Set(susieti.map(({ pavadinimas }) => pavadinimas))];
    const projektai = await irasyti(client, "funded_project", ["project_name"],
        pavadinimai.map((pavadinimas) => [pavadinimas]), {
            konfliktas: "(project_code, project_name)",
            atnaujinti: ["project_name"],
            grazinti: "id, project_name",
        });
    const pagalPavadinima = new Map(
        projektai.map((row) => [row.project_name, Number(row.id)]));

    await irasyti(client, "submission_project", ["submission_id", "project_id"],
        [...new Set(susieti.map(({ ataskaitosId, pavadinimas }) =>
            `${ataskaitosId}:${pagalPavadinima.get(pavadinimas)}`))]
            .map((raktas) => raktas.split(":").map(Number)),
        { konfliktas: "(submission_id, project_id)" });
}

/**
 * Ataskaitos lygmens BVPŽ kodai → cpv_code + submission_cpv / concession_cpv.
 *
 * @param {import("pg").PoolClient} client
 * @param {{ataskaitosId: number, sritis: string, reiksme: unknown}[]} saltiniai
 * @param {'submission_cpv'|'concession_cpv'} lentele
 */
export async function importuotiBvpz(client, saltiniai, lentele) {
    const kodai = new Map();
    for (const { ataskaitosId, sritis, reiksme } of saltiniai) {
        if (!ataskaitosId) continue;
        for (const dalis of dalys(reiksme)) {
            const kodas = bvpz(dalis);
            if (!kodas) continue;
            const raktas = `${ataskaitosId}:${sritis}`;
            if (!kodai.has(raktas)) kodai.set(raktas, new Set());
            kodai.get(raktas).add(kodas);
        }
    }
    if (!kodai.size) return;

    const visiKodai = [...new Set([...kodai.values()].flatMap((rinkinys) => [...rinkinys]))];
    await irasyti(client, "cpv_code", ["code"], visiKodai.map((kodas) => [kodas]),
        { konfliktas: "(code)" });

    const irasai = [];
    for (const [raktas, rinkinys] of kodai) {
        const [ataskaitosId, sritis] = raktas.split(":");
        [...rinkinys].sort().forEach((kodas, indeksas) => {
            irasai.push([Number(ataskaitosId), kodas, sritis, indeksas + 1]);
        });
    }

    await irasyti(client, lentele,
        ["submission_id", "cpv_code", "scope", "ordinal"], irasai,
        { konfliktas: "" });
}

/**
 * Ataskaitos antraštės BVPŽ celės (pagrindinis ir papildomi kodai).
 *
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export function antrasciuBvpz(kontekstas, eilutes) {
    return eilutes.flatMap(({ seima, eilute }) => {
        const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
        return [
            {
                ataskaitosId, sritis: "main",
                reiksme: pirma(eilute,
                    "4.1 Pagrindinis pirkimo objekto kodas pagal BVPŽ",
                    "3. Pagrindinis pirkimo objekto kodas pagal BVPŽ / (pasirinkti iš sąrašo)"),
            },
            {
                ataskaitosId, sritis: "additional",
                reiksme: pirma(eilute,
                    "4.2 Papildomas (-i) pirkimo objekto kodas (-ai) pagal BVPŽ (kodus atskirkite kableliu)",
                    "Papildomas (-i) pirkimo objekto kodas (-ai) pagal BVPŽ (įrašyti per kablelį)"),
            },
        ];
    });
}

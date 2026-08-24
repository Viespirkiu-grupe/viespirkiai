import { SCHEMA, irasyti, zodynas } from "./db.js";
import { dalys as skaidyti, pirma, sveikas, tekstas } from "./reiksmes.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

/** Pasiūlymų vertinimo kriterijų lapai. */
export const KRITERIJU_LAPAI = [
    { failas: "ATN1_XLSX_PURCHASE.xlsx", lapas: "ATN1_XLSX_PURCHASE", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "VI.1", seima: "gppa" },
];

/** Lapai, kuriuose fiksuojamos pasiūlymų atmetimo aplinkybės. */
export const ATMETIMU_LAPAI = [
    { failas: "ATN1_XLSX_REJECTED_CAND_LIST.xlsx", lapas: "ATN1_XLSX_REJECTED_CAND_LIST", seima: "atn1" },
    { failas: "GPPA.xlsx", lapas: "VI.2", seima: "gppa" },
];

/**
 * Vertinimo kriterijai → evaluation_criterion + lot_evaluation_criterion.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiKriterijus(client, kontekstas, eilutes) {
    const paruostos = eilutes.map(({ seima, eilute }) => ({
        ataskaitosId: kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`),
        kriterijus: tekstas(pirma(eilute,
            "Pasiūlymų vertinimo kriterijus",
            "Pasiūlymų vertinimo kriterijus /",
            "Pasiūlymų vertinimo kriterijus / (pasirinkti iš sąrašo)")),
        daliuNumeriai: pirma(eilute,
            "Pirkimo dalies (-ių) numeris (-iai)", "Pirkimo dalies numeris"),
    })).filter((p) => p.ataskaitosId && p.kriterijus);

    const kriterijai = await zodynas(client, "evaluation_criterion", "name",
        paruostos.map((p) => p.kriterijus));

    const rysiai = new Set();
    for (const p of paruostos) {
        const kriterijausId = kriterijai.get(p.kriterijus);
        for (const dalis of skaidyti(p.daliuNumeriai)) {
            const dalisId = kontekstas.dalys.get(`${p.ataskaitosId}:${sveikas(dalis)}`);
            if (dalisId && kriterijausId) rysiai.add(`${dalisId}:${kriterijausId}`);
        }
    }

    await irasyti(client, "lot_evaluation_criterion", ["lot_id", "criterion_id"],
        [...rysiai].map((raktas) => raktas.split(":").map(Number)),
        { konfliktas: "(lot_id, criterion_id)" });
}

/**
 * Atmetimo įvykių tipai ir teisiniai pagrindai → offer_rejection.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiAtmetimus(client, kontekstas, eilutes) {
    const paruostos = eilutes.map(({ seima, eilute }) => {
        const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
        const vaikoId = sveikas(pirma(eilute, "ID2_VII_2", "ID2"));
        return {
            pasiulymoId: kontekstas.pasiulymai.get(`${ataskaitosId}:${vaikoId}`),
            ivykis: tekstas(eilute["Pasiūlymų ar galutinių pasiūlymų nepateikimas arba atsiėmimas, pirkimo procedūros nutraukimas, dalyvių pasiūlymų (galutinių pasiūlymų) atmetimas (pasirinkti iš sąrašo)"]),
            pagrindas: tekstas(pirma(eilute,
                "Pasiūlymų (galutinių pasiūlymų) atmetimo teisiniai pagrindai",
                "Pasiūlymų (galutinių pasiūlymų) atmetimo teisiniai pagrindai (pasirinkti iš sąrašo)")),
        };
    }).filter((p) => p.pasiulymoId);

    const ivykiai = await zodynas(client, "rejection_event_type", "name",
        paruostos.map((p) => p.ivykis));
    const pagrindai = await zodynas(client, "rejection_legal_basis", "citation",
        paruostos.map((p) => p.pagrindas));

    const irasai = paruostos
        .filter((p) => p.ivykis || p.pagrindas)
        .map((p) => [
            p.pasiulymoId,
            p.ivykis ? ivykiai.get(p.ivykis) ?? null : null,
            p.pagrindas ? pagrindai.get(p.pagrindas) ?? null : null,
        ]);

    await irasyti(client, "offer_rejection",
        ["offer_id", "event_type_id", "legal_basis_id"], irasai, {
            konfliktas: "(offer_id)",
            atnaujinti: ["event_type_id", "legal_basis_id"],
        });
}

/**
 * Vieno stulpelio atnaujinimas pagal pirminį raktą (mažiems koncesijų lapams).
 *
 * @param {import("pg").PoolClient} client
 * @param {string} lentele
 * @param {string} raktoStulpelis
 * @param {number} raktoReiksme
 * @param {Record<string, unknown>} reiksmes
 */
export async function atnaujinti(client, lentele, raktoStulpelis, raktoReiksme, reiksmes) {
    const stulpeliai = Object.keys(reiksmes);
    if (!stulpeliai.length) return;
    await client.query(
        `UPDATE ${SCHEMA}.${lentele}
            SET ${stulpeliai.map((c, i) => `${c} = $${i + 2}`).join(", ")}
          WHERE ${raktoStulpelis} = $1`,
        [raktoReiksme, ...stulpeliai.map((c) => reiksmes[c])],
    );
}

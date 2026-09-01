import { SCHEMA, irasyti } from "./db.js";
import { bvpz, dalys as skaidyti, pirma, sveikas, tekstas } from "./reiksmes.js";
import { SALTINIO_ID } from "./xlsxSkaitymas.js";

/** Pirkimo (koncesijos) dalių lapai. */
export const DALIU_LAPAI = [
    { failas: "GPPA.xlsx", lapas: "III.5", seima: "gppa" },
    { failas: "Projekto konkursai.xlsx", lapas: "IV.5", seima: "design_contest" },
    { failas: "Koncesijos.xlsx", lapas: "III.4", seima: "concession" },
];

/** @param {Record<string, unknown>} eilute */
function daliesNumeris(eilute) {
    return sveikas(pirma(eilute,
        "Pirkimo dalies numeris",
        "Projektuojamo objekto dalies numeris",
        "Koncesijos dalies numeris"));
}

/** @param {Record<string, unknown>} eilute */
function daliesPavadinimas(eilute) {
    return tekstas(pirma(eilute,
        "Pirkimo dalies pavadinimas",
        "Projektuojamo objekto dalies pavadinimas",
        "Koncesijos dalies pavadinimas"));
}

/**
 * Dalių lapai → lot; papildomai sugeneruojamos dalys pagal `lot_count`.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiDalis(client, kontekstas, eilutes) {
    const irasai = [];
    for (const { seima, eilute } of eilutes) {
        const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
        const numeris = daliesNumeris(eilute);
        if (!ataskaitosId || !numeris || numeris <= 0) continue;
        irasai.push([
            ataskaitosId,
            sveikas(pirma(eilute, "ID2", "ID_III4")),
            numeris,
            daliesPavadinimas(eilute),
        ]);
    }

    await irasyti(client, "lot",
        ["submission_id", "source_record_id", "lot_number", "name"], irasai, {
            konfliktas: "(submission_id, lot_number)",
            atnaujinti: ["name"],
        });

    // Ataskaitos, kuriose dalys atskirai neišvardintos, turi bent tiek dalių,
    // kiek nurodyta antraštėje – jos sugeneruojamos rinkinio užklausa.
    await client.query(`
        INSERT INTO ${SCHEMA}.lot (submission_id, lot_number)
        SELECT pr.submission_id, generated.lot_number
        FROM ${SCHEMA}.procurement_report pr
        CROSS JOIN LATERAL generate_series(1, greatest(coalesce(pr.lot_count, 1), 1))
            generated(lot_number)
        ON CONFLICT (submission_id, lot_number) DO NOTHING
    `);

    await ikeltiDaliuKesa(client, kontekstas);
}

/**
 * Užpildo `submission_id:lot_number → lot_id` kešą.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 */
export async function ikeltiDaliuKesa(client, kontekstas) {
    const { rows } = await client.query(
        `SELECT id, submission_id, lot_number FROM ${SCHEMA}.lot`);
    kontekstas.dalys.clear();
    for (const row of rows) {
        kontekstas.dalys.set(`${row.submission_id}:${row.lot_number}`, Number(row.id));
    }
}

/**
 * Dalių BVPŽ kodai (tik GPPA ir projekto konkursai) → lot_cpv.
 *
 * @param {import("pg").PoolClient} client
 * @param {import("./kontekstas.js").Kontekstas} kontekstas
 * @param {{seima: string, eilute: Record<string, unknown>}[]} eilutes
 */
export async function importuotiDaliuBvpz(client, kontekstas, eilutes) {
    const kodai = new Map();

    for (const { seima, eilute } of eilutes) {
        if (seima === "concession") continue;
        const ataskaitosId = kontekstas.ataskaitos.get(`${seima}:${eilute[SALTINIO_ID]}`);
        const numeris = daliesNumeris(eilute);
        const dalisId = kontekstas.dalys.get(`${ataskaitosId}:${numeris}`);
        if (!dalisId) continue;

        const saltiniai = [
            ["main", pirma(eilute, "Pagrindinis dalies BVPŽ kodas",
                "Pagrindinis dalies BVPŽ kodas (pasirinkite iš sąrašo)")],
            ["additional", eilute["Papildomi dalies BVPŽ kodai (įrašyti per kablelį)"]],
        ];
        for (const [sritis, reiksme] of saltiniai) {
            for (const dalis of skaidyti(reiksme)) {
                const kodas = bvpz(dalis);
                if (!kodas) continue;
                const raktas = `${dalisId}:${sritis}`;
                if (!kodai.has(raktas)) kodai.set(raktas, new Set());
                kodai.get(raktas).add(kodas);
            }
        }
    }

    if (!kodai.size) return;

    const visiKodai = [...new Set([...kodai.values()].flatMap((rinkinys) => [...rinkinys]))];
    await irasyti(client, "cpv_code", ["code"], visiKodai.map((kodas) => [kodas]),
        { konfliktas: "(code)" });

    const irasai = [];
    for (const [raktas, rinkinys] of kodai) {
        const [dalisId, sritis] = raktas.split(":");
        [...rinkinys].sort().forEach((kodas, indeksas) => {
            irasai.push([Number(dalisId), kodas, sritis, indeksas + 1]);
        });
    }

    await irasyti(client, "lot_cpv", ["lot_id", "cpv_code", "scope", "ordinal"], irasai,
        { konfliktas: "" });
}

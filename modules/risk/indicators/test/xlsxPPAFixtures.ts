import { riskDb } from "../../../../postgres/riskDb.js";

// Shared row-insertion helpers for every indicator's collect.it.ts against
// the real xlsxPPA* tables (public.v_dalyviai's real source, replacing the
// old atn1* fixture tables — see migrations/risk/test/001_public_test_tables.sql).
// xlsxPPApirkimoBudai/xlsxPPAatmetimoPriezastys are lookup tables: a fixture
// names a value, and these helpers resolve-or-create the row backing it.

async function lookupOrInsertId(table: string, pavadinimas: string): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO public."${table}" (pavadinimas)
         VALUES ($1)
         ON CONFLICT (pavadinimas) DO UPDATE SET pavadinimas = EXCLUDED.pavadinimas
         RETURNING id`,
        [pavadinimas],
    );
    return rows[0].id;
}

export function lookupOrInsertPirkimoBudas(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("xlsxPPApirkimoBudai", pavadinimas);
}

export function lookupOrInsertAtmetimoPriezastis(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("xlsxPPAatmetimoPriezastys", pavadinimas);
}

export async function insertAtaskaita(params: {
    pirkimoNumeris: string;
    pirkimoBudas: string;
    daliuSkaicius: number;
    sukurtaAt: string;
}): Promise<number> {
    const pirkimoBudasId = await lookupOrInsertPirkimoBudas(params.pirkimoBudas);
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO public."xlsxPPAataskaitos" ("pirkimoNumeris", "pirkimoBudasId", "daliuSkaicius", "sukurtaAt")
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [params.pirkimoNumeris, pirkimoBudasId, params.daliuSkaicius, params.sukurtaAt],
    );
    return rows[0].id;
}

export async function insertDalyvis(params: { ataskaitaId: number; kodas: string | null }): Promise<void> {
    await riskDb.query(`INSERT INTO public."xlsxPPAdalyviai" ("ataskaitaId", "kodas") VALUES ($1, $2)`, [
        params.ataskaitaId,
        params.kodas,
    ]);
}

/** A valid (not rejected) bid. */
export async function insertPasiulymas(params: {
    ataskaitaId: number;
    daliesNumeris: string | null;
    dalyvioKodas: string;
    kaina?: string;
}): Promise<void> {
    await riskDb.query(
        `INSERT INTO public."xlsxPPApasiulymuEile" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "kaina")
         VALUES ($1, $2, $3, $4)`,
        [params.ataskaitaId, params.daliesNumeris, params.dalyvioKodas, params.kaina ?? "1000"],
    );
}

/** A rejected bid — any non-null reason text; decide()/collect.sql only check IS NULL. */
export async function insertAtmestasPasiulymas(params: {
    ataskaitaId: number;
    daliesNumeris: string | null;
    dalyvioKodas: string;
    priezastis?: string;
}): Promise<void> {
    const atmetimoPriezastysId = await lookupOrInsertAtmetimoPriezastis(params.priezastis ?? "Atmestas");
    await riskDb.query(
        `INSERT INTO public."xlsxPPAatmestiPasiulymai" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "atmetimoPriezastysId")
         VALUES ($1, $2, $3, $4)`,
        [params.ataskaitaId, params.daliesNumeris, params.dalyvioKodas, atmetimoPriezastysId],
    );
}

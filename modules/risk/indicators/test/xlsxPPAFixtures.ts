import { riskDb } from "../../../../postgres/riskDb.js";

// Shared row-insertion helpers for integration tests against the real
// xlsxPPA* tables (public.v_dalyviai's real source — see
// migrations/risk/test/001_public_test_tables.sql).
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

export function lookupOrInsertAtmestoPasiulymoStatusas(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("xlsxPPAatmestuPasiulymuStatusai", pavadinimas);
}

// The one status label public.v_dalyviai(_v2) currently recognises as a
// self-withdrawal (LT-COM-20's trigger) rather than a buyer-side rejection —
// see xlsxPPAatmestuPasiulymuStatusai id 7 in the real database.
export const WITHDRAWN_STATUS =
    "Dalyvis (kandidatas) pasiūlymus (galutinius pasiūlymus) atsiėmė iki pasiūlymų eilės sudarymo";

export async function insertAtaskaita(params: {
    pirkimoNumeris: string;
    pirkimoBudas: string;
    daliuSkaicius: number;
    sukurtaAt: string;
    /** xlsxPPAataskaitos.preliminariSutartis — LT-PRI-06 reads this. Defaults to null (not reported). */
    preliminariSutartis?: boolean | null;
    /** xlsxPPAataskaitos.pretenzijaPateikta — LT-TRA-07 reads this. Defaults to null (not reported). */
    pretenzijaPateikta?: boolean | null;
    /** xlsxPPAataskaitos.ieskinysTeismui — LT-TRA-08 reads this. Defaults to null (not reported). */
    ieskinysTeismui?: boolean | null;
    /** xlsxPPAataskaitos.elektroninisPirkimas — LT-TRA-09 reads this. Defaults to null (not reported). */
    elektroninisPirkimas?: boolean | null;
}): Promise<number> {
    const pirkimoBudasId = await lookupOrInsertPirkimoBudas(params.pirkimoBudas);
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO public."xlsxPPAataskaitos" ("pirkimoNumeris", "pirkimoBudasId", "daliuSkaicius", "sukurtaAt", "preliminariSutartis", "pretenzijaPateikta", "ieskinysTeismui", "elektroninisPirkimas")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
            params.pirkimoNumeris,
            pirkimoBudasId,
            params.daliuSkaicius,
            params.sukurtaAt,
            params.preliminariSutartis ?? null,
            params.pretenzijaPateikta ?? null,
            params.ieskinysTeismui ?? null,
            params.elektroninisPirkimas ?? null,
        ],
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
    eileNumeris?: number;
    kaina?: string;
}): Promise<void> {
    await riskDb.query(
        `INSERT INTO public."xlsxPPApasiulymuEile" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "eileNumeris", "kaina")
         VALUES ($1, $2, $3, $4, $5)`,
        [params.ataskaitaId, params.daliesNumeris, params.dalyvioKodas, params.eileNumeris ?? null, params.kaina ?? "1000"],
    );
}

/** A rejected bid — any non-null reason text; assessRisk() only checks atmetimoPriezastis IS NULL. */
export async function insertAtmestasPasiulymas(params: {
    ataskaitaId: number;
    daliesNumeris: string | null;
    dalyvioKodas: string;
    priezastis?: string;
    /** The structured rejection status (e.g. WITHDRAWN_STATUS) — LT-COM-20 reads this, not priezastis. */
    statusas?: string;
}): Promise<void> {
    const atmetimoPriezastysId = await lookupOrInsertAtmetimoPriezastis(params.priezastis ?? "Atmestas");
    const statusasId = params.statusas ? await lookupOrInsertAtmestoPasiulymoStatusas(params.statusas) : null;
    await riskDb.query(
        `INSERT INTO public."xlsxPPAatmestiPasiulymai" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "atmetimoPriezastysId", "statusasId")
         VALUES ($1, $2, $3, $4, $5)`,
        [params.ataskaitaId, params.daliesNumeris, params.dalyvioKodas, atmetimoPriezastysId, statusasId],
    );
}

/** A procedure-ending decision for one (ataskaita, dalis) — LT-OTH-05/LT-TRA-06 read this. */
export async function insertProceduruPabaiga(params: {
    ataskaitaId: number;
    daliesNumeris: string | null;
    proceduruPabaiga: string;
    sprendimoPriemimoData?: string;
    /** xlsxPPAproceduruPabaiga.sprendimoPriezastys — LT-TRA-06 reads this. Defaults to null (not reported). */
    sprendimoPriezastys?: string | null;
}): Promise<void> {
    await riskDb.query(
        `INSERT INTO public."xlsxPPAproceduruPabaiga" ("ataskaitaId", "daliesNumeris", "proceduruPabaiga", "sprendimoPriemimoData", "sprendimoPriezastys")
         VALUES ($1, $2, $3, $4, $5)`,
        [
            params.ataskaitaId,
            params.daliesNumeris,
            params.proceduruPabaiga,
            params.sprendimoPriemimoData ?? null,
            params.sprendimoPriezastys ?? null,
        ],
    );
}

let nextSutartisId = 1;

/** A contract row — LT-OTH-04 reads its pirkimoNumeris/sudarymoData via v_pirkimo_sutartys_v2. */
export async function insertVpmSutartis(params: {
    pirkimoNumeris: string;
    sudarymoData: string | null;
    istrinta?: boolean;
}): Promise<number> {
    const unikalusId = nextSutartisId++;
    await riskDb.query(
        `INSERT INTO public."vpmSutartys" ("unikalusId", "pirkimoNumeris", "sudarymoData", "istrinta")
         VALUES ($1, $2, $3, $4)`,
        [unikalusId, params.pirkimoNumeris, params.sudarymoData, params.istrinta ?? false],
    );
    return unikalusId;
}

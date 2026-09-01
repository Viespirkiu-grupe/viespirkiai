import { riskDb } from "../../../../postgres/riskDb.js";

// Shared row-insertion helpers for integration tests against the real
// ppa.* tables (public.v_dalyviai's real source — see
// migrations/risk/test/001_public_test_tables.sql).
// ppa."pirkimoBudai"/ppa."atmetimoPriezastys" are lookup tables: a fixture
// names a value, and these helpers resolve-or-create the row backing it.

async function lookupOrInsertId(table: string, pavadinimas: string): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO ppa."${table}" (pavadinimas)
         VALUES ($1)
         ON CONFLICT (pavadinimas) DO UPDATE SET pavadinimas = EXCLUDED.pavadinimas
         RETURNING id`,
        [pavadinimas],
    );
    return rows[0].id;
}

export function lookupOrInsertPirkimoBudas(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("pirkimoBudai", pavadinimas);
}

export function lookupOrInsertAtmetimoPriezastis(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("atmetimoPriezastys", pavadinimas);
}

export function lookupOrInsertAtmestoPasiulymoStatusas(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("atmestuPasiulymuStatusai", pavadinimas);
}

export function lookupOrInsertAtmetimoTeisinisPagrindas(pavadinimas: string): Promise<number> {
    return lookupOrInsertId("atmetimoTeisiniaiPagrindai", pavadinimas);
}

// The one status label public.v_dalyviai(_v2) currently recognises as a
// self-withdrawal (LT-COM-20's trigger) rather than a buyer-side rejection —
// see ppa."atmestuPasiulymuStatusai" id 7 in the real database.
export const WITHDRAWN_STATUS =
    "Dalyvis (kandidatas) pasiūlymus (galutinius pasiūlymus) atsiėmė iki pasiūlymų eilės sudarymo";

export async function insertAtaskaita(params: {
    pirkimoNumeris: string;
    pirkimoBudas: string;
    daliuSkaicius: number;
    sukurtaAt: string;
    /** ppa."ataskaitos".preliminariSutartis — LT-PRI-06 reads this. Defaults to null (not reported). */
    preliminariSutartis?: boolean | null;
    /** ppa."ataskaitos".pretenzijaPateikta — LT-TRA-07 reads this. Defaults to null (not reported). */
    pretenzijaPateikta?: boolean | null;
    /** ppa."ataskaitos".ieskinysTeismui — LT-TRA-08 reads this. Defaults to null (not reported). */
    ieskinysTeismui?: boolean | null;
    /** ppa."ataskaitos".elektroninisPirkimas — LT-TRA-09 reads this. Defaults to null (not reported). */
    elektroninisPirkimas?: boolean | null;
}): Promise<number> {
    const pirkimoBudasId = await lookupOrInsertPirkimoBudas(params.pirkimoBudas);
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO ppa."ataskaitos" ("pirkimoNumeris", "pirkimoBudasId", "daliuSkaicius", "sukurtaAt", "preliminariSutartis", "pretenzijaPateikta", "ieskinysTeismui", "elektroninisPirkimas")
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
    await riskDb.query(`INSERT INTO ppa."dalyviai" ("ataskaitaId", "kodas") VALUES ($1, $2)`, [
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
        `INSERT INTO ppa."pasiulymuEile" ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "eileNumeris", "kaina")
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
    /**
     * ppa."atmestiPasiulymai".pasiulymoKaina — the price this bidder offered before being
     * rejected, recorded on the rejection row itself (distinct from ppa."pasiulymuEile".kaina,
     * which only exists for a bid that made it into the price ranking). LT-AWD-02 reads this via
     * v_dalyviai_v2's COALESCE fallback. Undefined leaves it unset, mirroring most real rejection
     * rows.
     */
    kaina?: string;
    /**
     * ppa."atmestiPasiulymai".atmetimoTeisinisPagrindasId — the structured (dropdown) legal-basis
     * label for the rejection, e.g. a VPĮ/KSPĮ article citation, or "Kita" when none was cited.
     * LT-AWD-03 reads this. Undefined leaves it unset, mirroring a rejection with no legal basis
     * recorded.
     */
    teisinisPagrindas?: string;
}): Promise<void> {
    const atmetimoPriezastysId = await lookupOrInsertAtmetimoPriezastis(params.priezastis ?? "Atmestas");
    const statusasId = params.statusas ? await lookupOrInsertAtmestoPasiulymoStatusas(params.statusas) : null;
    const teisinisPagrindasId = params.teisinisPagrindas
        ? await lookupOrInsertAtmetimoTeisinisPagrindas(params.teisinisPagrindas)
        : null;
    await riskDb.query(
        `INSERT INTO ppa."atmestiPasiulymai"
             ("ataskaitaId", "daliesNumeris", "dalyvioKodas", "atmetimoPriezastysId", "statusasId",
              "atmetimoTeisinisPagrindasId", "pasiulymoKaina")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            params.ataskaitaId,
            params.daliesNumeris,
            params.dalyvioKodas,
            atmetimoPriezastysId,
            statusasId,
            teisinisPagrindasId,
            params.kaina ?? null,
        ],
    );
}

/** A procedure-ending decision for one (ataskaita, dalis) — LT-OTH-05/LT-TRA-06 read this. */
export async function insertProceduruPabaiga(params: {
    ataskaitaId: number;
    daliesNumeris: string | null;
    proceduruPabaiga: string;
    sprendimoPriemimoData?: string;
    /** ppa."proceduruPabaiga".sprendimoPriezastys — LT-TRA-06 reads this. Defaults to null (not reported). */
    sprendimoPriezastys?: string | null;
}): Promise<void> {
    await riskDb.query(
        `INSERT INTO ppa."proceduruPabaiga" ("ataskaitaId", "daliesNumeris", "proceduruPabaiga", "sprendimoPriemimoData", "sprendimoPriezastys")
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

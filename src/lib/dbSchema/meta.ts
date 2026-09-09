import { postgres } from '@/postgres/postgres.js';
import type { LentelesMeta } from './tipai.ts';

/**
 * `dba` schemos skaitymas.
 *
 * Schema pridedama atskiru SQL failu (`dbaSchema.sql`), kurį taiko vartotojas,
 * todėl visos užklausos yra atsparios jos nebuvimui: kol schemos nėra,
 * lentelės vis tiek grupuojamos pagal schemą, tik be lietuviškų pavadinimų ir
 * šaltinių, o viršuje rodomas įspėjimas.
 */

/** `dba."schemos"` eilutė. `aprasymas` ne čia – jis yra `COMMENT ON SCHEMA`. */
export interface SchemosMeta {
  pavadinimas: string;
  saltinis: string | null;
  saltinioUrl: string | null;
  tvarka: number;
}

export interface MetaDuomenys {
  /** Raktas – schemos vardas. */
  schemos: Map<string, SchemosMeta>;
  /** Raktas – `schema.lentele`. */
  lenteles: Map<string, LentelesMeta>;
  klaida: string | null;
}

const TUSCIA: MetaDuomenys = {
  schemos: new Map(),
  lenteles: new Map(),
  klaida: null,
};

async function arYraSchema(): Promise<boolean> {
  const { rows } = await postgres.query(
    `SELECT 1 FROM pg_namespace WHERE nspname = 'dba'`,
  );
  return rows.length > 0;
}

export async function gautiMeta(): Promise<MetaDuomenys> {
  if (!(await arYraSchema())) {
    return {
      ...TUSCIA,
      klaida: 'Schema `dba` dar nesukurta – pritaikykite dbaSchema.sql ir migrations/dba/001_schemos.sql.',
    };
  }

  try {
    const [schemosRes, lentelesRes] = await Promise.all([
      postgres.query(`
        SELECT "schema", "pavadinimas", "saltinis", "saltinioUrl", "tvarka"
        FROM dba."schemos"
      `),
      postgres.query(`
        SELECT
            l."schema", l."lentele",
            l."saltinis", l."saltinioUrl",
            ab."pavadinimas" AS "atnaujinimoBudas",
            b."pavadinimas"  AS "busena",
            l."uzduotys", l."moduliai", l."komandos",
            l."atnaujinimoDaznis", l."pastabos"
        FROM dba."lenteles" l
        LEFT JOIN dba."atnaujinimoBudai" ab ON ab."id" = l."atnaujinimoBudasId"
        LEFT JOIN dba."busenos" b           ON b."id"  = l."busenaId"
      `),
    ]);

    const lenteles = new Map<string, LentelesMeta>();
    for (const row of lentelesRes.rows) {
      lenteles.set(`${row.schema}.${row.lentele}`, {
        saltinis: row.saltinis ?? null,
        saltinioUrl: row.saltinioUrl ?? null,
        atnaujinimoBudas: row.atnaujinimoBudas ?? null,
        busena: row.busena ?? null,
        uzduotys: row.uzduotys ?? [],
        moduliai: row.moduliai ?? [],
        komandos: row.komandos ?? [],
        atnaujinimoDaznis: row.atnaujinimoDaznis ?? null,
        pastabos: row.pastabos ?? null,
      });
    }

    const schemos = new Map<string, SchemosMeta>();
    for (const row of schemosRes.rows) {
      schemos.set(row.schema, {
        pavadinimas: row.pavadinimas,
        saltinis: row.saltinis ?? null,
        saltinioUrl: row.saltinioUrl ?? null,
        tvarka: Number(row.tvarka),
      });
    }

    return { schemos, lenteles, klaida: null };
  } catch (error: any) {
    // Schema yra, bet lentelių dar nėra (pritaikytas tik dalis failo) – puslapis
    // vis tiek turi atsidaryti.
    return { ...TUSCIA, klaida: error?.message ?? String(error) };
  }
}

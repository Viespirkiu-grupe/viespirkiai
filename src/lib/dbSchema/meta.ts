import { postgres } from '@/postgres/postgres.js';
import type { Grupe, LentelesMeta } from './tipai.ts';
import type { Taisykle } from './grupes.ts';

/**
 * `dba` schemos skaitymas.
 *
 * Schema pridedama atskiru SQL failu (`dbaSchema.sql`), kurį taiko vartotojas,
 * todėl visos užklausos yra atsparios jos nebuvimui: kol schemos nėra,
 * puslapis veikia be grupių ir be šaltinių, o viršuje rodo įspėjimą.
 */

export interface MetaDuomenys {
  grupes: Grupe[];
  taisykles: Taisykle[];
  /** Raktas – `schema.lentele`. */
  lenteles: Map<string, { grupesRaktas: string | null } & LentelesMeta>;
  klaida: string | null;
}

const TUSCIA: MetaDuomenys = {
  grupes: [],
  taisykles: [],
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
      klaida: 'Schema `dba` dar nesukurta – pritaikykite dbaSchema.sql ir dbaSchemaSeed.sql.',
    };
  }

  try {
    const [grupesRes, taisyklesRes, lentelesRes] = await Promise.all([
      postgres.query(`
        SELECT "raktas", "pavadinimas", "aprasymas", "saltinis", "saltinioUrl", "tvarka"
        FROM dba."grupes"
        ORDER BY "tvarka", "pavadinimas"
      `),
      postgres.query(`
        SELECT t."prefiksas", g."raktas" AS "grupesRaktas", t."grieztaRiba", t."prioritetas"
        FROM dba."grupiuTaisykles" t
        JOIN dba."grupes" g ON g."id" = t."grupeId"
      `),
      postgres.query(`
        SELECT
            l."schema", l."lentele",
            g."raktas"       AS "grupesRaktas",
            l."saltinis", l."saltinioUrl",
            ab."pavadinimas" AS "atnaujinimoBudas",
            b."pavadinimas"  AS "busena",
            l."uzduotys", l."moduliai", l."komandos",
            l."atnaujinimoDaznis", l."pastabos"
        FROM dba."lenteles" l
        LEFT JOIN dba."grupes" g            ON g."id"  = l."grupeId"
        LEFT JOIN dba."atnaujinimoBudai" ab ON ab."id" = l."atnaujinimoBudasId"
        LEFT JOIN dba."busenos" b           ON b."id"  = l."busenaId"
      `),
    ]);

    const lenteles = new Map<string, { grupesRaktas: string | null } & LentelesMeta>();
    for (const row of lentelesRes.rows) {
      lenteles.set(`${row.schema}.${row.lentele}`, {
        grupesRaktas: row.grupesRaktas ?? null,
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

    return {
      grupes: grupesRes.rows.map((row) => ({
        raktas: row.raktas,
        pavadinimas: row.pavadinimas,
        aprasymas: row.aprasymas ?? null,
        saltinis: row.saltinis ?? null,
        saltinioUrl: row.saltinioUrl ?? null,
        tvarka: Number(row.tvarka),
      })),
      taisykles: taisyklesRes.rows.map((row) => ({
        prefiksas: row.prefiksas,
        grupesRaktas: row.grupesRaktas,
        grieztaRiba: row.grieztaRiba,
        prioritetas: Number(row.prioritetas),
      })),
      lenteles,
      klaida: null,
    };
  } catch (error: any) {
    // Schema yra, bet lentelių dar nėra (pritaikytas tik dalis failo) – puslapis
    // vis tiek turi atsidaryti.
    return { ...TUSCIA, klaida: error?.message ?? String(error) };
  }
}

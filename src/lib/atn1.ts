import { postgres } from '@/postgres/postgres.js';

export type Atn1 = {
  ataskaita: Record<string, any>;
  pirkimoDalys: Record<string, any>[];
  dalyviai: Record<string, any>[];
  vertinimoKriterjai: Record<string, any>[];
  atmestiPasiulymai: Record<string, any>[];
  pasiulymuEile: Record<string, any>[];
  proceduruPabaiga: Record<string, any>[];
  sutartys: Record<string, any>[];
};

/**
 * Load a parsed ATN-1 procurement report (and all its child rows) for a given
 * `failai.id`. Returns `null` when the file has not been parsed into the
 * `atn1*` tables yet.
 */
export async function loadAtn1ByFailasId(failasId: string | number): Promise<Atn1 | null> {
  const { rows } = await postgres.query(
    `SELECT * FROM "atn1ataskaitos" WHERE "failasId" = $1 ORDER BY "sukurtaAt" DESC LIMIT 1`,
    [failasId],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const id = ataskaita.id;
  const [pirkimoDalys, dalyviai, vertinimoKriterjai, atmestiPasiulymai, pasiulymuEile, proceduruPabaiga, sutartys] =
    await Promise.all([
      postgres.query(`SELECT * FROM "atn1pirkimoDalys" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1dalyviai" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1vertinimoKriterjai" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1atmestiPasiulymai" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1pasiulymuEile" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1proceduruPabaiga" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT * FROM "atn1sutartys" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
    ]);

  return {
    ataskaita,
    pirkimoDalys: pirkimoDalys.rows,
    dalyviai: dalyviai.rows,
    vertinimoKriterjai: vertinimoKriterjai.rows,
    atmestiPasiulymai: atmestiPasiulymai.rows,
    pasiulymuEile: pasiulymuEile.rows,
    proceduruPabaiga: proceduruPabaiga.rows,
    sutartys: sutartys.rows,
  };
}

export type Atn1Santrauka = {
  failasId: string;
  dalyviai: Record<string, any>[];
  pasiulymuEile: Record<string, any>[];
};

/**
 * Lightweight lookup for a procurement page: finds the ATN-1 report tied to a
 * `viesiejiPirkimai.pirkimoId` (matched on `atn1ataskaitos.pirkimoNumeris`) and
 * returns the participant list and the offer queue as separate lists, plus the
 * source file id for a "view full report" link. Returns `null` for procurements
 * without an ATN-1 (e.g. CVPP).
 */
export async function loadAtn1ForPirkimas(pirkimoNumeris: string): Promise<Atn1Santrauka | null> {
  const { rows } = await postgres.query(
    `SELECT id, "failasId" FROM "atn1ataskaitos" WHERE "pirkimoNumeris" = $1 ORDER BY "sukurtaAt" DESC LIMIT 1`,
    [pirkimoNumeris],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const [dalyviaiRes, eileRes] = await Promise.all([
    postgres.query(`SELECT * FROM "atn1dalyviai" WHERE "ataskaitaId" = $1 ORDER BY id`, [ataskaita.id]),
    postgres.query(`SELECT * FROM "atn1pasiulymuEile" WHERE "ataskaitaId" = $1 ORDER BY "daliesNumeris", "eileNumeris"`, [ataskaita.id]),
  ]);

  return { failasId: ataskaita.failasId, dalyviai: dalyviaiRes.rows, pasiulymuEile: eileRes.rows };
}

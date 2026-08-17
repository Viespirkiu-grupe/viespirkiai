import { postgres } from '@/postgres/postgres.js';

export type Ppa = {
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
 * Load a parsed PPA procurement report (and all its child rows) for a given
 * `failai.id`. Returns `null` when the file has not been parsed into the
 * `xlsxPPA*` tables yet.
 */
export async function loadPpaByFailasId(failasId: string | number): Promise<Ppa | null> {
  const { rows } = await postgres.query(
    `SELECT a.*,
            tp.pavadinimas AS "teisinisPagrindas",
            atp.pavadinimas AS "ataskaitosTipas",
            pv.pavadinimas AS "pirkimoVerte",
            pot.pavadinimas AS "perkanciosiosOrganizacijosTipas",
            it.pavadinimas AS "igaliotosiosTipas",
            pb.pavadinimas AS "pirkimoBudas",
            por.pavadinimas AS "pirkimoObjektoRusis"
     FROM "xlsxPPAataskaitos" a
     LEFT JOIN "xlsxPPAteisiniaiPagrindai" tp ON tp.id = a."teisinisPagrindasId"
     LEFT JOIN "xlsxPPAataskaitosTipai" atp ON atp.id = a."ataskaitosTipasId"
     LEFT JOIN "xlsxPPApirkimoVertes" pv ON pv.id = a."pirkimoVerteId"
     LEFT JOIN "xlsxPPAperkanciosiosOrganizacijosTipai" pot ON pot.id = a."perkanciosiosOrganizacijosTipasId"
     LEFT JOIN "xlsxPPAigaliotosiosTipai" it ON it.id = a."igaliotosiosTipasId"
     LEFT JOIN "xlsxPPApirkimoBudai" pb ON pb.id = a."pirkimoBudasId"
     LEFT JOIN "xlsxPPApirkimoObjektoRusys" por ON por.id = a."pirkimoObjektoRusisId"
     WHERE a."failasId" = $1
     ORDER BY a."sukurtaAt" DESC
     LIMIT 1`,
    [failasId],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const id = ataskaita.id;
  const [pirkimoDalys, dalyviai, vertinimoKriterjai, atmestiPasiulymai, pasiulymuEile, proceduruPabaiga, sutartys] =
    await Promise.all([
      postgres.query(`SELECT * FROM "xlsxPPApirkimoDalys" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT d.*, s.pavadinimas AS salis FROM "xlsxPPAdalyviai" d LEFT JOIN "xlsxPPAsalys" s ON s.id = d."salisId" WHERE d."ataskaitaId" = $1 ORDER BY d.id`, [id]),
      postgres.query(`SELECT * FROM "xlsxPPAvertinimoKriterijai" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT ap.*, st.pavadinimas AS statusas, tp.pavadinimas AS "atmetimoTeisinisPagrindas", pr.pavadinimas AS "atmetimoPriezastys", ki.pavadinimas AS "kainosIsraiska" FROM "xlsxPPAatmestiPasiulymai" ap LEFT JOIN "xlsxPPAatmestuPasiulymuStatusai" st ON st.id = ap."statusasId" LEFT JOIN "xlsxPPAatmetimoTeisiniaiPagrindai" tp ON tp.id = ap."atmetimoTeisinisPagrindasId" LEFT JOIN "xlsxPPAatmetimoPriezastys" pr ON pr.id = ap."atmetimoPriezastysId" LEFT JOIN "xlsxPPAkainosIsraiskos" ki ON ki.id = ap."kainosIsraiskaId" WHERE ap."ataskaitaId" = $1 ORDER BY ap.id`, [id]),
      postgres.query(`SELECT e.*, ki.pavadinimas AS "kainosIsraiska" FROM "xlsxPPApasiulymuEile" e LEFT JOIN "xlsxPPAkainosIsraiskos" ki ON ki.id = e."kainosIsraiskaId" WHERE e."ataskaitaId" = $1 ORDER BY e.id`, [id]),
      postgres.query(`SELECT * FROM "xlsxPPAproceduruPabaiga" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT s.*, ct.pavadinimas AS "centralizacijosTipas" FROM "xlsxPPAsutartys" s LEFT JOIN "xlsxPPAcentralizacijosTipai" ct ON ct.id = s."centralizacijosTipasId" WHERE s."ataskaitaId" = $1 ORDER BY s.id`, [id]),
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

export type PpaSantrauka = {
  failasId: string;
  dalyviai: Record<string, any>[];
  pasiulymuEile: Record<string, any>[];
};

/**
 * Lightweight lookup for a procurement page: finds the PPA report tied to a
 * `viesiejiPirkimai.pirkimoId` (matched on `xlsxPPAataskaitos.pirkimoNumeris`) and
 * returns the participant list and the offer queue as separate lists, plus the
 * source file id for a "view full report" link. Returns `null` for procurements
 * without an PPA (e.g. CVPP).
 */
export async function loadPpaForPirkimas(pirkimoNumeris: string): Promise<PpaSantrauka | null> {
  const { rows } = await postgres.query(
    `SELECT id, "failasId" FROM "xlsxPPAataskaitos" WHERE "pirkimoNumeris" = $1 ORDER BY "sukurtaAt" DESC LIMIT 1`,
    [pirkimoNumeris],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const [dalyviaiRes, eileRes] = await Promise.all([
    postgres.query(`SELECT d.*, s.pavadinimas AS salis FROM "xlsxPPAdalyviai" d LEFT JOIN "xlsxPPAsalys" s ON s.id = d."salisId" WHERE d."ataskaitaId" = $1 ORDER BY d.id`, [ataskaita.id]),
    postgres.query(`SELECT e.*, ki.pavadinimas AS "kainosIsraiska" FROM "xlsxPPApasiulymuEile" e LEFT JOIN "xlsxPPAkainosIsraiskos" ki ON ki.id = e."kainosIsraiskaId" WHERE e."ataskaitaId" = $1 ORDER BY e."daliesNumeris", e."eileNumeris"`, [ataskaita.id]),
  ]);

  return { failasId: ataskaita.failasId, dalyviai: dalyviaiRes.rows, pasiulymuEile: eileRes.rows };
}

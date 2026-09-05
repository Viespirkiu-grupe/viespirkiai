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
  /** `ppa."ataskaituSutartys".id` → the matching `vpmSutartys."sutartys"` record, when one was found. */
  sutarciuAtitikmenys: Record<string, PpaSutartiesAtitikmuo>;
};

export type PpaSutartiesAtitikmuo = {
  unikalusId: string;
  sutartiesNumeris: string | null;
  /** `tikslus` — sutampa ir vertė, ir data; `galimas` — sutapo tik dalis požymių. */
  patikimumas: 'tikslus' | 'galimas';
};

/**
 * Match the contracts listed inside a PPA report to our own `vpmSutartys."sutartys"`
 * records so the report can link straight to the contract page.
 *
 * The report gives no contract id — only the procurement number, the buyer, the
 * supplier, the value and the signing date. Buyer + procurement number +
 * supplier narrows it down, but a multi-part procurement produces several
 * contracts with the same supplier, so the remaining ambiguity is resolved in
 * tiers: value **and** date, then date alone, then value alone, and finally the
 * case where only one candidate exists at all. Rows that stay ambiguous are
 * left unlinked rather than guessed.
 */
async function loadPpaSutarciuAtitikmenys(ataskaitaId: string | number): Promise<Record<string, PpaSutartiesAtitikmuo>> {
  const { rows } = await postgres.query(
    `WITH ppa AS (
       SELECT s.id, s."tiekejosKodas", s."sutartiesVerte", s."sutartisSudarymoData",
              a."pirkimoNumeris", a."perkanciosiosOrganizacijosKodas"
       FROM ppa."ataskaituSutartys" s
       JOIN ppa."ataskaitos" a ON a.id = s."ataskaitaId"
       WHERE s."ataskaitaId" = $1
     ), kand AS (
       SELECT p.id AS "ppaId", v."unikalusId", v."sutartiesNumeris",
              v.verte = p."sutartiesVerte" AS "verteSutampa",
              v."sudarymoData" = p."sutartisSudarymoData" AS "dataSutampa"
       FROM ppa p
       JOIN "vpmSutartys"."sutartys" v
         ON v."pirkimoNumeris" = p."pirkimoNumeris"
        AND v."perkanciosiosOrganizacijosKodas" = p."perkanciosiosOrganizacijosKodas"
        AND v."pirmoTiekejoKodas" = p."tiekejosKodas"
        AND NOT v.istrinta
     ), suvestine AS (
       SELECT "ppaId",
              count(DISTINCT "unikalusId") AS viso,
              count(DISTINCT "unikalusId") FILTER (WHERE "verteSutampa" AND "dataSutampa") AS abu,
              count(DISTINCT "unikalusId") FILTER (WHERE "dataSutampa") AS data,
              count(DISTINCT "unikalusId") FILTER (WHERE "verteSutampa") AS verte
       FROM kand GROUP BY 1
     )
     SELECT DISTINCT ON (k."ppaId")
            k."ppaId", k."unikalusId", k."sutartiesNumeris",
            CASE WHEN s.abu = 1 THEN 'tikslus' ELSE 'galimas' END AS patikimumas
     FROM kand k
     JOIN suvestine s USING ("ppaId")
     WHERE (s.abu = 1 AND k."verteSutampa" AND k."dataSutampa")
        OR (s.abu <> 1 AND s.data = 1 AND k."dataSutampa")
        OR (s.abu <> 1 AND s.data <> 1 AND s.verte = 1 AND k."verteSutampa")
        OR (s.abu <> 1 AND s.data <> 1 AND s.verte <> 1 AND s.viso = 1)`,
    [ataskaitaId],
  );

  return Object.fromEntries(
    rows.map((r) => [
      String(r.ppaId),
      { unikalusId: String(r.unikalusId), sutartiesNumeris: r.sutartiesNumeris ?? null, patikimumas: r.patikimumas },
    ]),
  );
}

/**
 * Load a parsed PPA procurement report (and all its child rows) for a given
 * `failai.id`. Returns `null` when the file has not been parsed into the
 * `ppa` schema tables yet.
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
     FROM ppa."ataskaitos" a
     LEFT JOIN ppa."teisiniaiPagrindai" tp ON tp.id = a."teisinisPagrindasId"
     LEFT JOIN ppa."ataskaitosTipai" atp ON atp.id = a."ataskaitosTipasId"
     LEFT JOIN ppa."pirkimoVertes" pv ON pv.id = a."pirkimoVerteId"
     LEFT JOIN ppa."perkanciosiosOrganizacijosTipai" pot ON pot.id = a."perkanciosiosOrganizacijosTipasId"
     LEFT JOIN ppa."igaliotosiosTipai" it ON it.id = a."igaliotosiosTipasId"
     LEFT JOIN ppa."pirkimoBudai" pb ON pb.id = a."pirkimoBudasId"
     LEFT JOIN ppa."pirkimoObjektoRusys" por ON por.id = a."pirkimoObjektoRusisId"
     WHERE a."failasId" = $1
     ORDER BY a."sukurtaAt" DESC
     LIMIT 1`,
    [failasId],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const id = ataskaita.id;
  const [pirkimoDalys, dalyviai, vertinimoKriterjai, atmestiPasiulymai, pasiulymuEile, proceduruPabaiga, sutartys, sutarciuAtitikmenys] =
    await Promise.all([
      postgres.query(`SELECT * FROM ppa."pirkimoDalys" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT d.*, s.pavadinimas AS salis FROM ppa."dalyviai" d LEFT JOIN ppa."salys" s ON s.id = d."salisId" WHERE d."ataskaitaId" = $1 ORDER BY d.id`, [id]),
      postgres.query(`SELECT * FROM ppa."vertinimoKriterijai" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT ap.*, st.pavadinimas AS statusas, tp.pavadinimas AS "atmetimoTeisinisPagrindas", pr.pavadinimas AS "atmetimoPriezastys", ki.pavadinimas AS "kainosIsraiska" FROM ppa."atmestiPasiulymai" ap LEFT JOIN ppa."atmestuPasiulymuStatusai" st ON st.id = ap."statusasId" LEFT JOIN ppa."atmetimoTeisiniaiPagrindai" tp ON tp.id = ap."atmetimoTeisinisPagrindasId" LEFT JOIN ppa."atmetimoPriezastys" pr ON pr.id = ap."atmetimoPriezastysId" LEFT JOIN ppa."kainosIsraiskos" ki ON ki.id = ap."kainosIsraiskaId" WHERE ap."ataskaitaId" = $1 ORDER BY ap.id`, [id]),
      postgres.query(`SELECT e.*, ki.pavadinimas AS "kainosIsraiska" FROM ppa."pasiulymuEile" e LEFT JOIN ppa."kainosIsraiskos" ki ON ki.id = e."kainosIsraiskaId" WHERE e."ataskaitaId" = $1 ORDER BY e.id`, [id]),
      postgres.query(`SELECT * FROM ppa."proceduruPabaiga" WHERE "ataskaitaId" = $1 ORDER BY id`, [id]),
      postgres.query(`SELECT s.*, ct.pavadinimas AS "centralizacijosTipas" FROM ppa."ataskaituSutartys" s LEFT JOIN ppa."centralizacijosTipai" ct ON ct.id = s."centralizacijosTipasId" WHERE s."ataskaitaId" = $1 ORDER BY s.id`, [id]),
      loadPpaSutarciuAtitikmenys(id),
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
    sutarciuAtitikmenys,
  };
}

/**
 * Format a set of procurement-part numbers into a compact range string:
 * `[1, 2, 3, 5, 7, 8]` → `"1–3, 5, 7–8"`.
 *
 * PPA reports routinely repeat the same values for every part, so the tables
 * collapse those rows and label them with a range instead of listing each part
 * on its own line. Non-numeric labels (e.g. "Visos dalys") are passed through
 * de-duplicated, since they cannot be ordered meaningfully.
 */
export function formatuotiDaliuRuozus(numeriai: unknown[]): string {
  const tekstai = numeriai.map((n) => (n == null ? '' : String(n).trim())).filter(Boolean);
  if (tekstai.length === 0) return '—';
  if (!tekstai.every((t) => /^\d+$/.test(t))) return [...new Set(tekstai)].join(', ');

  const skaiciai = [...new Set(tekstai.map(Number))].sort((a, b) => a - b);
  const ruozai: string[] = [];
  let pradzia = skaiciai[0];
  let pabaiga = skaiciai[0];
  for (const n of skaiciai.slice(1)) {
    if (n === pabaiga + 1) {
      pabaiga = n;
      continue;
    }
    ruozai.push(pradzia === pabaiga ? `${pradzia}` : `${pradzia}–${pabaiga}`);
    pradzia = pabaiga = n;
  }
  ruozai.push(pradzia === pabaiga ? `${pradzia}` : `${pradzia}–${pabaiga}`);
  return ruozai.join(', ');
}

export type PpaGrupe<T> = {
  /** First row of the group — its non-part fields represent the whole group. */
  eilute: T;
  /** Compact range label of every part number in the group ("1–12"). */
  dalys: string;
  /** How many source rows were merged. */
  kiekis: number;
};

/**
 * Merge rows that differ only by their part number.
 *
 * `laukai` lists the fields that actually get rendered; rows sharing identical
 * values across all of them are folded into a single group. Group order follows
 * first appearance, so the original row order is preserved.
 */
export function grupuotiPagalDalis<T extends Record<string, any>>(
  rows: T[],
  laukai: string[],
  daliesLaukas = 'daliesNumeris',
): PpaGrupe<T>[] {
  const grupes = new Map<string, { eilute: T; numeriai: unknown[] }>();
  for (const row of rows) {
    const raktas = laukai.map((k) => JSON.stringify(row[k] ?? null)).join('\u0000');
    const esama = grupes.get(raktas);
    if (esama) esama.numeriai.push(row[daliesLaukas]);
    else grupes.set(raktas, { eilute: row, numeriai: [row[daliesLaukas]] });
  }
  return [...grupes.values()].map((g) => ({
    eilute: g.eilute,
    dalys: formatuotiDaliuRuozus(g.numeriai),
    kiekis: g.numeriai.length,
  }));
}

export type PpaSuliejimas<T> = {
  eilute: T;
  /** `rowspan` for the shared cell; only meaningful when `rodyti` is true. */
  apjungti: number;
  /** Whether this row should render the shared cell at all. */
  rodyti: boolean;
};

/**
 * Mark runs of consecutive rows that share the same key so a repeated column
 * (typically the supplier) can be rendered once with `rowspan` instead of being
 * printed on every line.
 */
export function sujungtiGretimas<T>(rows: T[], raktas: (row: T) => string): PpaSuliejimas<T>[] {
  return rows.map((eilute, i) => {
    const k = raktas(eilute);
    if (i > 0 && raktas(rows[i - 1]) === k) return { eilute, apjungti: 1, rodyti: false };
    let apjungti = 1;
    while (i + apjungti < rows.length && raktas(rows[i + apjungti]) === k) apjungti++;
    return { eilute, apjungti, rodyti: true };
  });
}

/** Numeric-aware comparison for part numbers stored as free text. */
export function palygintiDalis(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''), 'lt');
}

export type PpaSantrauka = {
  failasId: string;
  dalyviai: Record<string, any>[];
  pasiulymuEile: Record<string, any>[];
};

/**
 * Lightweight lookup for a procurement page: finds the PPA report tied to a
 * `viesiejiPirkimai.pirkimoId` (matched on `ppa."ataskaitos".pirkimoNumeris`) and
 * returns the participant list and the offer queue as separate lists, plus the
 * source file id for a "view full report" link. Returns `null` for procurements
 * without an PPA (e.g. CVPP).
 */
export async function loadPpaForPirkimas(pirkimoNumeris: string): Promise<PpaSantrauka | null> {
  const { rows } = await postgres.query(
    `SELECT id, "failasId" FROM ppa."ataskaitos" WHERE "pirkimoNumeris" = $1 ORDER BY "sukurtaAt" DESC LIMIT 1`,
    [pirkimoNumeris],
  );
  const ataskaita = rows[0];
  if (!ataskaita) return null;

  const [dalyviaiRes, eileRes] = await Promise.all([
    postgres.query(`SELECT d.*, s.pavadinimas AS salis FROM ppa."dalyviai" d LEFT JOIN ppa."salys" s ON s.id = d."salisId" WHERE d."ataskaitaId" = $1 ORDER BY d.id`, [ataskaita.id]),
    postgres.query(`SELECT e.*, ki.pavadinimas AS "kainosIsraiska" FROM ppa."pasiulymuEile" e LEFT JOIN ppa."kainosIsraiskos" ki ON ki.id = e."kainosIsraiskaId" WHERE e."ataskaitaId" = $1 ORDER BY e."daliesNumeris", e."eileNumeris"`, [ataskaita.id]),
  ]);

  return { failasId: ataskaita.failasId, dalyviai: dalyviaiRes.rows, pasiulymuEile: eileRes.rows };
}

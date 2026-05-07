import { postgres } from '@/postgres/postgres.js';
import { fixHtmlEntities } from '@/utils/fixHtmlEntities.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';

export type Sutartis = Record<string, any>;

async function applyTiekejasPatikslinimas(sutartis: Sutartis) {
  const [atviri, atviriImp] = await Promise.all([
    postgres.query(`SELECT * FROM "sutartysAtviriDuomenys" WHERE "dokId" = $1 LIMIT 1`, [sutartis.sutartiesUnikalusId]),
    postgres.query(`SELECT * FROM "sutartysAtviriDuomenysImp" WHERE "dokId" = $1 LIMIT 1`, [sutartis.sutartiesUnikalusId]),
  ]);
  const a = atviri.rows[0];
  const ai = atviriImp.rows[0];
  if (a?.tiekPavPatikslinimas) sutartis.tiekejasPatikslinimas = a.tiekPavPatikslinimas;
  if (a?.tiekSalis) sutartis.tiekejasSalis = a.tiekSalis;
  if (ai?.tiekSbjPatikslinimas) sutartis.tiekejasPatikslinimas = ai.tiekSbjPatikslinimas;
  if (ai?.tiekSalis) sutartis.tiekejasSalis = ai.tiekSalis;
}

async function loadPanasiosSutartys(sutartis: Sutartis): Promise<Sutartis[]> {
  const r = await postgres.query(
    `SELECT * FROM sutartys WHERE "sutartiesUnikalusId" != $1 AND "perkanciosiosOrganizacijosKodas" = $2 AND "tiekejoKodas" = $3 AND verte = $4 ORDER BY "paskutinioRedagavimoData" DESC`,
    [sutartis.sutartiesUnikalusId, sutartis.perkanciosiosOrganizacijosKodas, sutartis.tiekejoKodas, sutartis.verte],
  );
  return r.rows;
}

async function attachJarPavadinimai(salys: any[]) {
  const codes = Array.from(new Set(
    salys.map((s: any) => s.validusJarKodas).filter((c: any): c is string => !!c),
  ));
  if (codes.length === 0) return;
  const rows = await postgres.query(
    `SELECT "jarKodas", "pavadinimas" FROM jar WHERE "jarKodas" = ANY($1::text[])`,
    [codes],
  ).then((r: any) => r.rows);
  const byCode = new Map<string, string>(rows.map((r: any) => [String(r.jarKodas), r.pavadinimas]));
  for (const s of salys) {
    if (s.validusJarKodas && byCode.has(String(s.validusJarKodas))) {
      s.jarPavadinimas = byCode.get(String(s.validusJarKodas));
    }
  }
}

async function loadSabisSutartys(vpId: number) {
  const sabis = await postgres.query(`SELECT * FROM "sabisSutartys" WHERE "vpId" = $1`, [vpId]).then((r: any) => r.rows);
  await Promise.all(sabis.map(async (s: any) => {
    s.salys = await postgres.query(`SELECT * FROM "sabisSutarciuSalys" WHERE "sutartiesId" = $1`, [s.sutartiesId]).then((r: any) => r.rows);
    const saskaitos = await postgres.query(`SELECT * FROM "sabisSaskaitos" WHERE "sutartiesUid" = $1 ORDER BY "israsymoData" DESC NULLS LAST`, [s.sutartiesUid]).then((r: any) => r.rows);
    await Promise.all(saskaitos.map(async (sk: any) => {
      sk.salys = await postgres.query(`SELECT * FROM "sabisSaskaituSalys" WHERE "sfId" = $1`, [sk.sfId]).then((r: any) => r.rows);
      await attachJarPavadinimai(sk.salys);
    }));
    s.saskaitos = saskaitos;
    await attachJarPavadinimai(s.salys);
  }));
  return sabis;
}

async function annotateDokumentai(dokumentai: any[]) {
  await Promise.all(dokumentai.map(async (failas: any) => {
    const dokIdMatch = failas.url.match(/dok_id=(\d+)/);
    const fileIdMatch = failas.url.match(/file_id=(\d+)/);
    failas.dok_id = dokIdMatch ? dokIdMatch[1] : '';
    failas.file_id = fileIdMatch ? fileIdMatch[1] : '';
    failas.proxyUrl = failas.dok_id && failas.file_id
      ? `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dok_id}&file_id=${failas.file_id}`
      : '';
    const busena = failas.dok_id && failas.file_id ? await postgres.query(
      `SELECT "dokId", "fileId", ("parsiustas" > 0) AS parsiustas, ("nuskaitytas" IS NOT NULL AND "nuskaitytas" > 0) AS nuskaitytas, id FROM failai WHERE "dokId" = $1 AND "fileId" = $2`,
      [failas.dok_id, failas.file_id],
    ).then((r: any) => r.rows[0]) : undefined;
    failas.parsiustas = busena?.parsiustas || false;
    failas.nuskaitytas = busena?.nuskaitytas || false;
    if (busena?.parsiustas) {
      failas.id = busena.id;
      failas.proxyUrl = `https://failai.viespirkiai.org/${failas.id}`;
    }
  }));
}

async function loadCpvaProjektai(pirkimoNumeris: string | null | undefined) {
  if (!pirkimoNumeris) return [];
  const sutartys = await postgres.query(
    `SELECT * FROM "cpvaProjektuSutartys" WHERE "pirkimoNrCvpis" = $1`,
    [pirkimoNumeris],
  ).then((r: any) => r.rows);
  for (const ps of sutartys) {
    const proj = await postgres.query(
      `SELECT * FROM "cpvaProjektuSarasas" WHERE "projektoNr" = $1`,
      [ps.projektoNr],
    ).then((r: any) => r.rows[0]);
    if (proj) ps.projektas = proj;
  }
  return sutartys;
}

async function loadPirkimai(pirkimoNumeris: string | null | undefined) {
  if (!pirkimoNumeris) return { cvppPirkimas: undefined, cvpisPirkimas: undefined };
  const [cvppPirkimas, cvpisPirkimas] = await Promise.all([
    postgres.query(`SELECT * FROM "cvppViesiejiPirkimai" WHERE "pirkimoNumeris" = $1`, [pirkimoNumeris]).then((r: any) => r.rows[0]),
    postgres.query(`SELECT * FROM "viesiejiPirkimai" WHERE "pirkimoId" = $1`, [pirkimoNumeris]).then((r: any) => r.rows[0]),
  ]);
  return { cvppPirkimas, cvpisPirkimas };
}

export async function loadSutartis(id: number): Promise<Sutartis | null> {
  const sutartis = await postgres
    .query('SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1 LIMIT 1', [id])
    .then((r: any) => r.rows[0]);
  if (!sutartis) return null;

  await applyTiekejasPatikslinimas(sutartis);

  const [panasios, sabis, , cpva, pirkimai] = await Promise.all([
    loadPanasiosSutartys(sutartis),
    loadSabisSutartys(sutartis.sutartiesUnikalusId),
    annotateDokumentai(sutartis.dokumentai),
    loadCpvaProjektai(sutartis.pirkimoNumeris),
    loadPirkimai(sutartis.pirkimoNumeris),
  ]);

  if (panasios.length > 0) sutartis.panasiosSutartys = panasios;
  sutartis.sabisSutartys = sabis;
  sutartis.cpvaProjektuSutartys = cpva;
  if (pirkimai.cvppPirkimas) sutartis.cvppPirkimas = pirkimai.cvppPirkimas;
  if (pirkimai.cvpisPirkimas) sutartis.cvpisPirkimas = pirkimai.cvpisPirkimas;

  sutartis.pavadinimas = fixHtmlEntities(sutartis.pavadinimas);
  sutartis.perkanciojiOrganizacija = fixHtmlEntities(sutartis.perkanciojiOrganizacija);
  sutartis.tiekejas = fixHtmlEntities(sutartis.tiekejas);

  const tipo = (sutartis.tipas || '').trim().toUpperCase();
  sutartis.tipoPavadinimas = (CONTRACT_TYPES as any)[tipo] || tipo;

  return sutartis;
}

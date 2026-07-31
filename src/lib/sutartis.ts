import { postgres } from '@/postgres/postgres.js';
import { fixHtmlEntities } from '@/utils/fixHtmlEntities.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';
import { VPM_SUTARTIS_ROW_SQL } from '@/modules/sutartys/vpmSutartisRow.js';
import { loadPirkimoAtitikmenys, parsePirkimoId } from './sutartisPirkimai.ts';

export type Sutartis = Record<string, any>;

/**
 * Apply the supplier-name "patikslinimas" (clarification) to a contract.
 *
 * The portal records contracts as scraped from CVP IS, which stores the
 * supplier name in a free-form field that often contains typos, missing
 * legal-form suffixes, or wrong country codes.  Two parallel "open data"
 * tables ship corrected values:
 *
 *   - `sutartysAtviriDuomenys`     — original open-data dump.
 *   - `sutartysAtviriDuomenysImp`  — imported / supplemental dump that may
 *                                    refine the original.
 *
 * Both are consulted; the second wins if it has a value, since it is
 * considered the more recent correction.  Country codes from either table
 * are likewise applied (second-table value wins).
 */
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
    `SELECT * FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
     WHERE "sutartiesUnikalusId" != $1
       AND "perkanciosiosOrganizacijosKodas" = $2
       AND "tiekejoKodas" = $3
       AND verte = $4
       AND istrinta = false
     ORDER BY "paskutinioRedagavimoData" DESC`,
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

function groupBy(rows: any[], key: string) {
  const map = new Map<any, any[]>();
  for (const row of rows) {
    const group = map.get(row[key]);
    if (group) group.push(row);
    else map.set(row[key], [row]);
  }
  return map;
}

async function loadSabisSutartys(vpId: number) {
  const sabis = await postgres.query(`SELECT * FROM "sabisSutartys" WHERE "vpId" = $1`, [vpId]).then((r: any) => r.rows);
  if (sabis.length === 0) return sabis;

  const [sutarciuSalys, saskaitos] = await Promise.all([
    postgres.query(`SELECT * FROM "sabisSutarciuSalys" WHERE "sutartiesId" = ANY($1)`, [sabis.map((s: any) => s.sutartiesId)]).then((r: any) => r.rows),
    postgres.query(`SELECT * FROM "sabisSaskaitos" WHERE "sutartiesUid" = ANY($1) ORDER BY "israsymoData" DESC NULLS LAST`, [sabis.map((s: any) => s.sutartiesUid)]).then((r: any) => r.rows),
  ]);
  const saskaituSalys = saskaitos.length > 0
    ? await postgres.query(`SELECT ss.*, t.tipas, v."veiklosVieta" FROM "sabisSaskaituSalys" ss LEFT JOIN "sabisSaskaituSalysTipai" t ON t.id = ss."tipasId" LEFT JOIN "sabisSaskaituSalysVeiklosVieta" v ON v.id = ss."veiklosVietaId" WHERE ss."sfId" = ANY($1)`, [saskaitos.map((sk: any) => sk.sfId)]).then((r: any) => r.rows)
    : [];

  const sutarciuSalysById = groupBy(sutarciuSalys, 'sutartiesId');
  const saskaitosByUid = groupBy(saskaitos, 'sutartiesUid');
  const saskaituSalysBySfId = groupBy(saskaituSalys, 'sfId');

  for (const sk of saskaitos) sk.salys = saskaituSalysBySfId.get(sk.sfId) || [];
  for (const s of sabis) {
    s.salys = sutarciuSalysById.get(s.sutartiesId) || [];
    s.saskaitos = saskaitosByUid.get(s.sutartiesUid) || [];
  }
  await attachJarPavadinimai([...sutarciuSalys, ...saskaituSalys]);
  return sabis;
}

async function annotateDokumentai(sutartis: any) {
  const dokumentai: any[] = Array.isArray(sutartis.dokumentai) ? sutartis.dokumentai : [];
  for (const failas of dokumentai) {
    const dokIdMatch = failas.url?.match(/dok_id=(\d+)/);
    const fileIdMatch = failas.url?.match(/file_id=(\d+)/);
    failas.dok_id = dokIdMatch ? dokIdMatch[1] : '';
    failas.file_id = fileIdMatch ? fileIdMatch[1] : '';
    failas.proxyUrl = failas.dok_id && failas.file_id
      ? `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dok_id}&file_id=${failas.file_id}`
      : '';
  }

  // Visada užklausiame visus sutarties failus, kad prijungtume ir tuos, kurių
  // nėra sutartys.dokumentai sąraše. Sutarčių raktas — sourceId0/sourceId1.
  const busenos = await postgres.query(
    `SELECT f."sourceId0" AS "dokId", f."sourceId1" AS "fileId",
            (f."downloadStatus" > 0) AS parsiustas,
            (d.version IS NOT NULL AND d.version > 0) AS nuskaitytas,
            f.id, fn.filename AS pavadinimas, e.extension
     FROM public.files f
     JOIN public."filesSourceTitles" st ON st.id = f."sourceTitleId"
     LEFT JOIN public."filesFilenames" fn ON fn.id = f."filenameId"
     LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
     LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
     WHERE st.title = 'sutartys' AND f."sourceId0" = $1::text`,
    [String(sutartis.sutartiesUnikalusId)],
  ).then((r: any) => r.rows);
  const busenaByPora = new Map<string, any>(busenos.map((b: any) => [`${b.dokId}:${b.fileId}`, b]));

  for (const failas of dokumentai) {
    const busena = busenaByPora.get(`${failas.dok_id}:${failas.file_id}`);
    failas.parsiustas = busena?.parsiustas || false;
    failas.nuskaitytas = busena?.nuskaitytas || false;
    if (busena?.parsiustas) {
      failas.id = busena.id;
      failas.proxyUrl = `https://failai.viespirkiai.org/${failas.id}`;
    }
  }

  // Failai, esantys DB, bet nesantys sutarties dokumentų sąraše.
  const esamosPoros = new Set(dokumentai.map((f: any) => `${f.dok_id}:${f.file_id}`));
  for (const b of busenos) {
    if (esamosPoros.has(`${b.dokId}:${b.fileId}`)) continue;
    const dok_id = String(b.dokId);
    const file_id = String(b.fileId);
    dokumentai.push({
      pavadinimas: b.pavadinimas,
      extension: b.extension,
      url: `https://eviesiejipirkimai.lt/download.php?dok_id=${dok_id}&file_id=${file_id}`,
      dok_id,
      file_id,
      parsiustas: b.parsiustas,
      nuskaitytas: b.nuskaitytas,
      id: b.parsiustas ? b.id : undefined,
      proxyUrl: b.parsiustas
        ? `https://failai.viespirkiai.org/${b.id}`
        : `https://eviesiejipirkimai.lt/download.php?dok_id=${dok_id}&file_id=${file_id}`,
    });
  }

  sutartis.dokumentai = dokumentai;
}

async function loadCpvaProjektai(pirkimoNumeris: string | null | undefined) {
  if (parsePirkimoId(pirkimoNumeris) === null) return [];
  const sutartys = await postgres.query(
    `SELECT * FROM "cpvaProjektuSutartys" WHERE "pirkimoNrCvpis" = $1`,
    [pirkimoNumeris],
  ).then((r: any) => r.rows);
  const projektuNr = Array.from(new Set(sutartys.map((ps: any) => ps.projektoNr).filter(Boolean)));
  if (projektuNr.length > 0) {
    const projektai = await postgres.query(
      `SELECT * FROM "cpvaProjektuSarasas" WHERE "projektoNr" = ANY($1)`,
      [projektuNr],
    ).then((r: any) => r.rows);
    const byNr = new Map<any, any>(projektai.map((p: any) => [p.projektoNr, p]));
    for (const ps of sutartys) {
      const proj = byNr.get(ps.projektoNr);
      if (proj) ps.projektas = proj;
    }
  }
  return sutartys;
}


export async function loadSutartis(id: number): Promise<Sutartis | null> {
  const sutartis = await postgres
    .query(`SELECT * FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
            WHERE "sutartiesUnikalusId" = $1 LIMIT 1`, [id])
    .then((r: any) => r.rows[0]);
  if (!sutartis) return null;

  await applyTiekejasPatikslinimas(sutartis);

  const [panasios, sabis, , cpva, pirkimai] = await Promise.all([
    loadPanasiosSutartys(sutartis),
    loadSabisSutartys(sutartis.sutartiesUnikalusId),
    annotateDokumentai(sutartis),
    loadCpvaProjektai(sutartis.pirkimoNumeris),
    loadPirkimoAtitikmenys(sutartis),
  ]);

  if (panasios.length > 0) sutartis.panasiosSutartys = panasios;
  sutartis.sabisSutartys = sabis;
  sutartis.cpvaProjektuSutartys = cpva;
  sutartis.pirkimoAtitikmenys = pirkimai.atitikmenys;
  // Suderinamumui su ankstesniu JSON formatu.
  if (pirkimai.cvppPirkimas) sutartis.cvppPirkimas = pirkimai.cvppPirkimas;
  if (pirkimai.naujosSistemosPirkimas) sutartis.cvpisPirkimas = pirkimai.naujosSistemosPirkimas;

  sutartis.pavadinimas = fixHtmlEntities(sutartis.pavadinimas);
  sutartis.perkanciojiOrganizacija = fixHtmlEntities(sutartis.perkanciojiOrganizacija);
  sutartis.tiekejas = fixHtmlEntities(sutartis.tiekejas);

  const tipo = (sutartis.tipas || '').trim().toUpperCase();
  sutartis.tipoPavadinimas = (CONTRACT_TYPES as any)[tipo] || tipo;

  return sutartis;
}

import { postgres } from '@/postgres/postgres.js';
import { fixHtmlEntities } from '@/utils/fixHtmlEntities.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';
import { panasiosSutartys, sutartisPagalId } from '@/modules/sutartys/vpmSutartisRow.js';
import { loadCpvaProjektai } from '@/modules/cpva/loadProjektai.js';
import { loadPirkimoAtitikmenys } from './sutartisPirkimai.ts';

export type Sutartis = Record<string, any>;

/**
 * Apply the supplier-name "patikslinimas" (clarification) to a contract.
 *
 * The portal records contracts as scraped from CVP IS, which stores the
 * supplier name in a free-form field that often contains typos, missing
 * legal-form suffixes, or wrong country codes.  Two parallel "open data"
 * tables ship corrected values:
 *
 *   - `vpmSutartys."atviriDuomenys"`     — original open-data dump.
 *   - `vpmSutartys."atviriDuomenysImp"`  — imported / supplemental dump that may
 *                                    refine the original.
 *
 * Both are consulted; the second wins if it has a value, since it is
 * considered the more recent correction.  Country codes from either table
 * are likewise applied (second-table value wins).
 */
async function applyTiekejasPatikslinimas(sutartis: Sutartis) {
  const [atviri, atviriImp] = await Promise.all([
    postgres.query(
      `SELECT d."tiekPavPatikslinimas", v."pavadinimas" AS "tiekSalis"
         FROM "vpmSutartys"."atviriDuomenys" d
         LEFT JOIN "vpmSutartys"."atviriValstybes" v ON v.id = d."valstybesId"
        WHERE d."dokId" = $1 LIMIT 1`,
      [sutartis.sutartiesUnikalusId],
    ),
    postgres.query(
      `SELECT d."tiekSbjPatikslinimas", v."pavadinimas" AS "tiekSalis"
         FROM "vpmSutartys"."atviriDuomenysImp" d
         LEFT JOIN "vpmSutartys"."atviriValstybes" v ON v.id = d."valstybesId"
        WHERE d."dokId" = $1 LIMIT 1`,
      [sutartis.sutartiesUnikalusId],
    ),
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
    panasiosSutartys([
      sutartis.sutartiesUnikalusId,
      sutartis.perkanciosiosOrganizacijosKodas,
      sutartis.tiekejoKodas,
      sutartis.verte,
    ]),
  );
  return r.rows;
}

async function attachJarPavadinimai(salys: any[]) {
  const codes = Array.from(new Set(
    salys.map((s: any) => s.validusJarKodas).filter((c: any): c is string => !!c),
  ));
  if (codes.length === 0) return;
  const rows = await postgres.query(
    `SELECT "jarKodas", "pavadinimas" FROM "rcJar"."spintaAsmenys" WHERE "jarKodas" = ANY($1::text[])`,
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

export const SABIS_SASKAITU_LIMIT = 50;
const SABIS_SASKAITU_MAX_LIMIT = 500;

// Rikiavimo raktai gyvena serveryje: prie >50 sąskaitų kliento lentelė matytų
// tik vieną puslapį, todėl rikiuojama duomenų bazėje.
const SABIS_SASKAITU_RIKIAVIMAI: Record<string, string> = {
  data: 'sk."israsymoData"',
  numeris: 'sk."sfNumeris"',
  tipas: 'sk."sfTipas"',
  bePvm: 'sk."sumaBePvm"',
  pvm: 'sk."sumaPvm"',
  viso: 'sk."bendraSfSuma"',
  busena: 'sk."sfBusena"',
};

interface SabisSaskatuOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  kryptis?: string;
}

function tusciosSaskaitos(options: SabisSaskatuOptions = {}) {
  return {
    rows: [] as any[],
    count: 0,
    suma: null,
    apmoketaSuma: null,
    apmoketaCount: 0,
    nuo: null,
    iki: null,
    limit: SABIS_SASKAITU_LIMIT,
    offset: 0,
    sort: 'data',
    kryptis: 'desc',
    ...options,
  };
}

async function loadSabisSutartys(vpId: number, options: SabisSaskatuOptions = {}) {
  const sutartys = await postgres.query(`SELECT * FROM sabis."sutartys" WHERE "vpId" = $1`, [vpId]).then((r: any) => r.rows);
  if (sutartys.length === 0) return { sutartys, saskaitos: tusciosSaskaitos() };

  const uids = sutartys.map((s: any) => s.sutartiesUid);
  const limit = Math.min(SABIS_SASKAITU_MAX_LIMIT, Math.max(1, Number(options.limit) || SABIS_SASKAITU_LIMIT));
  const offset = Math.max(0, Number(options.offset) || 0);
  const sort = Object.hasOwn(SABIS_SASKAITU_RIKIAVIMAI, String(options.sort)) ? String(options.sort) : 'data';
  const kryptis = options.kryptis === 'asc' ? 'asc' : 'desc';

  const [sutarciuSalys, saskaitos, santrauka] = await Promise.all([
    postgres.query(`SELECT * FROM sabis."sutarciuSalys" WHERE "sutartiesId" = ANY($1)`, [sutartys.map((s: any) => s.sutartiesId)]).then((r: any) => r.rows),
    postgres.query(
      `SELECT sk.* FROM sabis."saskaitos" sk
       WHERE sk."sutartiesUid" = ANY($1)
       ORDER BY ${SABIS_SASKAITU_RIKIAVIMAI[sort]} ${kryptis} NULLS LAST, sk."sfId"
       LIMIT $2 OFFSET $3`,
      [uids, limit, offset],
    ).then((r: any) => r.rows),
    postgres.query(
      `SELECT count(*)::bigint AS "count",
              sum(sk."bendraSfSuma") AS "suma",
              sum(sk."bendraSfSuma") FILTER (WHERE sk."sfBusena" = 'Apmokėta') AS "apmoketaSuma",
              count(*) FILTER (WHERE sk."sfBusena" = 'Apmokėta')::bigint AS "apmoketaCount",
              min(sk."israsymoData") AS "nuo",
              max(sk."israsymoData") AS "iki"
       FROM sabis."saskaitos" sk WHERE sk."sutartiesUid" = ANY($1)`,
      [uids],
    ).then((r: any) => r.rows[0]),
  ]);

  const saskaituSalys = saskaitos.length > 0
    ? await postgres.query(`SELECT ss.*, t.tipas, v."veiklosVieta" FROM sabis."saskaituSalys" ss LEFT JOIN sabis."saskaituSalysTipai" t ON t.id = ss."tipasId" LEFT JOIN sabis."saskaituSalysVeiklosVieta" v ON v.id = ss."veiklosVietaId" WHERE ss."sfId" = ANY($1)`, [saskaitos.map((sk: any) => sk.sfId)]).then((r: any) => r.rows)
    : [];

  const sutarciuSalysById = groupBy(sutarciuSalys, 'sutartiesId');
  const saskaitosByUid = groupBy(saskaitos, 'sutartiesUid');
  const saskaituSalysBySfId = groupBy(saskaituSalys, 'sfId');
  const sutartysByUid = new Map(sutartys.map((s: any) => [s.sutartiesUid, s]));

  for (const sk of saskaitos) {
    sk.salys = saskaituSalysBySfId.get(sk.sfId) || [];
    // Kai pirkimas turi kelias SABIS sutartis, sąskaitų lentelėje reikia
    // parodyti, kuriai iš jų sąskaita priklauso.
    sk.sutartiesPavadinimas = (sutartysByUid.get(sk.sutartiesUid) as any)?.pavadinimas ?? null;
  }
  for (const s of sutartys) {
    s.salys = sutarciuSalysById.get(s.sutartiesId) || [];
    // Suderinamumui su ankstesniu JSON formatu – tik einamojo puslapio dalis.
    s.saskaitos = saskaitosByUid.get(s.sutartiesUid) || [];
  }
  await attachJarPavadinimai([...sutarciuSalys, ...saskaituSalys]);

  return {
    sutartys,
    saskaitos: {
      rows: saskaitos,
      count: Number(santrauka?.count ?? 0),
      suma: santrauka?.suma ?? null,
      apmoketaSuma: santrauka?.apmoketaSuma ?? null,
      apmoketaCount: Number(santrauka?.apmoketaCount ?? 0),
      nuo: santrauka?.nuo ?? null,
      iki: santrauka?.iki ?? null,
      limit,
      offset,
      sort,
      kryptis,
    },
  };
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

export async function loadSutartis(id: number, options: { sabisSaskaitos?: SabisSaskatuOptions } = {}): Promise<Sutartis | null> {
  const sutartis = await postgres
    .query(sutartisPagalId([id]))
    .then((r: any) => r.rows[0]);
  if (!sutartis) return null;

  await applyTiekejasPatikslinimas(sutartis);

  const [panasios, sabis, , cpva, pirkimai] = await Promise.all([
    loadPanasiosSutartys(sutartis),
    loadSabisSutartys(sutartis.sutartiesUnikalusId, options.sabisSaskaitos),
    annotateDokumentai(sutartis),
    loadCpvaProjektai(sutartis),
    loadPirkimoAtitikmenys(sutartis),
  ]);

  if (panasios.length > 0) sutartis.panasiosSutartys = panasios;
  sutartis.sabisSutartys = sabis.sutartys;
  sutartis.sabisSaskaitos = sabis.saskaitos;
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

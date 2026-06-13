import { postgres } from '@/postgres/postgres.js';
import { buildTedNoticeViewModel } from '@/modules/ted/viewer.js';
import { searchSutartys } from '@/modules/sutartys/searchSutartys.js';

export type Pirkimas = Record<string, any>;

const parseTedNoticeNumber = (url: string) => {
  const trimmed = String(url).trim();
  const noticeMatch = trimmed.match(/NOTICE:(\d+-\d{4})/i);
  if (noticeMatch?.[1]) return noticeMatch[1];
  const fallbackMatch = trimmed.match(/(\d{4,}-\d{4})/);
  return fallbackMatch?.[1] || null;
};

async function attachLocalFailai(pirkimoId: string, failai: any[]) {
  const saltinioIds = failai.flatMap((failas: any) =>
    (failas.versijos ?? []).map((v: any) => `${pirkimoId}/${failas.dokumentasId}/${v.versionId}`),
  );
  if (!saltinioIds.length) return;

  const { rows: failaiRows } = await postgres.query(
    `SELECT id, "saltinioId", extension, parsiustas, nuskaitytas, "zodziuSkaicius", "puslapiuSkaicius", dydis, md5
     FROM public."failai" WHERE saltinis = 'cvpIs' AND "saltinioId" = ANY($1)`,
    [saltinioIds],
  );
  const lokalusFailai = Object.fromEntries(failaiRows.map((f: any) => [f.saltinioId, f]));
  for (const failas of failai) {
    for (const versija of failas.versijos ?? []) {
      const saltinioId = `${pirkimoId}/${failas.dokumentasId}/${versija.versionId}`;
      const lokalus = (lokalusFailai as any)[saltinioId];
      if (lokalus) {
        const { id, filename, extension, parsiustas, nuskaitytas, zodziuSkaicius, puslapiuSkaicius, dydis, md5 } = lokalus;
        Object.assign(versija, { id, filename, extension, parsiustas, nuskaitytas, zodziuSkaicius, puslapiuSkaicius, dydis, md5 });
      }
    }
  }
}

function fixSkelbimaiUrls(skelbimai: any[]) {
  return skelbimai.map((s: any) => {
    if (!s || typeof s !== 'object') return s;
    const href = (s.downloadHref || '').trim();
    if (!href || /^https?:\/\//i.test(href)) return s;
    const path = href.startsWith('/') ? href : `/${href}`;
    return { ...s, downloadHref: `https://viesiejipirkimai.lt${path}` };
  });
}

async function annotateTedSkelbimai(turinys: any) {
  if (!Array.isArray(turinys?.tedNuorodosIPaskelbtusPranesimus)) return;
  const tedUrls: string[] = turinys.tedNuorodosIPaskelbtusPranesimus.filter(
    (u: any) => typeof u === 'string' && u.trim().length > 0,
  );
  turinys.tedSkelbimai = [];
  turinys.tedNuorodosIsorines = [];

  const tedNoticeNumbers = [...new Set(tedUrls.map(parseTedNoticeNumber).filter(Boolean))];
  if (!tedNoticeNumbers.length) {
    turinys.tedNuorodosIsorines = tedUrls;
    return;
  }

  const { rows: tedRows } = await postgres.query(
    `SELECT "tedNoticeNumber", turinys FROM public."tedNotices" WHERE "tedNoticeNumber" = ANY($1) AND turinys IS NOT NULL`,
    [tedNoticeNumbers],
  );
  const availableNotices = new Map(tedRows.map((r: any) => [r.tedNoticeNumber, r.turinys]));

  for (const url of tedUrls) {
    const tedNoticeNumber = parseTedNoticeNumber(url);
    if (!tedNoticeNumber || !availableNotices.has(tedNoticeNumber)) {
      turinys.tedNuorodosIsorines.push(url);
      continue;
    }
    let pavadinimas = 'TED skelbimas';
    const tedTurinys = availableNotices.get(tedNoticeNumber);
    if (tedTurinys) {
      try {
        const tedView = buildTedNoticeViewModel(tedTurinys);
        pavadinimas = tedView?.documentTypeLabel || tedView?.subTypeDescription || pavadinimas;
      } catch {}
    }
    turinys.tedSkelbimai.push({ pavadinimas, numeris: tedNoticeNumber, downloadHref: `/ted/${tedNoticeNumber}`, originalHref: url });
  }
}

export async function loadPirkimas(pirkimoId: string): Promise<Pirkimas | null> {
  const { rows } = await postgres.query(
    `SELECT p.*, v.pavadinimas AS "vykdytojoPavadinimas", v."jarKodas"
       FROM public."viesiejiPirkimai" p
       LEFT JOIN public."viesiejiPirkimaiVykdytojai" v ON v.id = p."pirkimoVykdytojasId"
      WHERE p."pirkimoId" = $1`,
    [pirkimoId],
  );
  const pirkimas = rows[0];
  if (!pirkimas) return null;

  await attachLocalFailai(pirkimoId, pirkimas.turinys?.failai ?? []);

  if (Array.isArray(pirkimas?.turinys?.skelbimai)) {
    pirkimas.turinys.skelbimai = fixSkelbimaiUrls(pirkimas.turinys.skelbimai);
  }

  await annotateTedSkelbimai(pirkimas.turinys);

  const sutartysRes = await searchSutartys({ pirkimoNumeris: pirkimas.pirkimoId });
  pirkimas.sutartys = sutartysRes.results;

  const { loadAtn1ForPirkimas } = await import('./atn1.js');
  pirkimas.atn1 = await loadAtn1ForPirkimas(pirkimas.pirkimoId);

  return pirkimas;
}

export function buildTimelineItems(pirkimas: Pirkimas) {
  const t = pirkimas.turinys || {};
  return [
    pirkimas.paskelbimoData && { date: pirkimas.paskelbimoData, label: 'Paskelbta' },
    t.paskelbimoIrArbaKvietimoData && { date: t.paskelbimoIrArbaKvietimoData, label: 'Kvietimo data' },
    t.paaiskinimuTerminoPabaiga && { date: t.paaiskinimuTerminoPabaiga, label: 'Paaiškinimų terminas' },
    pirkimas.pasiulymuPateikimoTerminas && { date: pirkimas.pasiulymuPateikimoTerminas, label: 'Pasiūlymų teikimo terminas' },
    t.susipazinimoSuPasiulymaisData && { date: t.susipazinimoSuPasiulymaisData, label: 'Susipažinimo data' },
    t.laimetojoNustatymoData && { date: t.laimetojoNustatymoData, label: 'Laimėtojas nustatytas' },
    t.dpsGaliojimoDataIrLaikas && { date: t.dpsGaliojimoDataIrLaikas, label: 'DPS galiojimas' },
    t.kvsGaliojimoDataIrLaikas && { date: t.kvsGaliojimoDataIrLaikas, label: 'KVS galiojimas' },
  ].filter(Boolean) as { date: any; label: string }[];
}

export function buildTedKorteles(turinys: any) {
  const tedSkelbimai: any[] = Array.isArray(turinys?.tedSkelbimai) ? turinys.tedSkelbimai : [];
  const tedIsorinesNuorodos: any[] = Array.isArray(turinys?.tedNuorodosIsorines) ? turinys.tedNuorodosIsorines : [];
  return [
    ...tedSkelbimai,
    ...tedIsorinesNuorodos.map((url: string) => {
      const m = String(url).match(/NOTICE:(\d+-\d{4})/i) || String(url).match(/(\d{4,}-\d{4})/);
      const noticeId = m && m[1] ? m[1] : null;
      return { pavadinimas: 'TED skelbimas', numeris: noticeId, downloadHref: url, originalHref: url };
    }),
  ];
}

export function getCvpisUrl(pirkimas: Pirkimas) {
  const map: Record<string, string> = {
    Pmc: 'viewPmc',
    CfTWS: 'prepareViewCfTWS',
    CfTDPSWS: 'prepareViewCfTDPSWS',
  };
  const action = map[pirkimas.type as string];
  return action ? `https://viesiejipirkimai.lt/epps/${action.startsWith('view') ? 'pmc' : 'cft'}/${action}.do?resourceId=${pirkimas.pirkimoId}` : null;
}

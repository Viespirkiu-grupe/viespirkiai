import { postgres } from '@/postgres/postgres.js';

/**
 * Sutarties „pirkimo numerio" atitikmenys.
 *
 * Sutartis (CVP IS sutarčių ataskaitos) nurodo tik pirkimo numerį — be
 * nuorodos, kurios sistemos tai numeris.  Numeriai yra šešiaženkliai ir
 * dvi sistemos juos dalina nepriklausomai:
 *
 *   • „nauja"  — viesiejipirkimai.lt (EPPS), lentelė `viesiejiPirkimai`,
 *                raktas `pirkimoId`;
 *   • „cvpp"   — cvpp.eviesiejipirkimai.lt skelbimai (`cvppViesiejiPirkimai`)
 *                ir pirkimai.eviesiejipirkimai.lt pirkimai (`cvppPirkimai`),
 *                raktas — skelbime nurodytas `pirkimoNumeris`.
 *
 * Todėl tas pats numeris dažnai randamas abiejose sistemose ir tik viena iš
 * jų yra tikrasis sutarties pirkimas (~2,2 tūkst. sutarčių DB).  Vietoj to,
 * kad tyliai pasirinktume vieną, surenkame visus kandidatus ir kiekvieną
 * įvertiname pagal pirkėją, pavadinimą ir datą — puslapis parodo abu su
 * patikimumo žyma.
 */

export type PirkimoSistema = 'nauja' | 'cvpp';

export interface PirkimoAtitikmuo {
  sistema: PirkimoSistema;
  sistemosPavadinimas: string;
  pavadinimas: string | null;
  pirkejas: string | null;
  jarKodas: string | null;
  paskelbimoData: Date | string | null;
  vidineNuoroda: string | null;
  isorineNuoroda: string | null;
  papildoma: string | null;
  detales: { label: string; value: string }[];
  informacija: string | null;
  balas: number;
  pozymiai: string[];
  patikimumas: 'tikslus' | 'galimas' | 'silpnas';
}

export interface SutartiesKontekstas {
  pavadinimas?: string | null;
  perkanciosiosOrganizacijosKodas?: string | null;
  sudarymoData?: Date | string | null;
}

export interface PirkimoKandidatas {
  sistema: PirkimoSistema;
  pavadinimas?: string | null;
  jarKodas?: string | null;
  paskelbimoData?: Date | string | null;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

const SISTEMU_PAVADINIMAI: Record<PirkimoSistema, string> = {
  nauja: 'viesiejipirkimai.lt',
  cvpp: 'CVPP',
};

export function parsePirkimoId(pirkimoNumeris: string | null | undefined): number | null {
  if (!pirkimoNumeris || !/^\d+$/.test(pirkimoNumeris)) return null;
  const pirkimoId = Number(pirkimoNumeris);
  return Number.isSafeInteger(pirkimoId) && pirkimoId <= POSTGRES_INTEGER_MAX ? pirkimoId : null;
}

/** Pavadinimuose kartojasi bendriniai žodžiai — jie nieko nepasako apie atitikimą. */
const NEREIKSMINGI = new Set([
  'pirkimas', 'pirkimo', 'pirkimai', 'pirkimui', 'sutartis', 'sutarties', 'sutartys',
  'paslaugos', 'paslaugu', 'paslaugų', 'paslauga', 'darbai', 'darbu', 'darbų',
  'prekes', 'prekiu', 'prekių', 'prekės', 'viesojo', 'viešojo', 'pardavimo',
  'supaprastintas', 'atviras', 'konkursas', 'apklausa', 'nauja', 'skelbiama',
]);

/** VšĮ CPO LT — perka kitų įstaigų vardu, tad pirkėjas su sutartimi nesutampa. */
const CENTRINES_PERKANCIOSIOS_ORGANIZACIJOS = new Set(['302913276']);

function zodziai(tekstas: string | null | undefined): Set<string> {
  const normalizuotas = (tekstas || '')
    .toLowerCase()
    .replace(/[^0-9a-ząčęėįšųūž]+/g, ' ')
    .trim();
  if (!normalizuotas) return new Set();
  return new Set(normalizuotas.split(' ').filter((z) => z.length > 3 && !NEREIKSMINGI.has(z)));
}

/** Dice koeficientas iš reikšmingų pavadinimo žodžių (0…1). */
export function pavadinimuPanasumas(a: string | null | undefined, b: string | null | undefined): number {
  const x = zodziai(a);
  const y = zodziai(b);
  if (x.size === 0 || y.size === 0) return 0;
  let bendri = 0;
  for (const z of x) if (y.has(z)) bendri++;
  return (2 * bendri) / (x.size + y.size);
}

function data(reiksme: Date | string | null | undefined): number | null {
  if (!reiksme) return null;
  const t = new Date(reiksme).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Įvertina, kiek kandidatas panašus į tikrąjį sutarties pirkimą.
 * Grąžina balą (kuo didesnis, tuo patikimiau) ir žmogui skirtus požymius.
 */
export function ivertintiAtitikmeni(sutartis: SutartiesKontekstas, kandidatas: PirkimoKandidatas) {
  const pozymiai: string[] = [];
  let balas = 0;

  const sutartiesJar = sutartis.perkanciosiosOrganizacijosKodas || null;
  const kandidatoJar = kandidatas.jarKodas || null;
  if (kandidatoJar && CENTRINES_PERKANCIOSIOS_ORGANIZACIJOS.has(String(kandidatoJar))) {
    // CPO LT katalogo užsakymuose pirkimą vykdo CPO, o sutartį sudaro
    // užsakovas — pirkėjų skirtumas čia normalus, ne požymis prieš atitikimą.
    balas += 1;
    pozymiai.push('pirkimą vykdė centrinė perkančioji organizacija');
  } else if (sutartiesJar && kandidatoJar) {
    if (String(sutartiesJar) === String(kandidatoJar)) {
      // Vien pirkėjo sutapimo maža — didelės organizacijos vykdo tūkstančius
      // pirkimų, tad atsitiktinai sutampantis numeris dažnai bus jų pačių.
      balas += 2;
      pozymiai.push('tas pats pirkėjas');
    } else {
      balas -= 2;
      pozymiai.push('kitas pirkėjas');
    }
  }

  const panasumas = pavadinimuPanasumas(sutartis.pavadinimas, kandidatas.pavadinimas);
  if (panasumas >= 0.5) {
    balas += 4;
    pozymiai.push('sutampa pavadinimas');
  } else if (panasumas >= 0.25) {
    balas += 2;
    pozymiai.push('panašus pavadinimas');
  }

  const paskelbta = data(kandidatas.paskelbimoData);
  const sudaryta = data(sutartis.sudarymoData);
  if (paskelbta !== null && sudaryta !== null) {
    if (paskelbta <= sudaryta) balas += 1;
    else {
      balas -= 1;
      pozymiai.push('paskelbtas vėliau nei sudaryta sutartis');
    }
  }

  const patikimumas = balas >= 5 ? 'tikslus' : balas >= 1 ? 'galimas' : 'silpnas';
  return { balas, pozymiai, patikimumas } as const;
}

/** PID (CVPP vidinis pirkimo id) iš skelbimo nuorodų. */
function cvppPid(skelbimas: any): number | null {
  const saltiniai = [skelbimas?.dokumentaiLink, skelbimas?.link];
  for (const url of saltiniai) {
    const m = String(url || '').match(/(?:PID=|PublicPurchase\/)(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

async function loadNaujosSistemosKandidatas(pirkimoId: number) {
  const row = await postgres
    .query(`SELECT * FROM "viesiejiPirkimai" WHERE "pirkimoId" = $1`, [pirkimoId])
    .then((r: any) => r.rows[0]);
  return row || null;
}

async function loadCvppKandidatai(pirkimoNumeris: string) {
  const skelbimai = await postgres.query(
    `SELECT c.*, o."imonesKodas" AS "organizacijosJarKodas", o.pavadinimas AS "organizacijosPavadinimas"
     FROM "cvppViesiejiPirkimai" c
     LEFT JOIN "cvppOrganizacijos" o ON o."organizacijosId" = c."perkanciosiosOrganizacijosId"
     WHERE c."pirkimoNumeris" = $1
     ORDER BY c."paskelbimoData" ASC NULLS LAST`,
    [pirkimoNumeris],
  ).then((r: any) => r.rows);
  if (skelbimai.length === 0) return [];

  // Vienas CVPP pirkimas turi kelis skelbimus — grupuojame pagal PID. Dalis
  // skelbimų PID neturi (nėra dokumentų nuorodos); jei tas pats numeris turi
  // tik vieną žinomą PID, tokie skelbimai priskiriami jam, kitaip — atskirai.
  const grupes = new Map<string, any[]>();
  const bePid: any[] = [];
  for (const skelbimas of skelbimai) {
    const pid = cvppPid(skelbimas);
    if (pid === null) {
      bePid.push(skelbimas);
      continue;
    }
    const grupe = grupes.get(String(pid));
    if (grupe) grupe.push(skelbimas);
    else grupes.set(String(pid), [skelbimas]);
  }
  if (bePid.length > 0) {
    const vienintele = grupes.size === 1 ? grupes.values().next().value : undefined;
    if (vienintele) vienintele.push(...bePid);
    else grupes.set('be-pid', bePid);
  }

  const pidai = [...grupes.keys()].filter((k) => k !== 'be-pid').map(Number);
  const pirkimai = pidai.length > 0
    ? await postgres.query(`SELECT * FROM "cvppPirkimai" WHERE "pirkimoId" = ANY($1::int[])`, [pidai]).then((r: any) => r.rows)
    : [];
  const pirkimasPagalPid = new Map<number, any>(pirkimai.map((p: any) => [p.pirkimoId, p]));

  return [...grupes.entries()].map(([raktas, grupe]) => ({
    pid: raktas === 'be-pid' ? null : Number(raktas),
    pirkimas: raktas === 'be-pid' ? null : pirkimasPagalPid.get(Number(raktas)) || null,
    skelbimai: grupe,
  }));
}

function naujosSistemosAtitikmuo(sutartis: SutartiesKontekstas, pirkimas: any): PirkimoAtitikmuo {
  const vertinimas = ivertintiAtitikmeni(sutartis, {
    sistema: 'nauja',
    pavadinimas: pirkimas.pavadinimas,
    jarKodas: pirkimas.jarKodas,
    paskelbimoData: pirkimas.paskelbimoData,
  });
  return {
    sistema: 'nauja',
    sistemosPavadinimas: SISTEMU_PAVADINIMAI.nauja,
    pavadinimas: pirkimas.pavadinimas || null,
    pirkejas: pirkimas.pirkimoVykdytojas || null,
    jarKodas: pirkimas.jarKodas || null,
    paskelbimoData: pirkimas.paskelbimoData || null,
    vidineNuoroda: `/viesiejiPirkimai/${pirkimas.pirkimoId}`,
    isorineNuoroda: null,
    papildoma: [pirkimas.pirkimoBudas, pirkimas.statusas].filter(Boolean).join(' · ') || null,
    detales: [
      pirkimas.pasiulymuPateikimoTerminas
        ? { label: 'Pasiūlymų terminas', value: String(pirkimas.pasiulymuPateikimoTerminas).slice(0, 10) }
        : null,
      Number(pirkimas.numatomaVerteEUR) > 0
        ? { label: 'Numatoma vertė', value: `${Number(pirkimas.numatomaVerteEUR).toLocaleString('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` }
        : null,
    ].filter(Boolean) as { label: string; value: string }[],
    informacija: pirkimas.informacija || null,
    ...vertinimas,
  };
}

function cvppAtitikmuo(sutartis: SutartiesKontekstas, grupe: any): PirkimoAtitikmuo {
  const skelbimai = [...grupe.skelbimai].sort(
    (a: any, b: any) => new Date(a.paskelbimoData || 0).getTime() - new Date(b.paskelbimoData || 0).getTime(),
  );
  const pirmasSkelbimas = skelbimai[0];
  const pirkimas = grupe.pirkimas;
  const pavadinimas = pirkimas?.pavadinimas || pirmasSkelbimas?.pavadinimas || null;
  const jarKodas = pirmasSkelbimas?.organizacijosJarKodas || null;
  const paskelbimoData = pirmasSkelbimas?.paskelbimoData || null;
  const vertinimas = ivertintiAtitikmeni(sutartis, { sistema: 'cvpp', pavadinimas, jarKodas, paskelbimoData });
  const skelbimuSkaicius = grupe.skelbimai.length;

  return {
    sistema: 'cvpp',
    sistemosPavadinimas: SISTEMU_PAVADINIMAI.cvpp,
    pavadinimas,
    pirkejas: pirkimas?.pirkejoPavadinimas || pirmasSkelbimas?.pirkimoVykdytojas || null,
    jarKodas,
    paskelbimoData,
    vidineNuoroda: null,
    isorineNuoroda: pirkimas?.link || pirmasSkelbimas?.link || null,
    papildoma: skelbimuSkaicius > 1
      ? `${skelbimuSkaicius} skelbimai`
      : pirmasSkelbimas?.skelbimoTipas || null,
    detales: pirkimas?.pasiulymoPateikimoTerminas
      ? [{ label: 'Pasiūlymų terminas', value: String(pirkimas.pasiulymoPateikimoTerminas).slice(0, 10) }]
      : [],
    informacija: pirkimas?.aprasymas || null,
    ...vertinimas,
  };
}

/**
 * Grąžina visus sutarties pirkimo numerio atitikmenis, surikiuotus nuo
 * patikimiausio. Tuščias masyvas — numeris ne skaitinis arba nerastas.
 */
export async function loadPirkimoAtitikmenys(sutartis: SutartiesKontekstas & { pirkimoNumeris?: string | null }) {
  const pirkimoNumeris = sutartis.pirkimoNumeris;
  const pirkimoId = parsePirkimoId(pirkimoNumeris);
  if (pirkimoId === null || !pirkimoNumeris) {
    return { atitikmenys: [] as PirkimoAtitikmuo[], naujosSistemosPirkimas: null, cvppPirkimas: null };
  }

  const [naujosSistemosPirkimas, cvppGrupes] = await Promise.all([
    loadNaujosSistemosKandidatas(pirkimoId),
    loadCvppKandidatai(pirkimoNumeris),
  ]);

  const atitikmenys: PirkimoAtitikmuo[] = [];
  if (naujosSistemosPirkimas) atitikmenys.push(naujosSistemosAtitikmuo(sutartis, naujosSistemosPirkimas));
  for (const grupe of cvppGrupes) atitikmenys.push(cvppAtitikmuo(sutartis, grupe));
  atitikmenys.sort((a, b) => b.balas - a.balas);

  const geriausiaCvppGrupe = cvppGrupes
    .map((grupe: any) => ({ grupe, balas: cvppAtitikmuo(sutartis, grupe).balas }))
    .sort((a: any, b: any) => b.balas - a.balas)[0];

  return {
    atitikmenys,
    naujosSistemosPirkimas,
    cvppPirkimas: geriausiaCvppGrupe?.grupe.pirkimas || geriausiaCvppGrupe?.grupe.skelbimai[0] || null,
  };
}

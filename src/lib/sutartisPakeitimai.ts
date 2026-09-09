import {
  fetchRecentChanges,
  fetchChangesByIds,
  fetchChangedContractsPage,
  fetchChangesFacets,
  countChanges,
  countContractChanges,
  diffContractDocuments,
} from '@/modules/sutartys/recentChanges.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';
import { fmtEur } from './formatters.ts';

/** Žmogui suprantami kanoninių sutarties laukų pavadinimai. */
const FIELD_LABELS: Record<string, string> = {
  pavadinimas: 'Pavadinimas',
  sudarymoData: 'Sudarymo data',
  galiojimoData: 'Galiojimo data',
  faktineIvykdimoData: 'Faktinė įvykdymo data',
  paskelbimoData: 'Paskelbimo data',
  redagavimoData: 'Redagavimo data',
  perkanciosiosOrganizacijosKodas: 'Perkančiosios organizacijos kodas',
  perkanciosiosOrganizacijosPavadinimas: 'Perkančioji organizacija',
  sutartiesNumeris: 'Sutarties numeris',
  pirkimoNumeris: 'Pirkimo numeris',
  numatomaVerte: 'Numatoma vertė',
  faktineVerte: 'Faktinė vertė',
  pirmoTiekejoKodas: 'Tiekėjo kodas',
  pirmoTiekejoPavadinimas: 'Tiekėjas',
  papildomiTiekejai: 'Papildomi tiekėjai',
  tipas: 'Tipas',
  kategorija: 'Kategorija',
  bvpzKodas: 'BVPŽ kodas',
  papildomiBvpzKodai: 'Papildomi BVPŽ kodai',
  dokumentai: 'Dokumentai',
  istrinta: 'Ištrinta',
  pakeitimas: 'Pakeitimo žyma',
};

const MONEY_FIELDS = new Set(['numatomaVerte', 'faktineVerte']);
const DATE_FIELDS = new Set([
  'sudarymoData',
  'galiojimoData',
  'faktineIvykdimoData',
  'paskelbimoData',
  'redagavimoData',
]);

export type PakeitimoEilute = {
  laukas: string;
  before: string | null;
  after: string | null;
  kryptis: 'pridėta' | 'pašalinta' | 'pakeista';
  /** Ryškus būsenos pokytis, rodomas kaip atskira žyma (pvz. sutarties ištrynimas). */
  busena?: 'istrinta' | 'atkurta';
  /** Sujungtos „Vertės" eilutės pokytis, pvz. „+2 323,20 € (+200 %)". */
  delta?: string;
  /** Paaiškinimas prie eilutės, pvz. „patikslinta faktine". */
  pastaba?: string;
};

export type SutartiesPakeitimas = {
  id: number;
  data: Date | string;
  eilutes: PakeitimoEilute[];
  /** Užpildoma tik globaliame sąraše – kad būtų galima parodyti ir susieti sutartį. */
  unikalusId?: number;
  pavadinimas?: string | null;
  perkancioKodas?: string | null;
  perkancioPavadinimas?: string | null;
};

function laukoLabel(field: string): string {
  if (field.startsWith('dokumentai[')) return 'Dokumentas';
  return FIELD_LABELS[field] ?? field;
}

/** Vieno lauko reikšmę paverčia trumpu, žmogui skaitomu tekstu. */
function formatValue(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'boolean') return value ? 'Taip' : 'Ne';

  if (MONEY_FIELDS.has(field) && (typeof value === 'number' || typeof value === 'string')) {
    return `${fmtEur(value)}\u00a0€`;
  }

  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    // ISO ar timestamp – paliekame tik datą (arba datą + laiką).
    return value.length > 10 ? value.slice(0, 16).replace('T', ' ') : value.slice(0, 10);
  }

  if (field === 'tipas' && typeof value === 'string') {
    return (CONTRACT_TYPES as Record<string, string>)[value.trim().toUpperCase()] ?? value;
  }

  if (field.startsWith('dokumentai[')) {
    const doc = value as { pavadinimas?: string; fileId?: unknown };
    return doc?.pavadinimas || (doc?.fileId != null ? `Failas #${doc.fileId}` : JSON.stringify(value));
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value
      .map((item) =>
        item && typeof item === 'object'
          ? (item.pavadinimas ?? item.bvpzKodas ?? item.kodas ?? JSON.stringify(item))
          : String(item),
      )
      .join(', ');
  }

  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

/** „+2 323,20 € (+200 %)" – sujungtos vertės eilutės pokytis. */
function deltosTekstas(pries: number | null, po: number | null): string | undefined {
  if (pries === null || po === null) return undefined;
  const skirtumas = po - pries;
  if (skirtumas === 0) return undefined;
  const zenklas = skirtumas > 0 ? '+' : '−';
  const suma = `${zenklas}${fmtEur(Math.abs(skirtumas))}\u00a0€`;
  if (pries === 0) return suma;
  const proc = Math.round((skirtumas / Math.abs(pries)) * 100);
  return `${suma} (${zenklas}${Math.abs(proc).toLocaleString('lt-LT')}\u00a0%)`;
}

const PAGRINDO_PASTABOS: Record<string, string> = {
  'numatoma→faktine': 'patikslinta faktine verte',
  'faktine→numatoma': 'faktinės vertės nebeliko',
};

/**
 * Sujungta „Vertės" eilutė iš `skirtumai._verte`: numatoma ir faktinė vertė nėra
 * du nepriklausomi skaičiai, tad rodome vieną aktualios vertės judesį
 * (COALESCE(faktinė, numatoma)) su delta ir pagrindo pasikeitimu.
 */
function verteseEilute(verte: any): { eilute: PakeitimoEilute; pries: number | null; po: number | null } | null {
  if (!verte) return null;
  const pries = verte.pries ?? null;
  const po = verte.po ?? null;
  const nuo = verte.pagrindas?.pries ?? null;
  const iki = verte.pagrindas?.po ?? null;
  return {
    pries,
    po,
    eilute: {
      laukas: 'Vertė',
      before: pries === null ? null : `${fmtEur(pries)}\u00a0€`,
      after: po === null ? null : `${fmtEur(po)}\u00a0€`,
      kryptis: pries === null ? 'pridėta' : po === null ? 'pašalinta' : 'pakeista',
      delta: deltosTekstas(pries, po),
      pastaba: nuo && iki && nuo !== iki ? PAGRINDO_PASTABOS[`${nuo}→${iki}`] : undefined,
    },
  };
}

/** Vieną `vpmSutartys."changes"` eilutę paverčia matomų skirtumų sąrašu (arba null). */
function rowToPakeitimas(row: any): SutartiesPakeitimas | null {
  if (!row.after) return null;
  const diffs = diffContractDocuments(row.before, row.after);
  const verte = verteseEilute(row.skirtumai?._verte);
  let verteIdeta = false;
  const eilutes: PakeitimoEilute[] = [];
  for (const diff of diffs) {
    // Ištrynimą/atkūrimą rodome kaip ryškią būsenos žymą, ne kaip Ne→Taip eilutę.
    if (diff.field === 'istrinta') {
      eilutes.push({
        laukas: laukoLabel(diff.field),
        before: formatValue(diff.field, diff.before),
        after: formatValue(diff.field, diff.after),
        kryptis: 'pakeista',
        busena: diff.after === true ? 'istrinta' : 'atkurta',
      });
      continue;
    }
    if (verte && MONEY_FIELDS.has(diff.field)) {
      // Sujungta eilutė stoja pirmojo vertės lauko vieton (kanoninė tvarka).
      if (!verteIdeta) {
        eilutes.push(verte.eilute);
        verteIdeta = true;
      }
      // Žalią lauką praleidžiame tik tada, kai jis nieko naujo nepasako –
      // t. y. juda lygiai taip pat kaip aktuali vertė.
      const sutampa = (diff.before ?? null) === verte.pries && (diff.after ?? null) === verte.po;
      if (sutampa) continue;
    }
    const before = formatValue(diff.field, diff.before);
    const after = formatValue(diff.field, diff.after);
    if (before === null && after === null) continue;
    eilutes.push({
      laukas: laukoLabel(diff.field),
      before,
      after,
      kryptis: before === null ? 'pridėta' : after === null ? 'pašalinta' : 'pakeista',
    });
  }
  if (eilutes.length === 0) return null;
  const doc = row.after ?? row.before ?? {};
  return {
    id: row.id,
    data: row.pakeitimoData,
    eilutes,
    unikalusId: doc.unikalusId,
    pavadinimas: doc.pavadinimas ?? null,
    perkancioKodas: doc.perkanciosiosOrganizacijosKodas ?? null,
    perkancioPavadinimas: doc.perkanciosiosOrganizacijosPavadinimas ?? null,
  };
}

/**
 * Užkrauna vienos sutarties pakeitimų istoriją iš `vpmSutartys."changes"`,
 * paversdama kiekvieną snapshotą į matomų laukų skirtumus (before → after).
 * Pakeitimai be matomų kanoninio JSON skirtumų praleidžiami.
 */
export async function loadSutartisPakeitimai(
  unikalusId: number,
  limit: number | null = null,
): Promise<SutartiesPakeitimas[]> {
  let rows: any[];
  try {
    // limit = null → LIMIT NULL, t. y. visa sutarties pakeitimų istorija.
    rows = await fetchRecentChanges({ id: unikalusId, limit } as any);
  } catch {
    return [];
  }
  return rows.map(rowToPakeitimas).filter((p): p is SutartiesPakeitimas => p !== null);
}

/** Grąžina tikslų sutarties pakeitimų eilučių skaičių. */
export async function countSutartisPakeitimai(unikalusId: number): Promise<number> {
  try {
    return await countContractChanges(unikalusId);
  } catch {
    return 0;
  }
}

export type SutartiesRedagavimai = {
  unikalusId: number;
  pavadinimas: string | null;
  perkancioKodas: string | null;
  perkancioPavadinimas: string | null;
  /** Bendras sutarties pakeitimų skaičius `vpmSutartys."changes"` lentelėje. */
  viso: number;
  /** Kiek pakeitimų neparodyta (nutraukta ties keliais naujausiais). */
  praleista: number;
  /** Keli naujausi matomi pakeitimai (numatyta – iki 3). */
  pakeitimai: SutartiesPakeitimas[];
};

/** Redagavimų sąrašo filtras – tiesiogiai atitinka URL parametrus. */
export type RedagavimuFiltras = {
  /** Rodyti ir pakeitimus, kuriuose pasikeitė vien `redagavimoData`. */
  visi: boolean;
  /** Kanoninių laukų raktai + išvestinis `_verte`. */
  laukai: string[];
  busena: 'istrinta' | 'atkurta' | null;
  nuo: string | null;
  iki: string | null;
  verte: 'padidejo' | 'sumazejo' | null;
  verteMin: number | null;
};

export type Rikiavimas = 'naujausi' | 'verte' | 'daugiausia';

export const RIKIAVIMO_PAVADINIMAI: Record<Rikiavimas, string> = {
  naujausi: 'Naujausi',
  verte: 'Didžiausias vertės pokytis',
  daugiausia: 'Daugiausia redagavimų',
};

/** Facetų eilutė šoninėje juostoje. */
export type FacetoParinktis = { reiksme: string; label: string; kiek: number };

export type RedagavimuFacetai = {
  laukai: FacetoParinktis[];
  busenos: FacetoParinktis[];
  vertesKryptis: FacetoParinktis[];
  /** Kiek pakeitimų šiuo metu paslėpta kaip techniniai (tik `redagavimoData`). */
  nereiksmingi: number;
};

export const TUSCIAS_FILTRAS: RedagavimuFiltras = {
  visi: false,
  laukai: [],
  busena: null,
  nuo: null,
  iki: null,
  verte: null,
  verteMin: null,
};

const teigiamas = (value: string | null): number | null => {
  if (!value) return null;
  const skaicius = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(skaicius) && skaicius > 0 ? skaicius : null;
};

const data = (value: string | null): string | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

/** URL parametrai → filtras. Netinkamos reikšmės tyliai ignoruojamos. */
export function parseRedagavimuFiltra(params: URLSearchParams): RedagavimuFiltras {
  const busena = params.get('busena');
  const verte = params.get('verte');
  return {
    visi: ['1', 'true'].includes(params.get('visi') ?? ''),
    laukai: params.getAll('laukas').filter(Boolean),
    busena: busena === 'istrinta' || busena === 'atkurta' ? busena : null,
    nuo: data(params.get('nuo')),
    iki: data(params.get('iki')),
    verte: verte === 'padidejo' || verte === 'sumazejo' ? verte : null,
    verteMin: teigiamas(params.get('verteMin')),
  };
}

export function parseRikiavima(params: URLSearchParams): Rikiavimas {
  const reiksme = params.get('rikiavimas');
  return reiksme === 'verte' || reiksme === 'daugiausia' ? reiksme : 'naujausi';
}

/** Filtras → URLSearchParams (be `page` – puslapiavimas jį prideda pats). */
export function filtroParams(filtras: RedagavimuFiltras, rikiavimas: Rikiavimas = 'naujausi'): URLSearchParams {
  const params = new URLSearchParams();
  if (filtras.visi) params.set('visi', '1');
  for (const laukas of filtras.laukai) params.append('laukas', laukas);
  if (filtras.busena) params.set('busena', filtras.busena);
  if (filtras.nuo) params.set('nuo', filtras.nuo);
  if (filtras.iki) params.set('iki', filtras.iki);
  if (filtras.verte) params.set('verte', filtras.verte);
  if (filtras.verteMin) params.set('verteMin', String(filtras.verteMin));
  if (rikiavimas !== 'naujausi') params.set('rikiavimas', rikiavimas);
  return params;
}

/** Nuoroda su pakeista viena filtro reikšme (puslapiavimas atstatomas į 1). */
export function filtroNuoroda(
  filtras: RedagavimuFiltras,
  rikiavimas: Rikiavimas,
  pakeitimai: Partial<RedagavimuFiltras> & { rikiavimas?: Rikiavimas },
): string {
  const { rikiavimas: naujasRikiavimas, ...filtroPakeitimai } = pakeitimai;
  const params = filtroParams(
    { ...filtras, ...filtroPakeitimai },
    naujasRikiavimas ?? rikiavimas,
  );
  const eilute = params.toString();
  return eilute ? `?${eilute}` : '/sutartys/redagavimai';
}

/** Perjungia vieną „kas pasikeitė" lauką (pažymėtą – nuima). */
export function laukoNuoroda(filtras: RedagavimuFiltras, rikiavimas: Rikiavimas, laukas: string): string {
  const laukai = filtras.laukai.includes(laukas)
    ? filtras.laukai.filter((l) => l !== laukas)
    : [...filtras.laukai, laukas];
  return filtroNuoroda(filtras, rikiavimas, { laukai });
}

export function arFiltruota(filtras: RedagavimuFiltras): boolean {
  return JSON.stringify(filtras) !== JSON.stringify(TUSCIAS_FILTRAS);
}

const VERTES_LAUKAS = '_verte';

/**
 * Facetų tvarka. Sujungta „Vertė" viršuje; žali `numatomaVerte`/`faktineVerte`
 * nustumiami žemiau – jie beveik visada kartoja tą patį pokytį, tad matomose
 * aštuoniose eilutėse užimtų vietą skirtingiems laukams. Techninė redagavimo
 * data – paskutinė.
 */
function facetoSvoris(laukas: string): number {
  if (laukas === VERTES_LAUKAS) return 0;
  if (laukas === 'redagavimoData') return 3;
  if (MONEY_FIELDS.has(laukas)) return 2;
  return 1;
}

function facetoLabel(laukas: string): string {
  if (laukas === VERTES_LAUKAS) return 'Vertė (faktinė/numatoma)';
  if (laukas === 'redagavimoData') return 'Redagavimo data (techninė)';
  if (laukas === 'istrinta') return 'Ištrynimas / atkūrimas';
  return FIELD_LABELS[laukas] ?? laukas;
}

/**
 * Užkrauna redaguotų sutarčių puslapį (naujausiai redaguotos viršuje).
 * Filtras taikomas pakeitimų eilutėms: sutartys grupuojamos tik iš tų, kurie
 * jį atitinka, o kortelėje rodomi keli naujausi atitinkantys pakeitimai.
 */
export async function loadRedagavimuSarasas(
  {
    limit = 20,
    skip = 0,
    perSutarti = 3,
    filtras = TUSCIAS_FILTRAS,
    rikiavimas = 'naujausi' as Rikiavimas,
  }: {
    limit?: number;
    skip?: number;
    perSutarti?: number;
    filtras?: RedagavimuFiltras;
    rikiavimas?: Rikiavimas;
  } = {},
): Promise<{
  items: SutartiesRedagavimai[];
  rasta: { sutarciu: number; pakeitimu: number };
  viso: { sutarciu: number; pakeitimu: number };
  facetai: RedagavimuFacetai;
}> {
  const [grupes, rasta, viso, zali] = await Promise.all([
    // Paimame kelis atsargai – dalis pakeitimų gali neturėti matomų skirtumų.
    fetchChangedContractsPage({ limit, skip, perSutarti: perSutarti + 4, filtras, rikiavimas }),
    countChanges(filtras),
    countChanges(TUSCIAS_FILTRAS),
    fetchChangesFacets(filtras),
  ]);

  // Visų puslapio sutarčių pakeitimai – viena užklausa (anksčiau būdavo po
  // vieną kiekvienai sutarčiai).
  const ids = grupes.flatMap((g: any) => g.pakeitimuIds ?? []);
  const eilutes = await fetchChangesByIds(ids);
  const pagalSutarti = new Map<string, SutartiesPakeitimas[]>();
  for (const eilute of eilutes) {
    const pakeitimas = rowToPakeitimas(eilute);
    if (!pakeitimas) continue;
    const raktas = String(eilute.unikalusId);
    pagalSutarti.set(raktas, [...(pagalSutarti.get(raktas) ?? []), pakeitimas]);
  }

  const items = grupes.map((g: any): SutartiesRedagavimai => {
    const visiPakeitimai = pagalSutarti.get(String(g.unikalusId)) ?? [];
    const pakeitimai = visiPakeitimai.slice(0, perSutarti);
    return {
      unikalusId: Number(g.unikalusId),
      pavadinimas: visiPakeitimai[0]?.pavadinimas ?? null,
      perkancioKodas: visiPakeitimai[0]?.perkancioKodas ?? null,
      perkancioPavadinimas: visiPakeitimai[0]?.perkancioPavadinimas ?? null,
      viso: g.viso,
      praleista: Math.max(0, g.viso - pakeitimai.length),
      pakeitimai,
    };
  });

  const laukuKiekiai: Record<string, number> = zali.laukai ?? {};
  const facetai: RedagavimuFacetai = {
    laukai: Object.entries(laukuKiekiai)
      .map(([reiksme, kiek]) => ({ reiksme, label: facetoLabel(reiksme), kiek }))
      .sort((a, b) =>
        facetoSvoris(a.reiksme) - facetoSvoris(b.reiksme) || b.kiek - a.kiek),
    busenos: [
      { reiksme: 'istrinta', label: 'Ištrintos', kiek: zali.istrinta },
      { reiksme: 'atkurta', label: 'Atkurtos', kiek: zali.atkurta },
    ].filter((o) => o.kiek > 0),
    vertesKryptis: [
      { reiksme: 'padidejo', label: 'Vertė padidėjo', kiek: zali.padidejo },
      { reiksme: 'sumazejo', label: 'Vertė sumažėjo', kiek: zali.sumazejo },
    ].filter((o) => o.kiek > 0),
    nereiksmingi: zali.nereiksmingi,
  };

  return { items, rasta, viso, facetai };
}

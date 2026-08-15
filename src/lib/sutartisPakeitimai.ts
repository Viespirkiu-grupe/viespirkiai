import {
  fetchRecentChanges,
  fetchChangedContractsPage,
  countChangedContracts,
  countChanges,
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
    return `${fmtEur(value)} €`;
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

/** Vieną `vpmSutartysChanges` eilutę paverčia matomų skirtumų sąrašu (arba null). */
function rowToPakeitimas(row: any): SutartiesPakeitimas | null {
  if (!row.after) return null;
  const diffs = diffContractDocuments(row.before, row.after);
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
 * Užkrauna vienos sutarties pakeitimų istoriją iš `vpmSutartysChanges`,
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

export type SutartiesRedagavimai = {
  unikalusId: number;
  pavadinimas: string | null;
  perkancioKodas: string | null;
  perkancioPavadinimas: string | null;
  /** Bendras sutarties pakeitimų skaičius `vpmSutartysChanges` lentelėje. */
  viso: number;
  /** Kiek pakeitimų neparodyta (nutraukta ties keliais naujausiais). */
  praleista: number;
  /** Keli naujausi matomi pakeitimai (numatyta – iki 3). */
  pakeitimai: SutartiesPakeitimas[];
};

/**
 * Užkrauna redaguotų sutarčių puslapį (naujausiai redaguotos viršuje).
 * Kiekviena sutartis atskirai su keliais naujausiais pakeitimais; likusieji
 * suskaičiuojami į `praleista` ir pasiekiami sutarties puslapyje.
 */
export async function loadRedagavimuSarasas(
  { limit = 20, skip = 0, perSutarti = 3 }: { limit?: number; skip?: number; perSutarti?: number } = {},
): Promise<{ items: SutartiesRedagavimai[]; visoSutarciu: number; visoRedagavimu: number }> {
  const [grupes, visoSutarciu, visoRedagavimu] = await Promise.all([
    fetchChangedContractsPage({ limit, skip }),
    countChangedContracts(),
    countChanges(),
  ]);

  const items = await Promise.all(
    grupes.map(async (g: any): Promise<SutartiesRedagavimai> => {
      // Paimame kelis atsargai – dalis pakeitimų gali neturėti matomų skirtumų.
      const rows = await fetchRecentChanges({ id: g.unikalusId, limit: perSutarti + 4 } as any);
      const visi: SutartiesPakeitimas[] = rows
        .map((row: any): SutartiesPakeitimas | null => rowToPakeitimas(row))
        .filter((p: SutartiesPakeitimas | null): p is SutartiesPakeitimas => p !== null);
      const pakeitimai = visi.slice(0, perSutarti);
      return {
        unikalusId: g.unikalusId,
        pavadinimas: visi[0]?.pavadinimas ?? null,
        perkancioKodas: visi[0]?.perkancioKodas ?? null,
        perkancioPavadinimas: visi[0]?.perkancioPavadinimas ?? null,
        viso: g.viso,
        praleista: Math.max(0, g.viso - pakeitimai.length),
        pakeitimai,
      };
    }),
  );

  return { items, visoSutarciu, visoRedagavimu };
}

import { TECHNICAL_FIELD_IDS } from '@/modules/ted/viewer.js';

export const PLACE_PERFORMANCE_NODES = new Set([
  'ND-ProcedurePlacePerformance',
  'ND-LotPlacePerformance',
  'ND-PartPlacePerformance',
]);

export interface TedFieldValue {
  fieldId: string;
  name: string;
  type: string;
  values: string[];
  parentNodeId?: string;
}

export interface TedFieldColumn {
  label: string | null;
  pid: string;
  fields: TedFieldValue[];
}

/** Vidiniai eForms kryžminių nuorodų raktai (ORG-0001, RES-0001) – nerodomi. */
export function isTechnical(field: TedFieldValue) {
  return (TECHNICAL_FIELD_IDS as Set<string>).has(field.fieldId);
}

/** Laukai, kurių dar neparodė ranka sudėlioti blokai. */
export function rest(fields: TedFieldValue[] = [], usedIds: string[] = []) {
  const used = new Set(usedIds);
  return fields.filter((field) => !used.has(field.fieldId) && !isTechnical(field));
}

/** Sugrupuoja laukus pagal jų tėvinį eForms mazgą (aliasai sujungia giminingus). */
export function byParent(
  fields: TedFieldValue[] = [],
  parentNodeTitles: Record<string, string> = {},
  parentNodeAliases: Record<string, string> = {},
): TedFieldColumn[] {
  const result: TedFieldColumn[] = [];
  const seen = new Map<string, TedFieldColumn>();
  for (const field of fields) {
    const canonical = parentNodeAliases[field.parentNodeId ?? ''] || field.parentNodeId || '__root__';
    if (!seen.has(canonical)) {
      const column: TedFieldColumn = { label: parentNodeTitles[canonical] || null, pid: canonical, fields: [] };
      seen.set(canonical, column);
      result.push(column);
    }
    seen.get(canonical)!.fields.push(field);
  }
  return result;
}

/** Ilgus blokus skaido, kad vienas stulpelis netaptų nepaprastai aukštas. */
function splitLarge(columns: TedFieldColumn[], max: number): TedFieldColumn[] {
  const out: TedFieldColumn[] = [];
  for (const column of columns) {
    if (column.fields.length <= max) {
      out.push(column);
      continue;
    }
    for (let i = 0; i < column.fields.length; i += max) {
      out.push({ label: i === 0 ? column.label : null, pid: column.pid, fields: column.fields.slice(i, i + max) });
    }
  }
  return out;
}

function blockRows(column: TedFieldColumn) {
  return column.fields.length + (column.label ? 1 : 0);
}

/**
 * Blokas be antraštės vizualiai atrodo kaip prieš jį einančio bloko tęsinys,
 * tad į kitą stulpelį jų atskirti negalima – sulipdome į vieną vienetą.
 */
function mergeUnlabeled(columns: TedFieldColumn[]): TedFieldColumn[] {
  const units: TedFieldColumn[] = [];
  for (const column of columns) {
    const previous = units[units.length - 1];
    const mergeable = previous
      && !column.label
      && !PLACE_PERFORMANCE_NODES.has(column.pid)
      && !PLACE_PERFORMANCE_NODES.has(previous.pid);
    if (mergeable) previous.fields.push(...column.fields);
    else units.push({ ...column, fields: [...column.fields] });
  }
  return units;
}

/**
 * Sudeda tėvinių mazgų blokus į kelis subalansuotus stulpelius. Be to kiekvienas
 * mazgas — net su vienu lauku — užimtų atskirą tinklelio langelį, ir „Kita
 * informacija“ virstų reta vienos eilutės juostų eile.
 */
export function packColumns(
  columns: TedFieldColumn[],
  { maxColumns = 3, rowsPerColumn = 4 } = {},
): TedFieldColumn[][] {
  const blocks = splitLarge(mergeUnlabeled(columns), 8);
  if (!blocks.length) return [];

  const totalRows = blocks.reduce((sum, block) => sum + blockRows(block), 0);
  const count = Math.min(maxColumns, blocks.length, Math.max(1, Math.ceil(totalRows / rowsPerColumn)));
  const target = Math.ceil(totalRows / count);

  const packed: TedFieldColumn[][] = [];
  let current: TedFieldColumn[] = [];
  let rows = 0;
  for (const block of blocks) {
    const size = blockRows(block);
    if (current.length && rows + size > target && packed.length < count - 1) {
      packed.push(current);
      current = [];
      rows = 0;
    }
    current.push(block);
    rows += size;
  }
  if (current.length) packed.push(current);
  return packed;
}


const GROUP_KINDS: Array<[RegExp, string]> = [
  [/-Contract$/, 'Sutartis'],
  [/-Tender$/, 'Pasiūlymas'],
  [/-Tenderer$/, 'Dalyvis'],
  [/-LotResult$/, 'Rezultatas'],
  [/-Organization-Company$/, 'Organizacija'],
];

/** Grupės rūšis pagal laukų galūnę – kitaip antraštė būtų vien techninis ID. */
export function groupKind(group: { fields?: TedFieldValue[] }): string | null {
  for (const [pattern, label] of GROUP_KINDS) {
    if ((group.fields ?? []).some((field) => pattern.test(field.fieldId))) return label;
  }
  return null;
}

export function formatTedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' });
}

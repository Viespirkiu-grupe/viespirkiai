// Kliento pusės lentelių rikiavimas paspaudus ant stulpelio antraštės.
//
// Lentelė pažymima `data-sortable`, rikiuojamos antraštės – `th.sortable`
// (žr. DataTable.astro). Reikšmė imama iš `td[data-sort]` atributo, jei jis
// yra; kitu atveju atpažįstama iš teksto: lt-LT skaičiai („1 234,5"), dydžiai
// („13853.03 GB"), trukmės („2.50 d"), datos („2026-08-16 10:11:12"). Eilutės
// su `data-sort-pin="last"` (pvz. „Iš viso") visada lieka apačioje.
//
// Klausomasi delegavimu ant <thead>, tad tbody galima laisvai perpiešti (SSE) –
// tereikia po perpiešimo iškviesti `refreshSortableTables()`, kad rikiavimas
// būtų pritaikytas naujoms eilutėms.

type Direction = 'asc' | 'desc';
type SortState = { index: number; dir: Direction } | null;

const states = new WeakMap<HTMLTableElement, SortState>();

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024, kib: 1024,
  mb: 1024 ** 2, mib: 1024 ** 2,
  gb: 1024 ** 3, gib: 1024 ** 3,
  tb: 1024 ** 4, tib: 1024 ** 4,
  pb: 1024 ** 5, pib: 1024 ** 5,
};

const TIME_UNITS: Record<string, number> = {
  s: 1, min: 60, h: 3600, d: 86400,
};

const collator = new Intl.Collator('lt', { numeric: true, sensitivity: 'base' });

// „1 234,5" / „13853.03" → 1234.5 / 13853.03. Tarpai (įskaitant nedalomąjį) –
// tūkstančių skirtukai; dešimtainis skirtukas – dešiniausias , arba .
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, '');
  if (!/^[-+]?[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const normalized = lastSep === -1
    ? cleaned
    : cleaned.slice(0, lastSep).replace(/[.,]/g, '') + '.' + cleaned.slice(lastSep + 1);
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Grąžina skaičių (rikiuojama skaitiškai) arba tekstą (rikiuojama kolatoriumi).
// null – tuščia reikšmė, visada keliauja į pabaigą.
function parseValue(raw: string, type: string | undefined): number | string | null {
  const text = raw.trim();
  if (text === '' || text === '—' || text === '-') return null;
  if (type === 'text') return text;

  if (type === 'date' || /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T'));
    if (Number.isFinite(ms)) return ms;
  }

  const match = text.match(/^([-+]?[\d\s  .,]+)\s*([a-zA-Zµ%]*)$/);
  if (match) {
    const value = parseNumber(match[1]);
    if (value !== null) {
      const unit = match[2].toLowerCase();
      const factor = BYTE_UNITS[unit] ?? TIME_UNITS[unit] ?? 1;
      return value * factor;
    }
  }

  return type === 'number' ? null : text;
}

function cellValue(row: HTMLTableRowElement, index: number, type: string | undefined) {
  const cell = row.cells[index];
  if (!cell) return null;
  const explicit = cell.dataset.sort;
  if (explicit !== undefined) {
    const asNumber = Number(explicit);
    return explicit !== '' && Number.isFinite(asNumber) ? asNumber : (explicit || null);
  }
  return parseValue(cell.textContent ?? '', type);
}

function compare(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // tuščios – visada gale
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

function applySort(table: HTMLTableElement) {
  const state = states.get(table) ?? null;
  const headers = [...table.querySelectorAll<HTMLTableCellElement>('thead th')];
  headers.forEach((th, i) => {
    const active = !!state && state.index === i;
    th.classList.toggle('asc', active && state!.dir === 'asc');
    th.classList.toggle('desc', active && state!.dir === 'desc');
    if (th.classList.contains('sortable')) {
      th.setAttribute('aria-sort', active ? (state!.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  });

  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = [...tbody.rows];
  // Tuščios būsenos eilutė (colspan) – nerikiuojame.
  if (rows.length < 2 || rows.some((r) => r.cells.length === 1 && r.cells[0].colSpan > 1)) return;

  const pinned = rows.filter((r) => r.dataset.sortPin === 'last');
  const sortable = rows.filter((r) => r.dataset.sortPin !== 'last');

  if (state) {
    const type = headers[state.index]?.dataset.sortType;
    const sign = state.dir === 'asc' ? 1 : -1;
    const keyed = sortable.map((row, i) => ({ row, i, key: cellValue(row, state.index, type) }));
    // Stabilumas: lygias reikšmes paliekame pradine tvarka.
    keyed.sort((a, b) => compare(a.key, b.key) * sign || a.i - b.i);
    for (const { row } of keyed) tbody.appendChild(row);
  }
  for (const row of pinned) tbody.appendChild(row);
}

/** Perrikiuoja lenteles pagal jau pasirinktą stulpelį (po tbody perpiešimo). */
export function refreshSortableTables(root: ParentNode = document) {
  root.querySelectorAll<HTMLTableElement>('table[data-sortable]').forEach((table) => {
    if (states.get(table)) applySort(table);
  });
}

export function initSortableTables(root: ParentNode = document) {
  root.querySelectorAll<HTMLTableElement>('table[data-sortable]').forEach((table) => {
    if (table.dataset.sortableReady) return;
    table.dataset.sortableReady = '1';

    const thead = table.tHead;
    if (!thead) return;
    for (const th of thead.querySelectorAll<HTMLTableCellElement>('th.sortable')) {
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'button');
      th.setAttribute('aria-sort', 'none');
    }

    const toggle = (th: HTMLTableCellElement) => {
      const index = th.cellIndex;
      const current = states.get(table) ?? null;
      // Pirmas paspaudimas – didėjančiai, tolesni ant to paties stulpelio verčia kryptį.
      const next: SortState = current && current.index === index
        ? { index, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { index, dir: 'asc' };
      states.set(table, next);
      applySort(table);
    };

    thead.addEventListener('click', (event) => {
      const th = (event.target as HTMLElement).closest('th.sortable');
      if (th && thead.contains(th)) toggle(th as HTMLTableCellElement);
    });

    thead.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const th = (event.target as HTMLElement).closest('th.sortable');
      if (!th || !thead.contains(th)) return;
      event.preventDefault();
      toggle(th as HTMLTableCellElement);
    });
  });
}

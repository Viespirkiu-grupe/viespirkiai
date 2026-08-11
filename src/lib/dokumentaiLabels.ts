// Shared label maps and option lists for the /dokumentai page and its
// components. Unknown values fall back to the raw key at the call site.

export const LANG_LABEL: Record<string, string> = {
  lt: 'Lietuvių', en: 'Anglų', ru: 'Rusų', de: 'Vokiečių', fr: 'Prancūzų',
  pl: 'Lenkų', lv: 'Latvių', et: 'Estų', uk: 'Ukrainiečių',
};

export const SOURCE_LABEL: Record<string, string> = {
  sutartys: 'Sutartys',
  archive: 'Archyvas',
  cvpp: 'CVPP',
  cvpis: 'CVP IS',
  mvpaprasai: 'MVP tvarkos',
  neskelbiamosderybos: 'Neskelbiamos derybos',
  liteko: 'LITEKO',
  liteko2: 'LITEKO2',
  eseimas: 'e-Seimas',
};

// Klasė = plati dokumento sritis (viešieji pirkimai vs teisė).
export const CLASS_LABEL: Record<string, string> = {
  viesiejiPirkimai: 'Viešieji pirkimai',
  teise: 'Teisė',
  teisekura: 'Teisėkūra',
};

export const CLASS_OPTS = [
  { value: 'viesiejiPirkimai', label: 'Viešieji pirkimai' },
  { value: 'teise', label: 'Teisė' },
  { value: 'teisekura', label: 'Teisėkūra' },
];

export const TIPAS_OPTS = [
  { value: 'crawledPage', label: 'Tinklalapis' },
  { value: 'failas', label: 'Failas' },
  { value: 'teisesAktas', label: 'Teisės aktas' },
  { value: 'teisesAktoProjektas', label: 'Teisės akto projektas' },
  { value: 'teismoNuosprendis', label: 'Teismo nuosprendis' },
];

// Vienaskaita rezultatų/filtrų kortelėse (skiriasi nuo statistikos skydelio,
// kuris rodo daugiskaitą).
export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TIPAS_OPTS.map((o) => [o.value, o.label]),
);

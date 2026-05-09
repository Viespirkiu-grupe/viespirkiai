/**
 * Enum-style option lists for the failai (files) section.
 *
 * Mirrors the pattern of `modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js`:
 * single source of truth for the filter dropdown values used both by
 * `FailaiFilters.astro` and any future code that needs to render or
 * validate these labels.
 */

export interface SaltinisOption {
  value: string;
  label: string;
}

/**
 * The `saltinis` (source) filter shows where the document originated.
 * Order matters: it controls the order shown in the filter dropdown.
 */
export const SALTINIS_OPTIONS: SaltinisOption[] = [
  { value: 'sutartys', label: 'Sutartys' },
  { value: 'neskelbiamosDerybos', label: 'Neskelbiamos derybos' },
  { value: 'cvpIs', label: 'Viešieji pirkimai' },
  { value: 'cvpp', label: 'CVPP viešieji pirkimai' },
  { value: 'mvpAprasai', label: 'MVP tvarkos aprašai' },
  { value: 'archive', label: 'Failas archyvo viduje' },
];

// The /dokumentai sidebar's facet catalog: turns the search result's facets into
// a declarative list of sections grouped by where they show. DokFilters just
// maps the result onto DokFacetSection — this module holds the "which facets,
// what labels, what overflow" config so the component stays thin.
import type { DokFacet } from './dokumentaiUrl.ts';
import { CLASS_OPTS, CLASS_LABEL, TIPAS_OPTS, TYPE_LABEL, SOURCE_LABEL, LANG_LABEL, DOKUMENTAI_PARAM_LABELS } from './dokumentaiLabels.ts';
import { eurovocLabel, statusasLabel, turinysLabel, variantasLabel } from './teisesAktaiLabels.ts';

/** The data DokFilters receives (built by loadDokumentaiPage). */
export interface FiltersData {
  activeFilterCount: number;
  hasFilters: boolean;
  clearUrl: string;
  classCountMap: Record<string, number>;
  classFilter: string[];
  classToggleUrl: (value: string) => string;
  typeCountMap: Record<string, number>;
  typeFilter: string[];
  typeToggleUrl: (value: string) => string;
  showVerdictFacets: boolean;
  showTeisekuraFacets: boolean;
  court: DokFacet;
  caseType: DokFacet;
  category: DokFacet;
  judge: DokFacet;
  actType: DokFacet;
  validity: DokFacet;
  editionType: DokFacet;
  projectStatus: DokFacet;
  eurovoc: DokFacet;
  adoptedBy: DokFacet;
  contentState: DokFacet;
  institutionNumber: string | null;
  registrationNumber: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  source: DokFacet;
  istaiga: DokFacet;
  host: DokFacet;
  jar: DokFacet;
  ext: DokFacet;
  author: DokFacet;
  creator: DokFacet;
  producer: DokFacet;
  lang: DokFacet;
  sav: DokFacet;
  apskritis: DokFacet;
  metaiFilter: string[];
  metaiToggleUrl: (value: string) => string;
  bbox: unknown;
  areaClearUrl: string;
}

/** Props passed straight to DokFacetSection. */
export interface FacetSectionProps {
  label: string;
  param: string;
  facet: DokFacet;
  allLabel?: string;
  alwaysAll?: boolean;
  formatLabel?: (value: string) => string;
  stacked?: boolean;
  modal?: { field: string; title: string; always?: boolean };
  addForm?: { id: string; inputId: string; placeholder: string; ariaLabel: string };
}

type Group = 'top' | 'verdict' | 'teisekura' | 'mid' | 'other' | 'geo';
// `label` praleidžiama — jį pagal `param` užpildo DOKUMENTAI_PARAM_LABELS, kad ta
// pati lietuviška etiketė negyventų ir čia, ir OG antraštėse.
type Section = Omit<FacetSectionProps, 'label'> & { group: Group; when?: boolean; label?: string };

// A facet appears once it has options or an active selection.
const any = (f: DokFacet) => f.visible.length > 0 || f.filter.length > 0;

export function buildFilterSections(p: FiltersData): Record<Group, FacetSectionProps[]> {
  // Class / Type / Metai read from a count map or the selection (not the facet
  // aggregation), so wrap them as DokFacets here.
  const classFacet: DokFacet = {
    filter: p.classFilter,
    visible: CLASS_OPTS
      .filter((o) => p.classCountMap[o.value] != null || p.classFilter.includes(o.value))
      .map((o) => ({ value: o.value, count: p.classCountMap[o.value] ?? null })),
    toggleUrl: p.classToggleUrl,
  };
  const typeFacet: DokFacet = {
    filter: p.typeFilter,
    visible: TIPAS_OPTS
      .filter((o) => p.typeCountMap[o.value] != null || p.typeFilter.includes(o.value))
      .map((o) => ({ value: o.value, count: p.typeCountMap[o.value] ?? null })),
    toggleUrl: p.typeToggleUrl,
  };
  const metaiFacet: DokFacet = {
    filter: p.metaiFilter,
    visible: [...p.metaiFilter].sort().map((year) => ({ value: year, count: null })),
    toggleUrl: p.metaiToggleUrl,
  };

  const classLabel = (v: string) => CLASS_LABEL[v] || v;
  const typeLabel = (v: string) => TYPE_LABEL[v] || v;
  const sourceLabel = (v: string) => SOURCE_LABEL[v.toLowerCase()] || v;
  const langLabel = (v: string) => LANG_LABEL[v] || v.toUpperCase();
  const stripWww = (v: string) => v.replace(/^www\./, '');
  const extLabel = (v: string) => `.${v}`;

  const sections: Section[] = [
    // Top: broad document class + type (from count maps; always visible).
    { group: 'top', when: Object.keys(p.classCountMap).length > 0 || p.classFilter.length > 0, param: 'klase', facet: classFacet, allLabel: 'Visos', alwaysAll: true, formatLabel: classLabel },
    { group: 'top', param: 'type', facet: typeFacet, allLabel: 'Visi', alwaysAll: true, formatLabel: typeLabel },

    // Teismų nuosprendžiai (rodoma tik su „teise" klase / aktyviu filtru).
    { group: 'verdict', param: 'teismas', facet: p.court, allLabel: 'Visi', modal: { field: 'metadata.teismas', title: 'Teismas' } },
    { group: 'verdict', when: any(p.caseType), param: 'bylosRusis', facet: p.caseType, allLabel: 'Visos' },
    { group: 'verdict', param: 'kategorija', facet: p.category, allLabel: 'Visos', modal: { field: 'metadata.kategorijos', title: 'Kategorija' } },
    { group: 'verdict', param: 'teisejas', facet: p.judge, allLabel: 'Visi', modal: { field: 'metadata.teisejai', title: 'Teisėjas' } },

    // Teisėkūra (rodoma tik su „teisekura" klase / aktyviu filtru).
    { group: 'teisekura', when: any(p.actType), param: 'aktoRusis', facet: p.actType, modal: { field: 'metadata.rusis', title: 'Teisės akto rūšis' } },
    { group: 'teisekura', when: any(p.validity), param: 'galiojimas', facet: p.validity, formatLabel: statusasLabel },
    { group: 'teisekura', when: any(p.editionType), param: 'redakcija', facet: p.editionType, formatLabel: variantasLabel },
    { group: 'teisekura', when: any(p.projectStatus), param: 'projektoBusena', facet: p.projectStatus, modal: { field: 'metadata.busena', title: 'Projekto būsena' } },
    { group: 'teisekura', when: any(p.eurovoc), param: 'eurovoc', facet: p.eurovoc, formatLabel: eurovocLabel, modal: { field: 'metadata.eurovocTerminai', title: 'Eurovoc' } },
    { group: 'teisekura', when: any(p.adoptedBy), param: 'prieme', facet: p.adoptedBy, modal: { field: 'metadata.prieme', title: 'Priėmė' } },
    { group: 'teisekura', when: any(p.contentState), param: 'turinys', facet: p.contentState, formatLabel: turinysLabel },

    // Middle: source, agency, site, person, extension.
    { group: 'mid', when: any(p.source), param: 'source', facet: p.source, allLabel: 'Visi', formatLabel: sourceLabel },
    { group: 'mid', when: any(p.istaiga), param: 'istaiga', facet: p.istaiga, allLabel: 'Visos', stacked: true, modal: { field: 'istaigaJar', title: 'Paskelbusi įstaiga' } },
    { group: 'mid', param: 'host', facet: p.host, allLabel: 'Visi', formatLabel: stripWww, addForm: { id: 'dok-host-form', inputId: 'dok-host-input', placeholder: 'pvz. vpt.lrv.lt', ariaLabel: 'Įvesti svetainę' } },
    { group: 'mid', param: 'jar', facet: p.jar, allLabel: 'Visi', stacked: true, modal: { field: 'jarKodai', title: 'Asmuo (JAR)', always: true }, addForm: { id: 'dok-jar-form', inputId: 'dok-jar-input', placeholder: 'pvz. 123456789', ariaLabel: 'Įvesti JAR kodą' } },
    { group: 'mid', param: 'ext', facet: p.ext, allLabel: 'Visi', formatLabel: extLabel, modal: { field: 'extension', title: 'Plėtinys' } },

    // "Kiti filtrai" (collapsible): PDF metadata authors.
    { group: 'other', param: 'author', facet: p.author, allLabel: 'Visi', modal: { field: 'author', title: 'Autorius' } },
    { group: 'other', param: 'creator', facet: p.creator, allLabel: 'Visi', modal: { field: 'metadata.creator', title: 'Creator' } },
    { group: 'other', param: 'producer', facet: p.producer, allLabel: 'Visi', modal: { field: 'metadata.producer', title: 'Producer' } },

    // Geo + time.
    { group: 'geo', when: any(p.lang), param: 'lang', facet: p.lang, allLabel: 'Visi', formatLabel: langLabel },
    { group: 'geo', when: any(p.sav), param: 'sav', facet: p.sav, allLabel: 'Visi' },
    { group: 'geo', when: any(p.apskritis), param: 'apskritis', facet: p.apskritis, allLabel: 'Visi' },
    { group: 'geo', when: p.metaiFilter.length > 0, param: 'metai', facet: metaiFacet, allLabel: 'Visi' },
  ];

  const groups = { top: [], verdict: [], teisekura: [], mid: [], other: [], geo: [] } as Record<Group, FacetSectionProps[]>;
  for (const { group, when, label, ...props } of sections) {
    if (when ?? true) {
      groups[group].push({ ...props, label: label ?? DOKUMENTAI_PARAM_LABELS[props.param] ?? props.param });
    }
  }
  return groups;
}

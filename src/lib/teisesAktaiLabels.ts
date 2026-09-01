// Žmogui skirti e-TAR reikšmių pavadinimai dokumentų paieškai ir akto detalei.
//
// Modulis sąmoningai neturi serverinių priklausomybių, nes dalį funkcijų naudoja
// ir naršyklėje atvaizduojami dokumentų filtrai.
//
// Visos šios funkcijos keičia TIK atvaizdavimą — reikšmė URL'e ir Quickwit
// užklausoje lieka tokia, kokia yra indekse.

/** Dokumento variantas: originalas ar suvestinė redakcija. */
export const VARIANTAS_LABEL: Record<string, string> = {
  original: 'Originalus aktas',
  consolidated_edition: 'Galiojanti suvestinė',
  historical_consolidated_edition: 'Istorinė suvestinė',
};

export const TURINYS_LABEL: Record<string, string> = {
  provided: 'Tekstas yra',
  preview_unavailable_source: 'Peržiūra neprieinama',
  not_available_source: 'Teksto registre nėra',
};

/**
 * Būsenos, kai teksto nėra ne dėl mūsų — e-TAR arba nerodo HTML peržiūros
 * (`preview_unavailable_source`), arba iš viso neturi akto teksto
 * (`not_available_source`). Abiem atvejais tuščias tekstas yra galutinis
 * atsakymas, o ne „dar nenuskaityta", tad UI turi sakyti skirtingus dalykus.
 */
const BE_TEKSTO: ReadonlySet<string> = new Set([
  'preview_unavailable_source',
  'not_available_source',
]);

export const beTeksto = (v: string | null | undefined) => !!v && BE_TEKSTO.has(v);

/** Numatytoji žinutė, kai adapteris savo `message` nepateikia. */
export function beTekstoZinute(v: string | null | undefined): string {
  return v === 'not_available_source'
    ? 'e-TAR neturi šio akto teksto.'
    : 'e-TAR nepateikia teksto peržiūros šiam aktui.';
}

/**
 * Būsenos šaltinyje rašomos nevienodai („Galioja", bet „NEGALIOJA") — ekrane
 * vienodinam į vieną didžiąją raidę pradžioje.
 */
export function statusasLabel(value: string): string {
  if (!value) return value;
  const lower = value.toLocaleLowerCase('lt');
  return lower.charAt(0).toLocaleUpperCase('lt') + lower.slice(1);
}

/**
 * EUROVOC terminai ateina su srities numeriu ir mažąja raide („0436 vykdomoji
 * valdžia ir valstybės tarnyba"). Numeris naudotojui nieko nesako — nuimam, o
 * likutį pradedam didžiąja, kad sąrašas atrodytų kaip sakinys, ne kaip raktažodis.
 */
export function eurovocLabel(value: string): string {
  const term = value.replace(/^\d{4}\s+/, '').trim();
  if (!term) return term;
  return term.charAt(0).toLocaleUpperCase('lt') + term.slice(1);
}

export const variantasLabel = (v: string) => VARIANTAS_LABEL[v] ?? v;
export const turinysLabel = (v: string) => TURINYS_LABEL[v] ?? v;

/**
 * e-TAR informacinės lentelės laukai — uždaras 14 raktų rinkinys
 * ("eTar"."metadataFieldKey"). Tvarka čia = tvarka akto puslapyje.
 */
export const METADATA_FIELD_LABEL: Record<string, string> = {
  act_type: 'Rūšis',
  adopted_at: 'Priėmimo data',
  adopted_by: 'Priėmė',
  institution_number: 'Įstaigos suteiktas nr.',
  registration_details: 'Registracijos data ir nr.',
  published: 'Paskelbta',
  eli: 'ELI',
  current_consolidated_edition: 'Galiojanti suvestinė redakcija',
  consolidated_editions_by_date: 'Suvestinės redakcijos pagal datą',
  amendment_projects: 'Pakeitimų projektai',
  ex_post_evaluation: 'Ex post vertinimas',
  eu_legal_act_links: 'Susiję ES teisės aktai',
  corrections: 'Klaidų ištaisymai',
  eurovoc_terms: 'EUROVOC terminai',
};

/** „Susijusi informacija" skiltys ("eTar"."relatedSectionType"). */
export const RELATED_SECTION_LABEL: Record<string, string> = {
  attachments: 'Priedai',
  consolidated_edition_attachments: 'Suvestinės redakcijos priedai',
  added_documents: 'Pridėti dokumentai',
  scanned_originals: 'Skenuoti originalai',
  legal_act_amendments: 'Teisės akto pakeitimai',
  changed_document: 'Pakeistas dokumentas',
  invalid_de_jure: 'Negalioja de jure',
  suspended_by_court: 'Sustabdyta teismo',
  temporarily_suspended: 'Laikinai sustabdyta',
  suspension_restored: 'Galiojimas atkurtas',
  related_documents: 'Susiję dokumentai',
  ex_post_evaluation: 'Ex post vertinimas',
  ex_post_evaluated_legal_acts: 'Ex post vertinti teisės aktai',
};

/**
 * Ryšio tipas tarp aktų ("eTar"."relationType"). Šaltinis duoda techninius kodus
 * (`amending_change`), o ekrane turi būti žmogaus kalba. Nežinomą kodą
 * paverčiam į skaitomą sakinį, kad naujas e-TAR tipas nesugadintų puslapio.
 */
export const RELATION_TYPE_LABEL: Record<string, string> = {
  amending_change: 'Pakeitimas',
  related_document: 'Susijęs dokumentas',
  changed_document: 'Pakeistas dokumentas',
  invalid_de_jure: 'Negalioja de jure',
  suspended_by_court: 'Sustabdyta teismo',
  temporarily_suspended: 'Laikinai sustabdyta',
  suspension_restored: 'Galiojimas atkurtas',
  ex_post_evaluation: 'Ex post vertinimas',
};

export function relationTypeLabel(value: string): string {
  if (!value) return '';
  const known = RELATION_TYPE_LABEL[value];
  if (known) return known;
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toLocaleUpperCase('lt') + words.slice(1);
}

/** Facetės parametras → jos reikšmių formatavimas (juostoje ir modale vienodas). */
export const LABEL_BY_PARAM: Record<string, (value: string) => string> = {
  statusas: statusasLabel,
  variantas: variantasLabel,
  turinys: turinysLabel,
  eurovoc: eurovocLabel,
};

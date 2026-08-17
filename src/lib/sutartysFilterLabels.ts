// Žmogui skirti sutarčių paieškos (/) filtrų parametrų pavadinimai.
//
// Modulis sąmoningai be jokių priklausomybių: jį naudoja ir XLSX eksporto
// metaduomenų lapas, ir OG antraščių generavimas (searchOgMeta.ts), kuris
// vykdomas middleware'e — be DB ir be paieškos sluoksnio.
//
// Raktai atitinka `modules/sutartys/search/filter.js` `fields[].key`.

export const SUTARTYS_FILTER_LABELS: Record<string, string> = {
  search: 'Paieška',
  perkanciosiosOrganizacijosKodas: 'Pirkėjo kodas',
  tiekejoKodas: 'Tiekėjo kodas',
  sutartiesNumeris: 'Sutarties numeris',
  pirkimoNumeris: 'Pirkimo numeris',
  sutartiesUnikalusID: 'Sutarties ID',
  tipas: 'Sutarties tipas',
  kategorija: 'Kategorija',
  sudarymoDataNuo: 'Sudaryta nuo',
  sudarymoDataIki: 'Sudaryta iki',
  verteNuo: 'Numatoma vertė nuo',
  verteIki: 'Numatoma vertė iki',
  sumaNuo: 'Suma nuo',
  sumaIki: 'Suma iki',
  bvpzPrefiksas: 'BVPŽ kodas',
  bvpzPrefiksasKitas: 'BVPŽ kodas',
  tikSuDokumentais: 'Tik su dokumentais',
  ignoruotiSp: 'Be pakeitimų',
  sort: 'Rikiavimas',
  sortDir: 'Rikiavimo kryptis',
  dir: 'Rikiavimo kryptis',
};

/**
 * „Pirkėjo kodas: 111950679; Suma nuo: 100000" — filtrų sąrašas XLSX eksporto
 * metaduomenų lapui. Nežinomi parametrai rodomi žaliu raktu, kad eksporte
 * nepasimestų.
 */
export function sutartysFilterSummary(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => `${SUTARTYS_FILTER_LABELS[key] ?? key}: ${value}`)
    .join('; ');
}

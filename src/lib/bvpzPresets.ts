// Bendri BVPŽ „greiti pasirinkimai" — vienas sąrašas visiems puslapiams
// (/bvpz, BVPŽ dialogas sutartyse ir viešuosiuose pirkimuose, prefikso laukas).
export interface BvpzPreset {
  label: string;
  codes: string;
}

export const BVPZ_PRESETS: BvpzPreset[] = [
  { label: 'Informacinės technologijos', codes: '48 72' },
  { label: 'Vaistai', codes: '3360 3361 3362 3363 3364 3365 3366 3367 33690 33691' },
  { label: 'Draudimas', codes: '665 667' },
  { label: 'Draudimo brokeriai', codes: '66518' },
];

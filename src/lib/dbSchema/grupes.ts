import type { Grupe } from './tipai.ts';

/**
 * Lentelės priskyrimas grupei.
 *
 * Tvarka: (1) rankinis įrašas `dba."lenteles".grupeId`; (2) ilgiausias
 * sutampantis prefiksas iš `dba."grupiuTaisykles"`; (3) lygiaverčiams –
 * didesnis `prioritetas`; (4) nieko – pseudo-grupė „Nesugrupuota“.
 *
 * Logika laikoma JS pusėje (ne SQL'e), kad būtų padengiama testais.
 */

export const NESUGRUPUOTA_RAKTAS = 'nesugrupuota';

export interface Taisykle {
  prefiksas: string;
  grupesRaktas: string;
  /** true – po prefikso privalo eiti didžioji raidė arba skaitmuo. */
  grieztaRiba: boolean;
  prioritetas: number;
}

/**
 * camelCase šeimos riba. Be jos trumpas prefiksas kaip `jar` gaudytų bet kokį
 * vardą, kuris atsitiktinai prasideda tomis pačiomis raidėmis.
 * `xlsxPPAataskaitos` yra išimtis – tokioms taisyklėms `grieztaRiba = false`.
 */
function arSutampa(vardas: string, taisykle: Taisykle): boolean {
  if (vardas === taisykle.prefiksas) return true;
  if (!vardas.startsWith(taisykle.prefiksas)) return false;
  if (!taisykle.grieztaRiba) return true;

  const kitas = vardas.charAt(taisykle.prefiksas.length);
  return kitas === kitas.toUpperCase() && kitas !== kitas.toLowerCase()
    || /[0-9]/.test(kitas);
}

/**
 * Randa grupės raktą pagal prefiksų taisykles. `null`, jei nė viena netinka.
 */
export function grupeIsTaisykliu(vardas: string, taisykles: Taisykle[]): string | null {
  let geriausia: Taisykle | null = null;

  for (const taisykle of taisykles) {
    if (!arSutampa(vardas, taisykle)) continue;
    if (
      geriausia === null
      || taisykle.prefiksas.length > geriausia.prefiksas.length
      || (taisykle.prefiksas.length === geriausia.prefiksas.length
        && taisykle.prioritetas > geriausia.prioritetas)
    ) {
      geriausia = taisykle;
    }
  }

  return geriausia?.grupesRaktas ?? null;
}

/** Pseudo-grupė lentelėms, kurioms taisyklė netiko. Rodoma su TODO ženklu. */
export const NESUGRUPUOTA: Grupe = {
  raktas: NESUGRUPUOTA_RAKTAS,
  pavadinimas: 'Nesugrupuota',
  aprasymas: 'Lentelės, kurioms dar nepriskirta grupė.',
  saltinis: null,
  saltinioUrl: null,
  tvarka: 999,
};

/**
 * Galutinis priskyrimas: rankinis įrašas nugali taisyklę.
 *
 * @returns grupė ir ar ji priskirta rankomis
 */
export function priskirtiGrupe(
  vardas: string,
  rankinisRaktas: string | null,
  taisykles: Taisykle[],
  grupes: Map<string, Grupe>,
): { grupe: Grupe; rankomis: boolean } {
  if (rankinisRaktas) {
    const grupe = grupes.get(rankinisRaktas);
    if (grupe) return { grupe, rankomis: true };
  }

  const raktas = grupeIsTaisykliu(vardas, taisykles);
  const grupe = raktas ? grupes.get(raktas) : undefined;

  return grupe ? { grupe, rankomis: false } : { grupe: NESUGRUPUOTA, rankomis: false };
}

/** Kanoninis lentelės adresas. `public` schema URL'e praleidžiama. */
export function lentelesUrl(grupesRaktas: string, schema: string, vardas: string): string {
  const priesdelis = schema === 'public' ? '' : `${schema}.`;
  return `/duomenys/lenteles/${grupesRaktas}/${priesdelis}${vardas}`;
}

export function grupesUrl(grupesRaktas: string): string {
  return `/duomenys/lenteles/${grupesRaktas}`;
}

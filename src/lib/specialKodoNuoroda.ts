import { specialJarCodes } from '@/modules/juridiniai/specialJarCodes.js';

/**
 * 801–809 nėra realūs JAR kodai, o bendriniai CVP IS kodai (pilietis, ūkininkas,
 * užsienio įmonė ir pan.), kuriuos dalijasi visi tokio tipo tiekėjai. Nuoroda į
 * /asmuo/809 rodytų puslapį apie kodą, o ne apie tą konkretų asmenį, kurio
 * pavadinimą vartotojas ką tik matė. Todėl vietoj to vedame į sutarčių paiešką
 * su įrašytu pavadinimu — vardas čia yra vienintelis realus identifikatorius.
 */
export function arSpecialusKodas(kodas?: string | number | null): boolean {
  if (kodas == null || kodas === '') return false;
  return Object.hasOwn(specialJarCodes, String(Number(kodas)));
}

/**
 * Paieškos nuoroda konkrečiam 8xx tiekėjui pagal pavadinimą.
 * Grąžina null, kai kodas nespecialus arba pavadinimo nėra — tada tinka įprasta
 * /asmuo/{kodas} nuoroda.
 */
export function specialKodoPaieskosNuoroda(
  kodas?: string | number | null,
  pavadinimas?: string | number | null,
): string | null {
  if (!arSpecialusKodas(kodas)) return null;
  const vardas = String(pavadinimas ?? '').trim();
  if (!vardas) return null;
  return `/?${new URLSearchParams({
    search: vardas,
    tiekejoKodas: String(kodas),
  })}`;
}

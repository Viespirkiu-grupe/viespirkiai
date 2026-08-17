// „Teisinis statusas neįregistruotas“ reiškia, kad jokio ypatingo statuso
// (bankroto, likvidavimo ir pan.) nėra — tai normali būsena, kurios vartotojui
// rodyti nereikia. JAR CSV šį pavadinimą pateikia sutrumpintai, o RC atvirų
// duomenų rinkiniai (FA, JADIS) — pilnai, todėl tikriname abu variantus.
const AKTYVUS_STATUSAS = new Set([
  'Teisinis stat neįregistruotas',
  'Teisinis statusas neįregistruotas',
]);

export function arAktyvusStatusas(statusoPavadinimas?: string | null): boolean {
  return !statusoPavadinimas || AKTYVUS_STATUSAS.has(statusoPavadinimas);
}

/** Grąžina statusą, kurį verta parodyti, arba `null`, jei statusas įprastas. */
export function rodomasStatusas(statusoPavadinimas?: string | null): string | null {
  return arAktyvusStatusas(statusoPavadinimas) ? null : statusoPavadinimas ?? null;
}

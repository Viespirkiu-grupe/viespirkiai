import { postgres } from '@/postgres/postgres.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';

export interface SutartisPanel {
  id: string;
  pavadinimas: string | null;
  tipas: string | null;
  tipoPavadinimas: string | null;
  sutartiesNumeris: string | null;
  pirkimoNumeris: string | null;
  pirkejas: string | null;
  pirkejoKodas: string | null;
  tiekejas: string | null;
  tiekejoKodas: string | null;
  verte: number | null;
  faktineVerte: number | null;
  sudarymoData: string | null;
  galiojimoData: string | null;
  bvpzKodas: string | null;
  bvpzPavadinimas: string | null;
  dokumentuKiekis: number | null;
}

export async function findSutartisPanel(q: string): Promise<SutartisPanel | null> {
  const id = q.trim();
  if (!/^\d+$/.test(id)) return null;

  try {
    const { rows } = await postgres.query(
      `SELECT
         "sutartiesUnikalusId"::text AS id,
         pavadinimas,
         tipas,
         "sutartiesNumeris",
         "pirkimoNumeris",
         "perkanciojiOrganizacija" AS pirkejas,
         "perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
         tiekejas,
         "tiekejoKodas",
         verte,
         "faktineIvykdimoVerte" AS "faktineVerte",
         "sudarymoData",
         "galiojimoData",
         "bvpzKodas",
         "bvpzPavadinimas",
         "dokumentuKiekis"
       FROM public.sutartys
       WHERE "sutartiesUnikalusId" = $1
         AND NOT COALESCE(istrinta, false)
       LIMIT 1`,
      [id],
    );
    if (rows.length !== 1) return null;

    const item = rows[0];
    const tipas = item.tipas ? String(item.tipas).trim().toUpperCase() : null;
    return {
      id: String(item.id),
      pavadinimas: item.pavadinimas ?? null,
      tipas,
      tipoPavadinimas: tipas ? (CONTRACT_TYPES as Record<string, string>)[tipas] ?? tipas : null,
      sutartiesNumeris: item.sutartiesNumeris ?? null,
      pirkimoNumeris: item.pirkimoNumeris ?? null,
      pirkejas: item.pirkejas ?? null,
      pirkejoKodas: item.pirkejoKodas ?? null,
      tiekejas: item.tiekejas ?? null,
      tiekejoKodas: item.tiekejoKodas ?? null,
      verte: item.verte != null ? Number(item.verte) : null,
      faktineVerte: item.faktineVerte != null ? Number(item.faktineVerte) : null,
      sudarymoData: item.sudarymoData ? String(item.sudarymoData).slice(0, 10) : null,
      galiojimoData: item.galiojimoData ? String(item.galiojimoData).slice(0, 10) : null,
      bvpzKodas: item.bvpzKodas ?? null,
      bvpzPavadinimas: item.bvpzPavadinimas ?? null,
      dokumentuKiekis: item.dokumentuKiekis != null ? Number(item.dokumentuKiekis) : null,
    };
  } catch {
    return null;
  }
}

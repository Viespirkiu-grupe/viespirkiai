import { JAR_LOCATION_JOINS, JAR_LOCATION_SQL } from '@/modules/juridiniai/jarReadSql.js';
import { searchJar } from '@/modules/juridiniai/search.js';
import { gautiSodrosDuomenis } from '@/modules/sodra/sodraDuomenys.js';
import { gautiSutarciuDuomenisPagalJarKoda } from '@/modules/sutartys/pagalJarKoda.js';
import { gautiVmiDuomenis } from '@/modules/vmi/vmiDuomenys.js';
import { postgres } from '@/postgres/postgres.js';
import '@/utils/time.js';

export interface JuridinisPanel {
  jarKodas: string;
  pavadinimas: string;
  formosPavadinimas: string | null;
  statusoPavadinimas: string | null;
  registravimoData: string | null;
  adresas: string | null;
  location: [number, number] | null;
  ekonominesVeiklosPavadinimas: string | null;
  ekonominesVeiklosKodas: string | null;
  darbuotojai: number | null;
  vidutinisAtlyginimas: number | null;
  vmiMokesciai: number | null;
  vmiData: string | null;
  istatinisKapitalas: number | null;
  istatinioValiuta: string | null;
  pirkimuSuma: number | null;
  pardavimuSuma: number | null;
}

function sumTotals(rows: { total?: unknown }[] | undefined) {
  if (!rows?.length) return null;
  return rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
}

async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

export async function findSingleJuridinisPanel(q: string): Promise<JuridinisPanel | null> {
  if (!q.trim()) return null;

  try {
    const { results, total } = await searchJar({ search: q }, { page: 1, limit: 2 });
    if (total !== 1 || results.length !== 1) return null;

    const item = results[0];
    const [locationRes, jarRes] = await Promise.all([
      optional(postgres.query(
      `SELECT
         CASE WHEN resolved.location IS NULL THEN NULL ELSE ST_Y(resolved.location::geometry) END AS lat,
         CASE WHEN resolved.location IS NULL THEN NULL ELSE ST_X(resolved.location::geometry) END AS lon
       FROM "rcJar"."asmenys" jar_person
       ${JAR_LOCATION_JOINS}
       CROSS JOIN LATERAL (
         SELECT ${JAR_LOCATION_SQL} AS location
       ) resolved
       WHERE jar_person."jarKodas" = $1
       LIMIT 1`,
      [item.jarKodas],
      )),
      optional(postgres.query(
        `SELECT _id AS "jarId"
         FROM "rcJar"."spintaAsmenys"
         WHERE "jarKodas"::text = $1::text
         LIMIT 1`,
        [item.jarKodas],
      )),
    ]);
    const rows = locationRes?.rows ?? [];
    const lat = Number(rows[0]?.lat);
    const lon = Number(rows[0]?.lon);
    const jarId = jarRes?.rows[0]?.jarId;
    const [sodra, vmi, sutartys, kapitalasRes] = await Promise.all([
      optional(gautiSodrosDuomenis(item.jarKodas)),
      optional(gautiVmiDuomenis(item.jarKodas, jarId)),
      optional(gautiSutarciuDuomenisPagalJarKoda(item.jarKodas, { limit: 1 })),
      jarId
        ? optional(postgres.query(
            `SELECT reiksme, valiuta
             FROM "rcJar"."spintaKapitalas"
             WHERE "jarId" = $1
             ORDER BY data DESC
             LIMIT 1`,
            [jarId],
          ))
        : Promise.resolve({ rows: [] }),
    ]);
    const kapitalas = kapitalasRes?.rows[0];

    return {
      jarKodas: String(item.jarKodas),
      pavadinimas: String(item.pavadinimas),
      formosPavadinimas: item.formosPavadinimas ?? null,
      statusoPavadinimas: item.statusoPavadinimas ?? null,
      registravimoData: item.registravimoData ?? null,
      adresas: item.adresas ?? null,
      location: Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null,
      ekonominesVeiklosPavadinimas: sodra?.ekonominesVeiklosPavadinimas ?? null,
      ekonominesVeiklosKodas: sodra?.ekonominesVeiklosKodas ?? null,
      darbuotojai: sodra?.bendrasDraustujuSkaicius ?? null,
      vidutinisAtlyginimas: sodra?.bendrasVidutinisAtlyginimas ?? null,
      vmiMokesciai: (vmi as { suma?: number } | null)?.suma ?? null,
      vmiData: vmi?.data ?? null,
      istatinisKapitalas: kapitalas?.reiksme != null ? Number(kapitalas.reiksme) : null,
      istatinioValiuta: kapitalas?.valiuta === 'Eur' ? 'EUR' : kapitalas?.valiuta ?? null,
      pirkimuSuma: sumTotals(sutartys?.pirkimaiKasMetus),
      pardavimuSuma: sumTotals(sutartys?.tiekimaiKasMetus),
    };
  } catch {
    // This panel is supplementary; document search must still work if the
    // juridiniai search engine or location lookup is unavailable.
    return null;
  }
}

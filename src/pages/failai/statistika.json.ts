import { postgres } from '../../../postgres/postgres.js';

export async function gautiFailuStatistika() {
  const { rows } = await postgres.query(`SELECT
      COALESCE(SUM(files), 0)            AS visi,
      COALESCE(SUM(bytes), 0)            AS dydis,
      COALESCE(SUM(downloaded), 0)       AS parsiusti,
      COALESCE(SUM("downloadFailed"), 0) AS klaida,
      COALESCE(SUM(extracted), 0)        AS nuskaityti,
      COALESCE(SUM(words), 0)            AS "zodziuSuma"
    FROM public."filesStats";`);

  const c = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([k, v]) => [k, Number(v)]));
  const neparsiusti = c.visi - c.parsiusti - c.klaida;
  const baitasFailui = c.parsiusti > 0 ? c.dydis / c.parsiusti : 0;

  return {
    atnaujinta: new Date().toISOString(),
    failai: {
      kiekiai: { visi: c.visi, klaida: c.klaida, parsiusti: c.parsiusti, neparsiusti },
      dydziai: {
        // Tikras dydis žinomas tik parsiųstiems, likusiems ekstrapoliuojama.
        visi: baitasFailui * c.visi,
        klaida: baitasFailui * c.klaida,
        parsiusti: c.dydis,
        neparsiusti: baitasFailui * neparsiusti,
      },
    },
    nuskaitymas: {
      zodziai: { total: c.zodziuSuma },
      nuskaityti: c.nuskaityti,
    },
  };
}

const gautiStatistika = gautiFailuStatistika;

export async function GET() {
  const statistika = await gautiStatistika();
  return new Response(JSON.stringify(statistika), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
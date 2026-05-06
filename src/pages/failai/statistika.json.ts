import { postgres } from '../../../postgres/postgres.js';

async function gautiStatistika() {
  const { rows } = await postgres.query(`SELECT metrika, eilute, verte FROM "failaiCounts";`);
  const counts = rows.reduce((acc: any, row: any) => {
    const { metrika, eilute, verte } = row;
    if (!acc[metrika]) acc[metrika] = eilute === 'ALL' ? verte : {};
    if (eilute === 'ALL') acc[metrika] = verte;
    else acc[metrika][eilute] = verte;
    return acc;
  }, {});

  return {
    atnaujinta: new Date().toISOString(),
    failai: {
      kiekiai: {
        visi: counts.visi,
        klaida: counts.klaida,
        parsiusti: counts.parsiusti,
        neparsiusti: counts.visi - counts.parsiusti - counts.klaida - counts.extracted,
      },
      dydziai: {
        visi: (counts.dydis / counts.parsiusti) * counts.visi,
        klaida: (counts.dydis / counts.parsiusti) * counts.klaida,
        parsiusti: counts.dydis,
        neparsiusti: (counts.dydis / counts.parsiusti) * (counts.visi - counts.parsiusti - counts.klaida - counts.extracted),
      },
    },
    nuskaitymas: {
      zodziai: {
        total: counts.zodziuSuma,
        failaiSuZodziais: counts.zodziuKiekisNeNulis,
      },
    },
  };
}

export async function GET() {
  const statistika = await gautiStatistika();
  return new Response(JSON.stringify(statistika), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
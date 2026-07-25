import { postgres } from '../../../postgres/postgres.js';

export async function gautiFailuStatistika() {
  const { rows } = await postgres.query(`SELECT
      COALESCE(SUM(files), 0)                 AS visi,
      COALESCE(SUM(downloaded), 0)            AS parsiusti,
      COALESCE(SUM("downloadFailed"), 0)      AS klaida,
      COALESCE(SUM(pending), 0)               AS pending,
      COALESCE(SUM(unarchived), 0)            AS unarchived,
      COALESCE(SUM(bytes), 0)                 AS "visiBaitai",
      COALESCE(SUM("downloadedBytes"), 0)     AS "parsiustuBaitai",
      COALESCE(SUM("downloadFailedBytes"), 0) AS "klaidosBaitai",
      COALESCE(SUM("pendingBytes"), 0)        AS "pendingBaitai",
      COALESCE(SUM(extracted), 0)             AS nuskaityti,
      COALESCE(SUM("extractFailed"), 0)       AS "nuskaitymoKlaidos",
      COALESCE(SUM(words), 0)                 AS "zodziuSuma",
      COALESCE(SUM(pages), 0)                 AS "puslapiuSuma",
      COALESCE(SUM(characters), 0)            AS "simboliuSuma",
      COALESCE(SUM("ocrDone"), 0)             AS "ocrDone",
      COALESCE(SUM("ocrFailed"), 0)           AS "ocrFailed",
      COALESCE(SUM("ocrPending"), 0)          AS "ocrPending"
    FROM public."filesStats";`);

  const c = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([k, v]) => [k, Number(v)]));
  const neparsiusti = Math.max(0, c.visi - c.parsiusti - c.klaida);

  // Tikras nuskaitymo eilės ilgis — apytikslis pg gyvų eilučių skaičius.
  const { rows: queueRows } = await postgres.query(
    `SELECT COALESCE(n_live_tup, 0)::bigint AS approx
       FROM pg_stat_user_tables WHERE relname = 'filesExtractionQueue'`,
  );
  const eilesApprox = Number(queueRows[0]?.approx ?? 0);

  return {
    atnaujinta: new Date().toISOString(),
    failai: {
      kiekiai: {
        visi: c.visi,
        klaida: c.klaida,
        parsiusti: c.parsiusti,
        neparsiusti,
        pending: c.pending,
        unarchived: c.unarchived,
      },
      // Nauja schema turi tikrus baitus pagal būseną — nebeekstrapoliuojam.
      dydziai: {
        visi: c.visiBaitai,
        klaida: c.klaidosBaitai,
        parsiusti: c.parsiustuBaitai,
        neparsiusti: c.pendingBaitai,
      },
    },
    nuskaitymas: {
      zodziai: {
        total: c.zodziuSuma,
        vidurkis: c.nuskaityti > 0 ? c.zodziuSuma / c.nuskaityti : 0,
      },
      nuskaityti: c.nuskaityti,
      klaidos: c.nuskaitymoKlaidos,
      puslapiai: c.puslapiuSuma,
      simboliai: c.simboliuSuma,
      eilesApprox,
    },
    // OCR — atskiras (pagalbinis) žingsnis, ne tas pats kaip teksto atpažinimas.
    ocr: {
      atlikta: c.ocrDone,
      klaidos: c.ocrFailed,
      laukia: c.ocrPending,
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
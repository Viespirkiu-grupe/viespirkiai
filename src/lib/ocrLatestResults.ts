import { DateTime } from 'luxon';
import { postgres } from '@/postgres/postgres.js';
import { formatDuration } from '../../utils/time.js';

function formatLtDateTime(value: unknown) {
  if (!value) return '—';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '—';
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');
  }

  const raw = String(value).trim();
  if (!raw) return '—';

  const asUtcSql = DateTime.fromSQL(raw, { zone: 'utc' });
  if (asUtcSql.isValid) return asUtcSql.setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');

  const asUtcIso = DateTime.fromISO(raw.replace(' ', 'T'), { zone: 'utc' });
  if (asUtcIso.isValid) return asUtcIso.setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');

  return '—';
}

/**
 * Paskutiniai OCR rezultatai.
 *
 * Rezultatų istorijos nebėra — `filesOcrStatus` laiko po vieną (paskutinę) eilutę
 * failui, tad sąrašas rodo vėliausiai OCR'intus failus. Skirtumas nuo senosios
 * versijos vienintelis: jei tas pats failas OCR'intas kelis kartus, jis rodomas
 * vieną kartą. Puslapių ir žodžių skaičiai imami iš po OCR atlikto nuskaitymo.
 */
export async function loadLatestOcrResults(limit = 15): Promise<any[]> {
  const res = await postgres.query(`
    SELECT
      o.id AS failas,
      n.pavadinimas AS node,
      COALESCE(n."viesasPavadinimas", n.pavadinimas) AS "nodeDisplay",
      o."ocrTimestamp" AS "submitTimestamp",
      o.duration,
      d."pageCount" AS "puslapiuSkaicius",
      d."wordCount" AS "zodziuSkaicius",
      fn.filename AS pavadinimas
    FROM public."filesOcrStatus" o
    LEFT JOIN public.files f ON f.id = o.id
    LEFT JOIN public."filesFilenames" fn ON fn.id = f."filenameId"
    LEFT JOIN public."filesDataExtraction" d ON d.id = o.id
    LEFT JOIN public."ocrNuskaitytojai" n ON n.id = o."nodeId"
    WHERE o."ocrTimestamp" IS NOT NULL
    ORDER BY o."ocrTimestamp" DESC
    LIMIT $1
  `, [limit]);

  return res.rows.map((row: any) => ({
    ...row,
    submitTimestampDisplay: formatLtDateTime(row.submitTimestamp),
    durationDisplay: formatDuration(row.duration),
    puslapiuSkaicius: Number(row.puslapiuSkaicius || 0),
    zodziuSkaicius: Number(row.zodziuSkaicius || 0),
  }));
}

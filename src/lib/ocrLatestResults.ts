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

export async function loadLatestOcrResults(limit = 15): Promise<any[]> {
  const res = await postgres.query(`
    SELECT
      r.failas,
      r.node,
      COALESCE(n."viesasPavadinimas", r.node) AS "nodeDisplay",
      r."submitTimestamp",
      r.duration,
      r."puslapiuSkaicius",
      r."zodziuSkaicius",
      f.pavadinimas
    FROM "failaiOcrRezultatai" r
    LEFT JOIN failai f ON f.id = r.failas
    LEFT JOIN "ocrNuskaitytojai" n ON n.pavadinimas = r.node
    ORDER BY r."submitTimestamp" DESC NULLS LAST
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

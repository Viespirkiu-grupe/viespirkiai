import { postgres } from '../../postgres/postgres.js';
import { convertUnit } from '../../utils/units.js';
import '../../utils/linksniai.js';

let cache = null;
let cacheTime = 0;

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(dateInput) {
  return new Date(dateInput).toLocaleString('lt-LT', { hour12: false });
}

export function humanizeStatistika(statistika) {
  const h = structuredClone(statistika);
  h.failai.dydziai = Object.fromEntries(
    Object.entries(h.failai.dydziai).map(([k, v]) => [k, formatBytes(v)]),
  );
  return h;
}

export function buildSsePayload(h) {
  return {
    atnaujinta: formatDateTime(h.atnaujinta),
    failai: h.failai,
    nuskaitymas: {
      zodziai: {
        total: Number(h.nuskaitymas.zodziai.total).linksniuoti(['žodis', 'žodžiai', 'žodžių', 'žodžio']),
        vidurkis: Number(h.nuskaitymas.zodziai.vidurkis).linksniuoti(['žodis', 'žodžiai', 'žodžių', 'žodžio']),
        vidurkisNeNulis: Number(h.nuskaitymas.zodziai.vidurkisNeNulis).linksniuoti(['žodis', 'žodžiai', 'žodžių', 'žodžio']),
        failuSuZodziaisDalis: `${Number(h.nuskaitymas.zodziai.failuSuZodziaisDalis).toFixed(2)} %`,
      },
      pagalVersija: h.nuskaitymas.pagalVersija.map((v) => ({
        status: v.status,
        kiekis: Number(v.kiekis).toLocaleString('lt-LT'),
        procentai: `${Number(v.procentai).toLocaleString('lt-LT')} %`,
      })),
    },
    topDokNuskaitytojai: h.topDokNuskaitytojai.map((n) => ({
      viesasPavadinimas: n.viesasPavadinimas,
      nuskaitytidokumentai: Number(n.nuskaitytidokumentai).toLocaleString('lt-LT'),
    })),
    database: {
      uptime: convertUnit(Number(h.database.uptime_seconds), 's'),
      xact_commit: Number(h.database.xact_commit).toLocaleString('lt-LT'),
      tup_inserted: Number(h.database.tup_inserted).toLocaleString('lt-LT'),
      tup_updated: Number(h.database.tup_updated).toLocaleString('lt-LT'),
      tup_deleted: Number(h.database.tup_deleted).toLocaleString('lt-LT'),
      tup_fetched: Number(h.database.tup_fetched).toLocaleString('lt-LT'),
    },
    lenteles: h.lenteles.map((l) => ({
      tableName: l.tableName,
      dataSize: convertUnit(Number(l.dataSize), 'B'),
      indexSize: convertUnit(Number(l.indexSize), 'B'),
      totalSize: convertUnit(Number(l.totalSize), 'B'),
      approxRowCount: Number(l.approxRowCount).toLocaleString('lt-LT'),
      isTotal: l.tableName === 'Iš viso',
    })),
    eiles: h.eiles.map((e) => ({
      tableName: e.tableName,
      approxRowCount: Number(e.approxRowCount).toLocaleString('lt-LT'),
    })),
    quickwitIndeksai: h.quickwitIndeksai.map((i) => ({
      id: Number(i.id).toLocaleString('lt-LT'),
      lentele: i.lentele,
      seq: Number(i.seq).toLocaleString('lt-LT'),
      indeksas: i.indeksas,
      shardSize: Number(i.shardSize).toLocaleString('lt-LT'),
      gyvosEilutes: Number(i.gyvosEilutes).toLocaleString('lt-LT'),
      sukurta: formatDateTime(i.sukurta),
      indexConfigHash: i.indexConfigHash ?? '',
      current: i.current ? 'Taip' : 'Ne',
      iterptosEilutes: Number(i.iterptosEilutes).toLocaleString('lt-LT'),
      mirusiosEilutes: Number(i.mirusiosEilutes).toLocaleString('lt-LT'),
    })),
    replikacija: (h.replikacija ?? []).map((r) => ({
      client_addr: r.client_addr ?? '',
      state: r.state ?? '',
      sent_lsn: r.sent_lsn ?? '',
      write_lsn: r.write_lsn ?? '',
      flush_lsn: r.flush_lsn ?? '',
      replay_lsn: r.replay_lsn ?? '',
      write_lag: r.write_lag ?? '',
      flush_lag: r.flush_lag ?? '',
      replay_lag: r.replay_lag ?? '',
      primary_current_lsn: r.primary_current_lsn ?? '',
      bytes_behind: r.bytes_behind == null ? '' : convertUnit(Number(r.bytes_behind), 'B'),
    })),
  };
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false; }
    return true;
  }
  return false;
}

export function diffPayload(prev, next) {
  if (prev === null) return next;
  if (deepEqual(prev, next)) return undefined;
  if (Array.isArray(next)) return next;
  if (isObject(next) && isObject(prev)) {
    const diff = {};
    for (const k of Object.keys(next)) {
      const d = diffPayload(prev[k], next[k]);
      if (d !== undefined) diff[k] = d;
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  }
  return next;
}

export async function gautiStatistika() {
  const now = Date.now();
  if (cache && now - cacheTime < 50) return cache;

  const [failaiCountsRes, lentelesRes, topRes, dbRes, quickwitIndeksaiRes, replikacijaRes] = await Promise.all([
    postgres.query(`SELECT metrika, eilute, verte FROM "failaiCounts";`),
    postgres.query(`SELECT s.relname AS "tableName", pg_table_size(s.relid) AS "dataSize", pg_indexes_size(s.relid) AS "indexSize", pg_table_size(s.relid) + pg_indexes_size(s.relid) AS "totalSize", st.n_live_tup AS "approxRowCount" FROM pg_catalog.pg_statio_user_tables s JOIN pg_catalog.pg_stat_user_tables st ON s.relid = st.relid ORDER BY s.relname ASC;`),
    postgres.query(`SELECT "nuskaitytidokumentai", "viesasPavadinimas" FROM "dokNuskaitytojai" ORDER BY "nuskaitytidokumentai" DESC LIMIT 100;`),
    postgres.query(`SELECT current_database() AS db, xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, conflicts, deadlocks, temp_files, temp_bytes, extract(epoch from now() - stats_reset) AS stats_age_seconds, extract(epoch from now() - pg_postmaster_start_time()) AS uptime_seconds FROM pg_stat_database WHERE datname = current_database();`),
    postgres.query(`SELECT * FROM "quickwitIndeksai" ORDER BY "lentele", "seq";`),
    postgres.query(`SELECT client_addr::text AS client_addr, state, sent_lsn::text AS sent_lsn, write_lsn::text AS write_lsn, flush_lsn::text AS flush_lsn, replay_lsn::text AS replay_lsn, write_lag::text AS write_lag, flush_lag::text AS flush_lag, replay_lag::text AS replay_lag, pg_current_wal_lsn()::text AS primary_current_lsn, pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind FROM pg_stat_replication;`),
  ]);

  const counts = failaiCountsRes.rows.reduce((acc, { metrika, eilute, verte }) => {
    if (!acc[metrika]) acc[metrika] = eilute === 'ALL' ? verte : {};
    if (eilute === 'ALL') acc[metrika] = verte;
    else acc[metrika][eilute] = verte;
    return acc;
  }, {});

  const statistika = {};

  statistika.failai = {
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
  };

  statistika.eiles = lentelesRes.rows.filter((lentele) => lentele.tableName.endsWith('Queue'));
  statistika.lenteles = lentelesRes.rows;
  statistika.lenteles.push({
    tableName: 'Iš viso',
    dataSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.dataSize) || 0), 0),
    indexSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.indexSize) || 0), 0),
    totalSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.totalSize) || 0), 0),
    approxRowCount: statistika.lenteles.reduce((a, b) => a + (parseInt(b.approxRowCount, 10) || 0), 0),
  });

  statistika.nuskaitymas = {
    zodziai: {
      total: counts.zodziuSuma,
      vidurkis: counts.zodziuSuma / counts.zodziuKiekis,
      failaiSuZodziais: counts.zodziuKiekisNeNulis,
      failaiBeZodziu: statistika.failai.kiekiai.visi - counts.zodziuKiekisNeNulis,
      vidurkisNeNulis: counts.zodziuSuma / counts.zodziuKiekisNeNulis,
      failuSuZodziaisDalis: (counts.zodziuKiekisNeNulis / statistika.failai.kiekiai.visi) * 100,
    },
  };

  statistika.nuskaitymas.pagalVersija = Object.entries(counts.nuskaitytas)
    .map(([status, kiekis]) => ({ status, kiekis, procentai: (kiekis / statistika.failai.kiekiai.visi) * 100 || 0 }))
    .sort((a, b) => a.status.localeCompare(b.status));

  const didziausiasStatusas = statistika.nuskaitymas.pagalVersija
    .map((o) => Number(o.status)).filter((n) => !isNaN(n))
    .reduce((max, n) => (n > max ? n : max), -Infinity);

  const nuskaitytaKiekis = statistika.nuskaitymas.pagalVersija.reduce((sum, o) => {
    if (o.status === String(didziausiasStatusas) || (o.status !== 'Nenuskaityta' && isNaN(Number(o.status)))) return sum + o.kiekis;
    return sum;
  }, 0);

  statistika.nuskaitymas.likoNuskaityti = statistika.failai.kiekiai.parsiusti - nuskaitytaKiekis;
  statistika.nuskaitymas.zodziuSkaicius = statistika.nuskaitymas.zodziai.total;
  statistika.topDokNuskaitytojai = topRes.rows;
  statistika.database = dbRes.rows[0];
  statistika.quickwitIndeksai = quickwitIndeksaiRes.rows;
  statistika.replikacija = replikacijaRes.rows;
  statistika.atnaujinta = new Date();

  cache = statistika;
  cacheTime = Date.now();
  return statistika;
}

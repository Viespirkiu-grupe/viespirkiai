import { postgres } from '../../postgres/postgres.js';
import { gautiLenteliuDydzius } from "./lenteliuDydziai.js";
import { convertUnit } from '../../utils/units.js';
import '../../utils/linksniai.js';

let cache = null;
let cacheTime = 0;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

// Baitai → artimiausias vienetas (iki PB — kolekcija jau seniai peraugo GB) su
// lt-LT skaitmenų formatavimu: „13,53 TB", „5 386 416 B".
function formatBytes(value) {
  let val = Number(value) || 0;
  let i = 0;
  while (val >= 1024 && i < BYTE_UNITS.length - 1) {
    val /= 1024;
    i++;
  }
  const skaitmenys = i === 0 ? 0 : 2;
  const formatted = val.toLocaleString('lt-LT', {
    minimumFractionDigits: skaitmenys,
    maximumFractionDigits: skaitmenys,
  });
  return `${formatted} ${BYTE_UNITS[i]}`;
}

function formatCount(value) {
  return (Number(value) || 0).toLocaleString('lt-LT');
}

function formatDateTime(dateInput) {
  return new Date(dateInput).toLocaleString('lt-LT', { hour12: false });
}

export function humanizeStatistika(statistika) {
  const h = structuredClone(statistika);
  const apytiksliai = h.failai.apytiksliai ?? {};
  h.failai.dydziai = Object.fromEntries(
    Object.entries(h.failai.dydziai).map(([k, v]) => [k, formatBytes(v) + (apytiksliai[k] ? ' *' : '')]),
  );
  h.failai.kiekiai = Object.fromEntries(
    Object.entries(h.failai.kiekiai).map(([k, v]) => [k, formatCount(v)]),
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
      },
      nuskaityti: Number(h.nuskaitymas.nuskaityti).toLocaleString('lt-LT'),
      klaidos: Number(h.nuskaitymas.klaidos).toLocaleString('lt-LT'),
      likoNuskaityti: Number(h.nuskaitymas.likoNuskaityti).toLocaleString('lt-LT'),
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

// --- Prometheus eksponavimas -------------------------------------------------
// Grąžina visą /statistika puslapio informaciją Prometheus text exposition
// formatu (version 0.0.4). Naudoja žalią (nehumanizuotą) gautiStatistika()
// objektą, kad reikšmės liktų skaitinės.
const PROM_PREFIX = 'viespirkiai';

function promEscapeLabel(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function promLabels(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${promEscapeLabel(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

export function buildPrometheusMetrics(statistika) {
  const lines = [];

  // Įrašo vieną metriką su HELP/TYPE eilutėmis. Praleidžia neskaitines/ne-baigtines
  // reikšmes (pvz. dalyba iš nulio → Infinity/NaN), kad Prometheus scrape'as nekristų.
  const metric = (name, type, help, samples) => {
    const full = `${PROM_PREFIX}_${name}`;
    const rows = samples
      .map((s) => ({ labels: s.labels || {}, value: Number(s.value) }))
      .filter((s) => Number.isFinite(s.value));
    if (rows.length === 0) return;
    lines.push(`# HELP ${full} ${help}`);
    lines.push(`# TYPE ${full} ${type}`);
    for (const s of rows) lines.push(`${full}${promLabels(s.labels)} ${s.value}`);
  };

  const { failai, nuskaitymas, lenteles, database, quickwitIndeksai, replikacija, topDokNuskaitytojai } = statistika;

  // Failų kiekiai ir dydžiai pagal būseną
  const busenos = ['visi', 'klaida', 'parsiusti', 'neparsiusti', 'isArchyvu'];
  metric('failai_kiekis', 'gauge', 'Failų kiekis pagal būseną',
    busenos.map((b) => ({ labels: { busena: b }, value: failai.kiekiai[b] })));
  metric('failai_dydis_bytes', 'gauge', 'Failų dydis baitais pagal būseną',
    busenos.map((b) => ({ labels: { busena: b }, value: failai.dydziai[b] })));

  // Nuskaitymo skaitliukai
  metric('nuskaitymas_zodziu_suma', 'gauge', 'Bendra nuskaitytų žodžių suma',
    [{ value: nuskaitymas.zodziai.total }]);
  metric('nuskaitymas_zodziu_vidurkis', 'gauge', 'Vidutinis žodžių skaičius faile',
    [{ value: nuskaitymas.zodziai.vidurkis }]);
  metric('nuskaitymas_puslapiu_suma', 'gauge', 'Bendra nuskaitytų puslapių suma',
    [{ value: nuskaitymas.puslapiai }]);
  metric('nuskaitymas_simboliu_suma', 'gauge', 'Bendra nuskaitytų simbolių suma',
    [{ value: nuskaitymas.simboliai }]);
  metric('nuskaitymas_nuskaityti', 'gauge', 'Sėkmingai nuskaitytų failų kiekis',
    [{ value: nuskaitymas.nuskaityti }]);
  metric('nuskaitymas_klaidos', 'gauge', 'Nuskaitymo klaidų kiekis',
    [{ value: nuskaitymas.klaidos }]);
  metric('nuskaitymas_liko_nuskaityti', 'gauge', 'Kiek parsisiųstų failų dar liko nuskaityti',
    [{ value: nuskaitymas.likoNuskaityti }]);

  // Lentelės (be suvestinės „Iš viso" eilutės – ją Prometheus gali susumuoti pats).
  // Eilės (…Queue) yra šių metrikų poaibis (žr. lentelės pavadinimą).
  const lent = lenteles.filter((l) => l.tableName !== 'Iš viso');
  metric('lentele_data_bytes', 'gauge', 'Lentelės duomenų dydis baitais',
    lent.map((l) => ({ labels: { lentele: l.tableName }, value: l.dataSize })));
  metric('lentele_index_bytes', 'gauge', 'Lentelės indeksų dydis baitais',
    lent.map((l) => ({ labels: { lentele: l.tableName }, value: l.indexSize })));
  metric('lentele_total_bytes', 'gauge', 'Lentelės bendras dydis baitais (duomenys + indeksai)',
    lent.map((l) => ({ labels: { lentele: l.tableName }, value: l.totalSize })));
  metric('lentele_eilutes', 'gauge', 'Apytikslis lentelės eilučių skaičius (n_live_tup)',
    lent.map((l) => ({ labels: { lentele: l.tableName }, value: l.approxRowCount })));

  // PostgreSQL statistika. Kaupiamieji rodikliai (nuo stats_reset) – counter.
  metric('database_uptime_seconds', 'gauge', 'PostgreSQL serverio veikimo laikas sekundėmis',
    [{ value: database.uptime_seconds }]);
  metric('database_stats_age_seconds', 'gauge', 'Laikas nuo statistikos atstatymo sekundėmis',
    [{ value: database.stats_age_seconds }]);
  const dbCounters = {
    xact_commit: 'Patvirtintų tranzakcijų skaičius',
    xact_rollback: 'Atšauktų tranzakcijų skaičius',
    blks_read: 'Iš disko perskaitytų blokų skaičius',
    blks_hit: 'Iš buferio paimtų blokų skaičius',
    tup_returned: 'Grąžintų eilučių skaičius',
    tup_fetched: 'Paimtų eilučių skaičius',
    tup_inserted: 'Įterptų eilučių skaičius',
    tup_updated: 'Atnaujintų eilučių skaičius',
    tup_deleted: 'Ištrintų eilučių skaičius',
    conflicts: 'Konfliktų skaičius',
    deadlocks: 'Aklaviečių skaičius',
    temp_files: 'Sukurtų laikinų failų skaičius',
    temp_bytes: 'Laikinų failų dydis baitais',
  };
  for (const [col, help] of Object.entries(dbCounters)) {
    metric(`database_${col}_total`, 'counter', help, [{ value: database[col] }]);
  }

  // Quickwit indeksai
  const qwLabels = (i) => ({ lentele: i.lentele, indeksas: i.indeksas, current: i.current ? 'true' : 'false' });
  metric('quickwit_shard_talpa', 'gauge', 'Quickwit šardo talpa – maks. dokumentų (eilučių) skaičius šarde',
    quickwitIndeksai.map((i) => ({ labels: qwLabels(i), value: i.shardSize })));
  metric('quickwit_gyvos_eilutes', 'gauge', 'Quickwit indekso gyvų eilučių skaičius',
    quickwitIndeksai.map((i) => ({ labels: qwLabels(i), value: i.gyvosEilutes })));
  metric('quickwit_iterptos_eilutes', 'gauge', 'Quickwit indekso įterptų eilučių skaičius',
    quickwitIndeksai.map((i) => ({ labels: qwLabels(i), value: i.iterptosEilutes })));
  metric('quickwit_mirusios_eilutes', 'gauge', 'Quickwit indekso mirusių eilučių skaičius',
    quickwitIndeksai.map((i) => ({ labels: qwLabels(i), value: i.mirusiosEilutes })));
  metric('quickwit_sukurta_timestamp_seconds', 'gauge', 'Quickwit indekso sukūrimo laikas (Unix sekundės)',
    quickwitIndeksai.map((i) => ({ labels: qwLabels(i), value: new Date(i.sukurta).getTime() / 1000 })));

  // Replikacija
  const replLabels = (r) => ({ client_addr: r.client_addr, state: r.state });
  metric('replikacija_bytes_behind', 'gauge', 'Kiek baitų replika atsilieka nuo pirminės DB',
    (replikacija ?? []).map((r) => ({ labels: replLabels(r), value: r.bytes_behind })));
  metric('replikacija_write_lag_seconds', 'gauge', 'Įrašymo (write) replikacijos vėlavimas sekundėmis',
    (replikacija ?? []).map((r) => ({ labels: replLabels(r), value: r.write_lag_seconds })));
  metric('replikacija_flush_lag_seconds', 'gauge', 'Išsaugojimo (flush) replikacijos vėlavimas sekundėmis',
    (replikacija ?? []).map((r) => ({ labels: replLabels(r), value: r.flush_lag_seconds })));
  metric('replikacija_replay_lag_seconds', 'gauge', 'Pritaikymo (replay) replikacijos vėlavimas sekundėmis',
    (replikacija ?? []).map((r) => ({ labels: replLabels(r), value: r.replay_lag_seconds })));

  // Top dokumentų nuskaitytojai
  metric('dok_nuskaitytojas_dokumentai', 'gauge', 'Nuskaitytų dokumentų skaičius pagal nuskaitytoją',
    (topDokNuskaitytojai ?? []).map((n) => ({ labels: { nuskaitytojas: n.viesasPavadinimas }, value: n.nuskaitytidokumentai })));

  // Kada statistika paskutinį kartą suformuota
  metric('statistika_atnaujinta_timestamp_seconds', 'gauge', 'Statistikos suformavimo laikas (Unix sekundės)',
    [{ value: new Date(statistika.atnaujinta).getTime() / 1000 }]);

  return lines.join('\n') + '\n';
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
    postgres.query(`SELECT
        COALESCE(SUM(files), 0)                 AS visi,
        COALESCE(SUM(bytes), 0)                 AS "visiBaitai",
        COALESCE(SUM("downloadedBytes"), 0)     AS "parsiustuBaitai",
        COALESCE(SUM("downloadFailedBytes"), 0) AS "klaidosBaitai",
        COALESCE(SUM("pendingBytes"), 0)        AS "neparsiustuBaitai",
        COALESCE(SUM("unarchivedBytes"), 0)      AS "isarchyvuBaitai",
        COALESCE(SUM(downloaded), 0)       AS parsiusti,
        COALESCE(SUM("downloadFailed"), 0) AS klaida,
        COALESCE(SUM(pending), 0)          AS neparsiusti,
        COALESCE(SUM(unarchived), 0)       AS "isArchyvu",
        COALESCE(SUM(extracted), 0)        AS nuskaityti,
        COALESCE(SUM("extractFailed"), 0)  AS "nuskaitymoKlaidos",
        COALESCE(SUM(words), 0)            AS "zodziuSuma",
        COALESCE(SUM(pages), 0)            AS "puslapiuSuma",
        COALESCE(SUM(characters), 0)       AS "simboliuSuma"
      FROM public."filesStats";`),
    // Užklausa gyvena modules/statistika/lenteliuDydziai.js – ja dalinasi ir
    // /duomenys/lenteles. Filtruojam į `public`, kad dokumentacijos schema `dba`
    // nepatektų į bendrą statistiką.
    gautiLenteliuDydzius({ schemos: ["public"] }).then((rows) => ({ rows })),
    postgres.query(`SELECT "nuskaitytidokumentai", "viesasPavadinimas" FROM "dokNuskaitytojai" ORDER BY "nuskaitytidokumentai" DESC LIMIT 100;`),
    postgres.query(`SELECT current_database() AS db, xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, conflicts, deadlocks, temp_files, temp_bytes, extract(epoch from now() - stats_reset) AS stats_age_seconds, extract(epoch from now() - pg_postmaster_start_time()) AS uptime_seconds FROM pg_stat_database WHERE datname = current_database();`),
    postgres.query(`SELECT * FROM "quickwitIndeksai" ORDER BY "lentele", "seq";`),
    postgres.query(`SELECT client_addr::text AS client_addr, state, sent_lsn::text AS sent_lsn, write_lsn::text AS write_lsn, flush_lsn::text AS flush_lsn, replay_lsn::text AS replay_lsn, write_lag::text AS write_lag, flush_lag::text AS flush_lag, replay_lag::text AS replay_lag, extract(epoch from write_lag) AS write_lag_seconds, extract(epoch from flush_lag) AS flush_lag_seconds, extract(epoch from replay_lag) AS replay_lag_seconds, pg_current_wal_lsn()::text AS primary_current_lsn, pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind FROM pg_stat_replication;`),
  ]);

  // filesStats yra per plėtinį, tad bendros reikšmės — SUM(...) (žr. užklausą aukščiau).
  const counts = Object.fromEntries(
    Object.entries(failaiCountsRes.rows[0] ?? {}).map(([k, v]) => [k, Number(v)]),
  );

  const statistika = {};

  // Būsenos nesidubliuoja ir sudaro visumą: parsiusti + klaida + neparsiusti
  // (dar eilėje) + isArchyvu (išskleisti iš archyvo, downloadStatus = -5) = visi.
  // `filesStats` laiko tikrus baitus pagal būseną — nebeekstrapoliuojam iš
  // vidutinio parsiųsto failo dydžio (žr. ir /failai statistiką).
  const kiekiai = {
    visi: counts.visi,
    klaida: counts.klaida,
    parsiusti: counts.parsiusti,
    neparsiusti: counts.neparsiusti,
    isArchyvu: counts.isArchyvu,
  };
  const dydziai = {
    visi: counts.visiBaitai,
    klaida: counts.klaidosBaitai,
    parsiusti: counts.parsiustuBaitai,
    neparsiusti: counts.neparsiustuBaitai,
    isArchyvu: counts.isarchyvuBaitai,
  };

  // Neparsiųsto failo dydžio DB nežino (filesize užpildomas parsiuntus), tad
  // tokioms būsenoms jį įvertinam pagal vidutinį parsiųsto failo dydį. Įvertintos
  // reikšmės pažymimos, kad puslapyje būtų su „*".
  const apytiksliai = {};
  const baitasFailui = counts.parsiusti > 0 ? counts.parsiustuBaitai / counts.parsiusti : 0;
  let ivertintiBaitai = 0;
  for (const [key, kiekis] of Object.entries(kiekiai)) {
    if (key === 'visi' || dydziai[key] > 0 || kiekis <= 0) continue;
    dydziai[key] = baitasFailui * kiekis;
    apytiksliai[key] = true;
    ivertintiBaitai += dydziai[key];
  }
  if (ivertintiBaitai > 0) {
    dydziai.visi += ivertintiBaitai;
    apytiksliai.visi = true;
  }

  statistika.failai = { kiekiai, dydziai, apytiksliai };

  statistika.eiles = lentelesRes.rows.filter((lentele) => lentele.tableName.endsWith('Queue'));
  statistika.lenteles = lentelesRes.rows;
  statistika.lenteles.push({
    tableName: 'Iš viso',
    dataSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.dataSize) || 0), 0),
    indexSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.indexSize) || 0), 0),
    totalSize: statistika.lenteles.reduce((a, b) => a + (parseFloat(b.totalSize) || 0), 0),
    approxRowCount: statistika.lenteles.reduce((a, b) => a + (parseInt(b.approxRowCount, 10) || 0), 0),
  });

  // Metrikos, kurių naujoje schemoje nebėra (failai su >0 žodžių, pjūvis pagal
  // nuskaitymo versiją), išmestos — `filesStats` laiko tik sumas ir būsenų kiekius.
  statistika.nuskaitymas = {
    zodziai: {
      total: counts.zodziuSuma,
      vidurkis: counts.nuskaityti > 0 ? counts.zodziuSuma / counts.nuskaityti : 0,
    },
    puslapiai: counts.puslapiuSuma,
    simboliai: counts.simboliuSuma,
    nuskaityti: counts.nuskaityti,
    klaidos: counts.nuskaitymoKlaidos,
    // „Liko nuskaityti" = visi failai minus jau apdoroti (sėkmingai arba su klaida).
    // Apsaugom nuo neigiamų dėl skaitiklių lenktynių.
    likoNuskaityti: Math.max(
      0,
      counts.visi - counts.nuskaityti - counts.nuskaitymoKlaidos,
    ),
  };
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

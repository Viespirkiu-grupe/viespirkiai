import { postgres } from '@/postgres/postgres.js';
import { Buffer } from 'buffer';
import { DateTime } from 'luxon';

export type Failas = Record<string, any>;

function formatOcrTimestampForVilnius(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const asUtc = DateTime.fromSQL(raw, { zone: 'utc' });
  if (asUtc.isValid) return asUtc.setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');

  const asIsoUtc = DateTime.fromISO(raw.replace(' ', 'T'), { zone: 'utc' });
  if (asIsoUtc.isValid) return asIsoUtc.setZone('Europe/Vilnius').toFormat('yyyy-MM-dd HH:mm:ss');

  return null;
}

export function parseSuffix(raw: string) {
  if (raw.endsWith('.json')) return { value: raw.slice(0, -5), format: 'json' as const };
  if (raw.endsWith('.png')) return { value: raw.slice(0, -4), format: 'png' as const };
  return { value: raw, format: 'html' as const };
}

function decodeQPAttachmentName(name: string) {
  if (!/=\?UTF-8\?Q\?.+\?=/i.test(name)) return name;
  return name.replace(/=\?UTF-8\?Q\?(.+?)\?=/i, (_: string, encoded: string) => {
    const qp = encoded.replace(/_/g, ' ');
    const bytes = qp.replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'binary').toString('utf8');
  });
}

const ORIGINALUS_LINKAI: Record<string, (f: Failas) => { linkas: string | null; pavadinimas: string | null }> = {
  sutartys: (f) => ({ linkas: `https://eviesiejipirkimai.lt/download.php?dok_id=${f.dokId}&file_id=${f.fileId}`, pavadinimas: 'CVP IS' }),
  neskelbiamosDerybos: (f) => ({ linkas: `https://eviesiejipirkimai.lt/${f.saltinioId}`, pavadinimas: 'CVP IS' }),
  archive: (f) => ({ linkas: `/failas/${f.parent}`, pavadinimas: 'Archyvas' }),
  mvpAprasai: () => ({ linkas: `https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_paieska.asp?&Itemid=112`, pavadinimas: 'VPM IS' }),
  cvpIs: (f) => {
    const parts = f.saltinioId.split('/');
    return { linkas: `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${parts[2]}&documentId=${parts[1]}`, pavadinimas: 'CVP IS' };
  },
  cvpp: (f) => {
    const parts = String(f.saltinioId || '').split('/').filter(Boolean);
    const pid = parts.length >= 3 ? parts[0] : null;
    return { linkas: pid ? `https://pirkimai.eviesiejipirkimai.lt/app/rfq/rwlentrance_s.asp?PID=${encodeURIComponent(pid)}&B=PPO` : `https://cvpp.eviesiejipirkimai.lt`, pavadinimas: 'CVPP' };
  },
};

function computeOriginalusLinkas(f: Failas) {
  const key = f.saltinis || 'sutartys';
  return ORIGINALUS_LINKAI[key]?.(f) ?? { linkas: null, pavadinimas: null };
}

function computeSaltinioLinkas(f: Failas): string | null {
  if (f.saltinis === 'sutartys' || !f.saltinis) return `/sutartis/${f.dokId}`;
  if (f.saltinis === 'neskelbiamosDerybos') return `/neskelbiamos`;
  if (f.saltinis === 'archive') return `/failas/${f.parent}`;
  if (f.saltinis === 'mvpAprasai') return `https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_paieska.asp?&Itemid=112`;
  if (f.saltinis === 'cvpIs') return `/viesiejiPirkimai/${f.saltinioId?.split('/')[0]}`;
  if (f.saltinis === 'cvpp') return f.originalusLinkas;
  return null;
}

function computeSaltinioLinkoPavadinimas(f: Failas): string | null {
  if (f.saltinis === 'sutartys' || !f.saltinis) return `Sutartis ${f.dokId}`;
  if (f.saltinis === 'neskelbiamosDerybos') return `Neskelbiamos derybos`;
  if (f.saltinis === 'archive') return `Archyvas ${f.parent}`;
  if (f.saltinis === 'mvpAprasai') return `MVP tvarkos aprašai`;
  if (f.saltinis === 'cvpIs') return `Viešasis pirkimas ${f.saltinioId?.split('/')[0]}`;
  if (f.saltinis === 'cvpp') return `CVPP viešasis pirkimas`;
  return null;
}

const LIBRE_FORMATS = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'xlsb', 'ods', 'ppt', 'pptx', 'ppsx', 'odp', 'odg', 'pub', 'pages', 'xlt', 'dot', 'docm', 'dotx']);
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'gif', 'tif', 'tiff', 'jfif', 'heic', 'webp']);
const ARCHIVE_FORMATS = new Set(['zip', '7z', 'rar', 'adoc']);

function computePreviewType(f: Failas) {
  const ext = f.extension;
  if (ext === 'pdf' || ext === 'prn' || LIBRE_FORMATS.has(ext)) return 'pdf';
  if (ARCHIVE_FORMATS.has(ext) && f.metaduomenys?.filesTree) return 'archive';
  if (ext === 'mp4') return 'mp4';
  if (ext === 'mp3') return 'mp3';
  if (IMAGE_FORMATS.has(ext)) return 'image';
  if (ext === 'url') return 'url';
  if (ext === 'txt') return 'txt';
  if (ext === 'fax' && f.md5 === 'e083b15bc91cd24583955d3493347f7a') return 'fax-special';
  if (['html', 'htm', 'svg'].includes(ext)) return 'html';
  if ((ext === 'eml' || ext === 'msg') && f.metaduomenys) return 'email';
  return 'none';
}

const OCR_STATE_TEXT_MAP: Record<string, string> = {
  '1': 'Baigta',
  '0': 'Rekomenduojama',
  '-1': 'Nepavyko',
  '-3': 'Rezervuota',
  '-6': 'Viršijo bandymus',
};

function normalizeTekstasPerziurai(failas: Failas) {
  let t = failas.tekstas;
  if (Array.isArray(t)) t = t.map((p: any) => String(p ?? '')).join('');
  else if (typeof t === 'string') {
    try {
      const pages = JSON.parse(t);
      if (Array.isArray(pages)) t = pages.map((p: any) => String(p ?? '')).join('');
    } catch {}
  } else if (t != null) t = String(t);
  failas.tekstasPerziurai = (t || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Decorate the entries of an archive (zip/tar/...) with their DB-resident
 * file IDs so the UI can render them as clickable links.
 *
 * When an archive file is OCR'd we store each member individually in `failai`
 * with `parent = <archive id>` and `saltinioId = <member path>`.  The
 * extractor metadata in `metaduomenys.files` knows the paths but not the
 * IDs, so we look them up here and inject `{ id, extension }` onto each
 * matching entry — both the flat `files` array and the recursive
 * `filesTree` structure.
 */
async function resolveArchiveFiles(failas: Failas) {
  if (!failas?.metaduomenys?.files) return;
  const paths = failas.metaduomenys.files.map((f: any) => f.path).filter(Boolean);
  if (!paths.length) return;
  const related = await postgres.query(
    `SELECT * FROM failai WHERE parent = $1 AND "saltinioId" = ANY($2)`,
    [failas.id, paths],
  );
  const relatedFiles = related.rows;
  failas.metaduomenys.files = failas.metaduomenys.files.map((file: any) => {
    if (file.path) {
      const m = relatedFiles.find((f: any) => f.saltinioId === file.path);
      if (m) {
        file.id = m.id;
        if (m.extension) file.extension = m.extension;
      }
    }
    return file;
  });
  const enrichNode = (node: any) => {
    if (node.path) {
      const m = failas.metaduomenys.files.find((f: any) => f.path === node.path);
      if (m) {
        node.id = m.id;
        if (m.extension) node.extension = m.extension;
      }
    }
    node.children?.forEach(enrichNode);
  };
  failas.metaduomenys.filesTree?.forEach(enrichNode);
}

export async function loadFailasById(id: string): Promise<Failas | null> {
  const result = await postgres.query(`SELECT * FROM failai WHERE "id" = $1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

/**
 * Run the full enrichment pipeline on a `failas` row.
 *
 * Steps (in order):
 *   1. Merge in metadata from the file-storage service (`fetchFailasMetadata`).
 *   2. Strip long digit runs from signature DNs (PII redaction).
 *   3. Decode the QP-encoded `attachmentName` if present (`fixHtmlEntities`).
 *   4. Parse the WKB `location` blob into `[lat, lon]` coordinates.
 *   5. Resolve archive children and decorate them with DB IDs.
 *   6. Compute the preview type, OCR-state label, source link, and original
 *      external URL fields used by the UI.
 *
 * Mutates and returns the same object for convenience.
 */
export async function enrichFailas(failas: Failas): Promise<Failas> {
  const { fetchFailasMetadata } = await import('@/modules/failai/aptarnavimas.js');
  failas = { ...failas, ...(await fetchFailasMetadata(failas.id)) };

  if (failas.ocrLatestResult) {
    failas.ocrLatestResult.submitTimestampDisplay = formatOcrTimestampForVilnius(failas.ocrLatestResult.submitTimestamp);
    failas.ocrLatestResult.lockTimestampDisplay = formatOcrTimestampForVilnius(failas.ocrLatestResult.lockTimestamp);
  }
  failas.ocrLockTimestampDisplay = formatOcrTimestampForVilnius(failas.ocrLockTimestamp);

  failas.metaduomenys?.signatures?.forEach((sig: any) => {
    if (sig.signerFullDistinguishedName) {
      sig.signerFullDistinguishedName = sig.signerFullDistinguishedName.replace(/\d{4,}/g, '');
    }
  });
  failas.metaduomenys?.attachments?.forEach((a: any) => { a.name = decodeQPAttachmentName(a.name); });

  if (failas.location) {
    const { parseWKBPoint } = await import('@/modules/geografija/utils.js');
    failas.location = parseWKBPoint(failas.location);
  }

  await resolveArchiveFiles(failas);

  failas.extension = (failas.extension || '').toLowerCase();

  const { linkas, pavadinimas } = computeOriginalusLinkas(failas);
  failas.originalusLinkas = linkas;
  failas.originalusLinkasPavadinimas = pavadinimas;
  failas.saltinioLinkas = computeSaltinioLinkas(failas);
  failas.saltinioLinkoPavadinimas = computeSaltinioLinkoPavadinimas(failas);

  const ocrStateKey = failas.ocrState === null || failas.ocrState === undefined ? null : String(failas.ocrState);
  failas.ocrStateKey = ocrStateKey;
  failas.ocrStateText = ocrStateKey && OCR_STATE_TEXT_MAP[ocrStateKey] ? OCR_STATE_TEXT_MAP[ocrStateKey] : 'Nežinoma';
  failas.hasOcrSection = ocrStateKey !== null || !!failas.ocrLatestResult;
  failas.previewType = computePreviewType(failas);
  failas.isLibreFormat = LIBRE_FORMATS.has(failas.extension);

  if (failas.previewType === 'txt') normalizeTekstasPerziurai(failas);

  return failas;
}

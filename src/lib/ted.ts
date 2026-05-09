import { postgres } from '@/postgres/postgres.js';
import { buildTedNoticeViewModel } from '@/modules/ted/viewer.js';
import { readFileSync } from 'fs';
import { join } from 'path';

function getTedSamplesDir() {
  return join(process.cwd(), 'modules', 'ted', 'samples');
}

export function isTedDbId(id: string) {
  return /^\d+-\d{4}$/.test(id);
}

export function loadTedSampleNotice(id: string) {
  try {
    const samplePath = join(getTedSamplesDir(), `${id}.xml`);
    const sampleXml = readFileSync(samplePath, 'utf-8');
    return buildTedNoticeViewModel(sampleXml);
  } catch {
    return null;
  }
}

export function loadTedSampleXml(id: string) {
  try {
    const samplePath = join(getTedSamplesDir(), `${id}.xml`);
    return readFileSync(samplePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function loadTedDbNotice(id: string) {
  if (!isTedDbId(id)) return null;

  const result = await postgres.query(
    `SELECT * FROM "tedNotices" WHERE "tedNoticeNumber" = $1;`,
    [id],
  );

  if (result.rowCount === 0) return null;

  const notice = result.rows[0];
  if (!notice?.scrapeStatus || !notice?.turinys || notice.scrapeStatus < 1) {
    return null;
  }

  return notice;
}

export async function loadTedNoticePageData(id: string) {
  if (isTedDbId(id)) {
    const dbNotice = await loadTedDbNotice(id);
    if (!dbNotice) return null;

    return {
      noticeId: id,
      view: buildTedNoticeViewModel(dbNotice.turinys),
      raw: dbNotice,
      isSample: false,
    };
  }

  const sampleView = loadTedSampleNotice(id);
  if (!sampleView) return null;

  return {
    noticeId: id,
    view: sampleView,
    raw: null,
    isSample: true,
  };
}

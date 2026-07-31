/**
 * Paleistos versijos (commit'o) informacija footer'iui.
 *
 * Hash'as ieškomas trimis būdais, nes veikiame ir iš repozitorijos, ir iš
 * Docker image'o:
 *   1. `GIT_COMMIT` (arba `GIT_SHA` / `SOURCE_COMMIT`) aplinkos kintamasis —
 *      leidžia perrašyti reikšmę nieko neperstatant.
 *   2. Vietinis `.git` — dev / `npm start` iš checkout'o. Pirmenybė prieš
 *      `build-info.json`, kad dev'e nerodytų pasenusio build'o hash'o.
 *   3. `build-info.json` — sugeneruotas per `npm run build`
 *      (`scripts/writeBuildInfo.mjs`) ir įkeptas į image'ą. Tai įprastas kelias
 *      produkcijoje, kur `.git` nėra.
 * Neradus nieko, footer'is versijos eilutės tiesiog nerodo.
 */
import { readFileSync } from 'node:fs';
import { commitFromEnv, commitFromGitDir } from '@/utils/gitCommit.js';

const REPO_URL = 'https://github.com/Viespirkiu-grupe/viespirkiai';

export interface BuildInfo {
  /** Pilnas commit'o hash'as. */
  commit: string;
  /** Trumpasis hash'as rodymui. */
  shortCommit: string;
  /** Nuoroda į commit'ą GitHub'e. */
  commitUrl: string;
}

function commitFromFile(): string | null {
  try {
    const raw = JSON.parse(readFileSync('build-info.json', 'utf8')) as { commit?: unknown };
    return typeof raw.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(raw.commit)
      ? raw.commit.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function resolve(): BuildInfo | null {
  const commit = commitFromEnv() ?? commitFromGitDir() ?? commitFromFile();
  if (!commit) return null;
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    commitUrl: `${REPO_URL}/commit/${commit}`,
  };
}

/** Nustatoma vieną kartą – proceso gyvavimo metu commit'as nesikeičia. */
const buildInfo: BuildInfo | null = resolve();

export default buildInfo;

/**
 * Paleistos versijos (commit'o) informacija footer'iui.
 *
 * Hash'as ieškomas dviem būdais, nes veikiame ir iš repozitorijos, ir iš
 * Docker image'o:
 *   1. `GIT_COMMIT` (arba `GIT_SHA` / `SOURCE_COMMIT`) aplinkos kintamasis —
 *      taip paduodama container'yje: `.dockerignore` išmeta `.git`, tad build
 *      metu git'o ten paprasčiausiai nėra (žr. Dockerfile `ARG GIT_COMMIT` ir
 *      GitHub Actions `build-args`).
 *   2. `git rev-parse HEAD` — dev/`npm start` iš checkout'o.
 * Neradus nieko, footer'is versijos eilutės tiesiog nerodo.
 */
import { execFileSync } from 'node:child_process';

const REPO_URL = 'https://github.com/Viespirkiu-grupe/viespirkiai';

const ENV_KEYS = ['GIT_COMMIT', 'GIT_SHA', 'SOURCE_COMMIT'] as const;

export interface BuildInfo {
  /** Pilnas (arba toks, koks paduotas) commit'o hash'as. */
  commit: string;
  /** Trumpasis hash'as rodymui. */
  shortCommit: string;
  /** Nuoroda į commit'ą GitHub'e. */
  commitUrl: string;
}

function isHash(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function commitFromEnv(): string | null {
  for (const key of ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value && isHash(value)) return value.toLowerCase();
  }
  return null;
}

function commitFromGit(): string | null {
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    return isHash(value) ? value : null;
  } catch {
    return null;
  }
}

function resolve(): BuildInfo | null {
  const commit = commitFromEnv() ?? commitFromGit();
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

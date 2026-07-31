// Po `astro build` įrašo `build-info.json` su commit'o hash'u, kad paleista
// versija būtų žinoma ir be `.git` (Docker runtime image'e jo nėra – ten
// nukopijuojamas tik šis failas). Reikšmė imama iš `GIT_COMMIT` aplinkos
// kintamojo arba tiesiai iš `.git` (build kontekste palikti tik HEAD ir refs,
// žr. `.dockerignore`). Neradus – įrašomas `null` ir footeris versijos nerodo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCommit } from '../utils/gitCommit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = resolveCommit(root);

fs.writeFileSync(
  path.join(root, 'build-info.json'),
  `${JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)}\n`,
);

console.log(commit ? `build-info.json: ${commit}` : 'build-info.json: commit nerastas');

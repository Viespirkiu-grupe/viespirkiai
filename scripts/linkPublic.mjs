// Po `astro build` sukuria symlink'us dist/client/<įrašas> -> ../../public/<įrašas>,
// kad standalone serveris statinius failus tiektų tiesiai iš public/ ir nereikėtų
// kopijuoti ~34MB į dist. _astro (sugeneruoti bundle'iai) lieka realus dist/client viduje.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const clientDir = path.join(root, 'dist', 'client');

fs.mkdirSync(clientDir, { recursive: true });

let count = 0;
for (const entry of fs.readdirSync(publicDir)) {
  const target = path.join(clientDir, entry);
  fs.rmSync(target, { recursive: true, force: true });
  // Reliatyvus symlink'as, kad veiktų nepriklausomai nuo absoliutaus kelio
  fs.symlinkSync(path.join('..', '..', 'public', entry), target);
  count++;
}

console.log(`linkPublic: sukurta ${count} symlink'ų dist/client -> public/`);

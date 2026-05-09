import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const distCpvJsonPath = path.join(process.cwd(), 'dist/client/dist/cpv.json');
const publicCpvJsonPath = path.join(process.cwd(), 'public/dist/cpv.json');
const cpvJsonPath = existsSync(distCpvJsonPath) ? distCpvJsonPath : publicCpvJsonPath;
const body = readFileSync(cpvJsonPath, 'utf-8');

export async function GET() {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

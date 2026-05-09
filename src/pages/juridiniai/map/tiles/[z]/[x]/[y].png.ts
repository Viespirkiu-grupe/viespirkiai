import type { APIRoute } from 'astro';
import { postgres } from '@/postgres/postgres.js';
import { Worker } from 'worker_threads';
import path from 'path';

const TILE_SIZE = 256;
const OVERSAMPLE = 4;

const TILE_WORKER_PATH = path.resolve(process.cwd(), 'utils/tileWorker.js');

function renderTile(rows: object[], opts: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(TILE_WORKER_PATH, { workerData: { rows, ...opts } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Tile worker exited with code ${code}`));
    });
  });
}

export const GET: APIRoute = async ({ params }) => {
  const z = parseInt(params.z!);
  const x = parseInt(params.x!);
  const y = parseInt(params.y!);

  const scale = 2 ** OVERSAMPLE;
  const minTileX = x * scale;
  const maxTileX = minTileX + scale - 1;
  const minTileY = y * scale;
  const maxTileY = minTileY + scale - 1;

  const { rows } = await postgres.query(
    `SELECT "tileX", "tileY", "pointCount"
     FROM public."jarCsvLocationTiles"
     WHERE "zoom" = $1 AND "tileX" BETWEEN $2 AND $3 AND "tileY" BETWEEN $4 AND $5`,
    [z + OVERSAMPLE, minTileX, maxTileX, minTileY, maxTileY],
  );

  const buffer = await renderTile(rows, { TILE_SIZE, scale, minTileX, minTileY });

  return new Response(buffer as any, {
    headers: { 'Content-Type': 'image/png' },
  });
};

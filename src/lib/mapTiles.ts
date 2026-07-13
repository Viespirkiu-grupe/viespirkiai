import { postgres } from '@/postgres/postgres.js';

// Heatmap tile data source. The client renders these cells into a <canvas>
// identically to the old server-side PNG worker (see git history:
// utils/tileWorker.js). We oversample each served 256px tile into a 16×16 grid
// of finer buckets pulled from zoom `z + OVERSAMPLE`.
export const TILE_SIZE = 256;
export const OVERSAMPLE = 4;
export const SCALE = 2 ** OVERSAMPLE; // 16 sub-cells per axis

// One heatmap cell as [dx, dy, count] where dx/dy are the sub-cell offsets
// (0..SCALE-1) within the requested tile.
export type TileCell = [number, number, number];

// Allowed table names — kept as a whitelist so the interpolated identifier can
// never come from user input.
const TILE_TABLES = {
  jar: 'jarCsvLocationTiles',
  dokumentai: 'dokumentaiLocationTiles',
} as const;

export type TileTableKey = keyof typeof TILE_TABLES;

export async function fetchTileCells(
  table: TileTableKey,
  z: number,
  x: number,
  y: number,
): Promise<TileCell[]> {
  const minTileX = x * SCALE;
  const maxTileX = minTileX + SCALE - 1;
  const minTileY = y * SCALE;
  const maxTileY = minTileY + SCALE - 1;

  const { rows } = await postgres.query(
    `SELECT "tileX", "tileY", "pointCount"
     FROM public."${TILE_TABLES[table]}"
     WHERE "zoom" = $1 AND "tileX" BETWEEN $2 AND $3 AND "tileY" BETWEEN $4 AND $5`,
    [z + OVERSAMPLE, minTileX, maxTileX, minTileY, maxTileY],
  );

  return rows.map((r): TileCell => [
    r.tileX - minTileX,
    r.tileY - minTileY,
    r.pointCount,
  ]);
}

import { documentTileCells } from '@/modules/documents/quickwitMap.js';

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

export type TileTableKey = 'dokumentai';

/**
 * Langelius skaičiuoja Quickwit `terms` agregacija per Morton raktus
 * (`geo.zN`), kaip juridiniams. Anksčiau tam buvo iš anksto sudaroma
 * `dokumentaiLocationTiles` lentelė, kurią atnaujindavo trigeris prie kiekvieno
 * iš 8,3 mln. įrašų — nors koordinates turi mažiau nei 0,1 % dokumentų.
 *
 * Svarbiausia nauda ne greitis, o tai, kad agregacija paklūsta paieškos
 * užklausai: žemėlapis rodo filtruotą rinkinį, o ne visada visus dokumentus.
 */
export async function fetchTileCells(
  _table: TileTableKey,
  z: number,
  x: number,
  y: number,
  query = '*',
): Promise<TileCell[]> {
  return documentTileCells(query, z, x, y) as Promise<TileCell[]>;
}

import { searchIndexPattern } from "../../quickwit/qwHttp.js";
import { decodeMorton, mortonTileKey } from "../../quickwit/morton.js";

/*
Žemėlapio langeliai iš Quickwit `geo.zN` Morton raktų.

Veidrodis modules/juridiniai/quickwitMap.js. Esminis skirtumas nuo anksčiau
naudotos DB lentelės: agregacija vykdoma kartu su paieškos užklausa, tad
šiluminis žemėlapis rodo būtent filtruotą rinkinį, o ne visus dokumentus.
*/

const INDEX_PATTERN = "documents_*";

// Vienas 256px langelis piešiamas kaip 16×16 tinklelis, t. y. keturiais zoom
// lygiais smulkiau. Turi sutapti su src/lib/mapTiles.ts OVERSAMPLE.
const OVERSAMPLE = 4;
const SCALE = 2 ** OVERSAMPLE;
const MAX_TILE_ZOOM = 15;

/**
 * @param {string} query - Quickwit užklausa („*" – be filtro).
 * @param {number} zoom @param {number} tileX @param {number} tileY
 * @returns {Promise<Array<[number, number, number]>>} [dx, dy, kiekis]
 */
export async function documentTileCells(query, zoom, tileX, tileY) {
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_TILE_ZOOM) return [];

    const targetZoom = zoom + OVERSAMPLE;
    const minX = tileX * SCALE;
    const minY = tileY * SCALE;

    // Apribojam tėviniu langeliu: taip agregacija skaičiuoja tik šio langelio
    // taškus, o ne viso pasaulio.
    const parentKey = mortonTileKey(tileX, tileY, zoom);
    const scope = `geo.z${zoom}:${parentKey}`;
    const scoped = !query || query === "*" ? scope : `(${query}) AND ${scope}`;

    const data = await searchIndexPattern(INDEX_PATTERN, {
        query: scoped,
        max_hits: 0,
        aggs: {
            cells: { terms: { field: `geo.z${targetZoom}`, size: SCALE * SCALE } },
        },
        format: "json",
    });

    const buckets = data?.aggregations?.cells?.buckets ?? [];
    return buckets
        .map((bucket) => {
            const { x, y } = decodeMorton(bucket.key, targetZoom);
            return [x - minX, y - minY, Number(bucket.doc_count)];
        })
        .filter(([dx, dy]) => dx >= 0 && dx < SCALE && dy >= 0 && dy < SCALE);
}

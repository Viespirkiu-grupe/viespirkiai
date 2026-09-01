import { toNumber } from "../utils/coerce.js";

/*
Web Mercator langelių ir Morton raktų skaičiavimas žemėlapio agregacijoms.

Vietoj iš anksto suskaičiuotos langelių lentelės DB, taškas indeksuojant gauna
po raktą kiekvienam zoom lygiui (z0..z19). Tada žemėlapio langelius grąžina
paprasta Quickwit `terms` agregacija, o svarbiausia – ji paklūsta tai pačiai
paieškos užklausai, tad šiluminis žemėlapis rodo būtent filtruotą rinkinį.

Tą patį principą naudoja juridiniai (modules/juridiniai/quickwitMap.js); ten
tebėra sava šių funkcijų kopija, kurią verta būtų suvienodinti su šia.
*/

export const MAX_ZOOM = 19;
const MAX_MERCATOR_LAT = 85.0511287798066;

/** Taškas → to zoom lygio langelio koordinatės. */
export function webMercatorTile(lat, lon, zoom) {
    const n = 2 ** zoom;
    const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
    const latRad = (clampedLat * Math.PI) / 180;
    const x = Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
    const y = Math.max(
        0,
        Math.min(
            n - 1,
            Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n),
        ),
    );
    return { x, y };
}

/**
 * x bitai rašomi į lygines, y bitai — į nelygines pozicijas.
 * Iki z19 rezultatas telpa į tiksliai JS atvaizduojamą ir Quickwit i64 skaičių.
 */
export function mortonTileKey(x, y, zoom) {
    let key = 0n;
    const bx = BigInt(x);
    const by = BigInt(y);
    for (let bit = 0n; bit < BigInt(zoom); bit++) {
        key |= ((bx >> bit) & 1n) << (2n * bit);
        key |= ((by >> bit) & 1n) << (2n * bit + 1n);
    }
    return Number(key);
}

/** Atvirkštinis veiksmas: Morton raktas → langelio koordinatės. */
export function decodeMorton(key, zoom) {
    let x = 0n;
    let y = 0n;
    const value = BigInt(key);
    for (let bit = 0n; bit < BigInt(zoom); bit++) {
        x |= ((value >> (2n * bit)) & 1n) << bit;
        y |= ((value >> (2n * bit + 1n)) & 1n) << bit;
    }
    return { x: Number(x), y: Number(y) };
}

/**
 * Indeksuojamo dokumento `geo` laukas: koordinatės ir po Morton raktą
 * kiekvienam zoom lygiui.
 *
 * @returns {Record<string, number> | null}
 */
export function buildGeo(latValue, lonValue) {
    const lat = toNumber(latValue);
    const lon = toNumber(lonValue);
    if (lat == null || lon == null) return null;

    /** @type {Record<string, number>} */
    const geo = { lat, lon };
    for (let zoom = 0; zoom <= MAX_ZOOM; zoom++) {
        const { x, y } = webMercatorTile(lat, lon, zoom);
        geo[`z${zoom}`] = mortonTileKey(x, y, zoom);
    }
    return geo;
}

/**
 * Bendras eilučių kiekis toje pačioje užklausoje, be atskiro `SELECT COUNT(*)`.
 *
 * Lango funkcija skaičiuojama prieš `LIMIT`, todėl `_viso` visada rodo visą
 * atitikmenų kiekį, o ne grąžintų eilučių. Tarnybinis stulpelis iš rezultato
 * pašalinamas, kad nenutekėtų į API atsakymus (`{...row}` spread'us).
 */
export const WINDOW_COUNT_SQL = `COUNT(*) OVER () AS "_viso"`;

/**
 * @template {Record<string, any>} T
 * @param {T[]} rows
 * @returns {{ rows: T[], viso: number }}
 */
export function splitWindowCount(rows) {
    if (!rows || rows.length === 0) return { rows: rows ?? [], viso: 0 };
    const viso = Number(rows[0]._viso) || 0;
    return {
        rows: rows.map(({ _viso, ...likusieji }) => /** @type {T} */ (likusieji)),
        viso,
    };
}

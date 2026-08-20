// „Suma laikyti" (`sumaBaze`) — ką sutarčių paieškoje laikom sutarties suma:
//   auto (numatytoji) — faktinę, o jos nesant numatytą (`COALESCE`, kaip iki šiol);
//   faktine           — tik faktinę įvykdymo vertę (be jos sutartys į rėžį nepatenka);
//   numatoma          — tik numatytą (sudarant sutartį) vertę.
// Pasirinkimas veikia „Suma nuo/iki" filtrą, rikiavimą pagal sumą, histogramą,
// bendros vertės agregatą ir kortelėje rodomą sumą — visur ta pati bazė.
//
// Stulpelių vardai: Postgres lentelėje `numatomaVerte` / `faktineVerte` /
// `verte` (generuotas COALESCE), o eilutės (ir Quickwit) laukuose atitinkamai
// `verte` / `faktineIvykdimoVerte` / `suma`.

/** @typedef {{ raktas: string, label: string, pg: string, pgAlias: string, qw: string }} VerteBaze */

/** @type {Record<string, VerteBaze>} */
export const SUMA_BAZES = {
    auto: {
        raktas: "auto",
        label: "Faktinę arba numatytą",
        pg: `s.verte`,
        pgAlias: "suma",
        qw: "suma",
    },
    faktine: {
        raktas: "faktine",
        label: "Tik faktinę",
        pg: `s."faktineVerte"`,
        pgAlias: "faktineIvykdimoVerte",
        qw: "faktineIvykdimoVerte",
    },
    numatoma: {
        raktas: "numatoma",
        label: "Tik numatytą",
        pg: `s."numatomaVerte"`,
        pgAlias: "verte",
        qw: "verte",
    },
};

/** Užklausos parametrų reikšmės, kurias priimam (kitos → `auto`). */
export const SUMA_BAZES_ENUM = Object.fromEntries(
    Object.keys(SUMA_BAZES)
        .filter((k) => k !== "auto")
        .map((k) => [k, k]),
);

/**
 * Grąžina pasirinktą vertės bazę (nežinoma / nenurodyta → `auto`).
 * @param {object} [query]
 * @returns {VerteBaze}
 */
export function sumaBaze(query) {
    return SUMA_BAZES[query?.sumaBaze] ?? SUMA_BAZES.auto;
}

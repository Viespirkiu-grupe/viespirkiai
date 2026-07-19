/**
 * Sutarčių heatmap — PIXEL'IŲ rezoliucija.
 *
 * X ašis: 1 px per dieną, 2014-01-01 .. 2027-12-31 (keliamuosius metus
 *         atskiriame natūraliai: 11×365 + 3×366 = 5113 px).
 * Y ašis: log10 simetriška:
 *           suma ≥  1€  → u =  log10(suma)   ∈ [0, 8]
 *           suma ≤ -1€  → u = -log10(-suma)  ∈ [-3, 0]
 *           kitaip      → u =  0
 *         Iš viso 11 dekadų (-3..+8). Aukštis parinktas, kad horizontas:vertikalė ≈ 3:1.
 *
 * Visi agregavimai vyksta DB. JSON saugoma sparse forma (tik ne-nuliniai px).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { postgres } from "../../postgres/postgres.js";

const DATE_START = "2014-01-01";
const DATE_END   = "2028-01-01";   // pusiau atviras
const U_MIN = -3;                  // -1000 €
const U_MAX =  8;                  // 100 000 000 €
const ASPECT = 3;                  // horizontas : vertikalė

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "heatmap.json");

function daysBetween(aIso, bIso) {
    const a = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10));
    const b = Date.UTC(+bIso.slice(0, 4), +bIso.slice(5, 7) - 1, +bIso.slice(8, 10));
    return Math.round((b - a) / 86400000);
}

async function main() {
    const width  = daysBetween(DATE_START, DATE_END);              // 5113
    const nDec   = U_MAX - U_MIN;                                  // 11
    const pxPerDec = Math.round(width / ASPECT / nDec);            // ~155
    const height = pxPerDec * nDec;                                // ~1705

    console.log(
        `Tinklas: ${width} × ${height} px ` +
        `(aspect ${(width / height).toFixed(2)}:1, ${pxPerDec} px/dekadą)`,
    );

    const sql = `
        WITH src AS (
            SELECT
                ("sudarymoData"::date - DATE '${DATE_START}')::int AS x,
                CASE
                    WHEN verte >=  1 THEN  log(verte)
                    WHEN verte <= -1 THEN -log(-verte)
                    ELSE 0
                END AS u
            FROM "vpmSutartys"
            WHERE "sudarymoData" >= DATE '${DATE_START}'
              AND "sudarymoData" <  DATE '${DATE_END}'
              AND verte IS NOT NULL
              AND istrinta = false
        ), mapped AS (
            SELECT
                x,
                GREATEST(0, LEAST(${height - 1},
                    ${height - 1} - round((u - (${U_MIN})) * ${pxPerDec})::int
                )) AS y
            FROM src
            WHERE x >= 0 AND x < ${width}
        )
        SELECT x, y, count(*)::int AS n
        FROM mapped
        GROUP BY x, y
    `;

    const t0 = Date.now();
    const { rows } = await postgres.query(sql);
    console.log(`DB: ${rows.length} ne-nuliniai pikseliai per ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

    // Sparse: trys paralelūs Int32 srautai → kompaktiškas JSON
    const xs = new Array(rows.length);
    const ys = new Array(rows.length);
    const ns = new Array(rows.length);
    let total = 0;
    let maxCell = 0;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        xs[i] = r.x; ys[i] = r.y; ns[i] = r.n;
        total += r.n;
        if (r.n > maxCell) maxCell = r.n;
    }

    const out = {
        dateStart: DATE_START,
        dateEnd: DATE_END,
        width,
        height,
        pxPerDecade: pxPerDec,
        uMin: U_MIN,
        uMax: U_MAX,
        totalRows: total,
        maxCell,
        xs, ys, ns,
    };
    writeFileSync(OUT_PATH, JSON.stringify(out));
    console.log(`→ ${OUT_PATH} (${total} sutarčių, maks. ląstelėje ${maxCell}).`);
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => postgres.end());

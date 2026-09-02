import { postgres } from "../../postgres/postgres.js";

// Parenka vieną aktyvią reklamą nurodytai vietai ('sutartys' | 'viesiejiPirkimai').
// Parinkimas – svertinis atsitiktinis: `random() ^ (1/svoris)` (A-Res algoritmas),
// didesnis `svoris` => didesnė tikimybė būti parinktam. Klaidos atveju (pvz.
// lentelės dar nėra) grąžina null, kad paieškos puslapis nelūžtų.
export async function pickReklama(vieta) {
    try {
        const { rows } = await postgres.query(
            `SELECT "id", "tipas", "antraste", "tekstas", "mygtukoTekstas", "nuoroda"
               FROM viespirkiai."reklamos"
              WHERE "aktyvi" = true
                AND $1 = ANY("vietos")
                AND ("rodytiNuo" IS NULL OR "rodytiNuo" <= now())
                AND ("rodytiIki" IS NULL OR "rodytiIki" >= now())
              ORDER BY random() ^ (1.0 / GREATEST("svoris", 1)) DESC
              LIMIT 1`,
            [vieta],
        );
        return rows[0] ?? null;
    } catch (err) {
        console.error("pickReklama nepavyko:", err.message);
        return null;
    }
}

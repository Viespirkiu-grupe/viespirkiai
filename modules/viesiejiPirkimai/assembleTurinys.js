import { postgres } from "../../postgres/postgres.js";

// Boolean Keys stulpeliai atkuriami atgal į „Taip“/„Ne“, kad UI ir MCP išvestis
// nesikeistų lyginant su buvusiu jsonb turiniu.
const BOOL_KEYS = new Set([
    "eAukcionuSukurimas",
    "leidziamaPateiktisAlternatyviusPasiulymus",
    "pirkimasSkaidomasIDaliuDPSIKategorijas",
    "pirkimasSkaidomasIKategorijadalisDPSIKategorijas",
    "leistiTiekejamsSistemojePareikstiSusidomejima",
    "dokumentuIkelimasSuPaaiskinimais",
    "galimaPateiktiKelisPasiulymus",
    "laimetojoNustatymasKiekvienamObjektui",
]);

/**
 * Atkuria `turinys`-formos objektą iš reliacinių lentelių (Keys/Dalys/Failai/
 * FailuVersijos/Skelbimai). Pakeičia buvusį jsonb stulpelį — grąžinamas objektas
 * suderinamas su komponentais ir MCP išvestimi.
 *
 * @param {string} pirkimoId
 * @returns {Promise<Record<string, any>>}
 */
export async function assembleTurinys(pirkimoId) {
    const [keysRes, dalysRes, failaiRes, versijosRes, skelbimaiRes] =
        await Promise.all([
            postgres.query(
                `SELECT * FROM public."viesiejiPirkimaiKeys" WHERE "pirkimoId" = $1`,
                [pirkimoId],
            ),
            postgres.query(
                `SELECT "rusis", "numeris", "pavadinimas"
                 FROM public."viesiejiPirkimaiDalys"
                 WHERE "pirkimoId" = $1 ORDER BY "rusis", "numeris"`,
                [pirkimoId],
            ),
            postgres.query(
                `SELECT * FROM public."viesiejiPirkimaiFailai"
                 WHERE "pirkimoId" = $1 ORDER BY "id"`,
                [pirkimoId],
            ),
            postgres.query(
                `SELECT v.* FROM public."viesiejiPirkimaiFailuVersijos" v
                 JOIN public."viesiejiPirkimaiFailai" f ON f."id" = v."failasId"
                 WHERE f."pirkimoId" = $1 ORDER BY v."id"`,
                [pirkimoId],
            ),
            postgres.query(
                `SELECT "tipas", "downloadHref", "externalId", "isLinked",
                        "ikelimoData", "kalba", "statusas", "paskelbimoData"
                 FROM public."viesiejiPirkimaiSkelbimai"
                 WHERE "pirkimoId" = $1 ORDER BY "id"`,
                [pirkimoId],
            ),
        ]);

    const turinys = {};

    // Keys skaliarai
    const keys = keysRes.rows[0];
    if (keys) {
        for (const [col, val] of Object.entries(keys)) {
            if (col === "pirkimoId" || col === "turinysHash") continue;
            if (val == null) continue;
            turinys[col] = BOOL_KEYS.has(col) ? (val ? "Taip" : "Ne") : val;
        }
    }

    // Failai (+ versijos)
    const versijosByFailas = new Map();
    for (const v of versijosRes.rows) {
        const list = versijosByFailas.get(v.failasId) ?? [];
        const { id, failasId, ...rest } = v;
        list.push(rest);
        versijosByFailas.set(v.failasId, list);
    }
    turinys.failai = failaiRes.rows.map((f) => {
        const { id, pirkimoId: _pid, ...rest } = f;
        return { ...rest, versijos: versijosByFailas.get(id) ?? [] };
    });

    // Skelbimai
    turinys.skelbimai = skelbimaiRes.rows;

    // Dalys (suvienodinta struktūra)
    turinys.dalys = dalysRes.rows;

    return turinys;
}

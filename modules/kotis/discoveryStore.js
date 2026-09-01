import { postgres } from "../../postgres/postgres.js";

const REQUIRED_TABLES = [
    'kotis."pagalbos"',
    'kotis."saltinioIrasai"',
    'kotis."importai"',
];

function errorText(error) {
    return String(error?.stack || error?.message || error).slice(0, 20_000);
}

export async function assertKotisQueueSchema(db = postgres) {
    const { rows } = await db.query(
        `SELECT name, to_regclass(name) AS relation FROM unnest($1::text[]) name`,
        [REQUIRED_TABLES],
    );
    const missing = rows.filter((row) => !row.relation).map((row) => row.name);
    const columns = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'kotis' AND table_name = 'saltinioIrasai'
           AND column_name = ANY($1)`,
        [["atradimoVersija", "apdorotaAtradimoVersija", "claimToken"]],
    );
    if (missing.length || columns.rows.length !== 3) {
        throw new Error(`Trūksta KOTIS V4 DB objektų: ${missing.join(", ") || "eilės stulpeliai"}`);
    }
}

export async function cancelStaleDiscoveries(db = postgres) {
    await db.query(
        `UPDATE kotis."importai" SET "busena" = 'cancelled', "baigta" = now(),
            "klaida" = coalesce("klaida", 'Sąrašo procesas nutrūko neužbaigęs importo')
         WHERE "busena" = 'running'`,
    );
}

export async function createDiscovery({ mode, from, to }, db = postgres) {
    const { rows } = await db.query(
        `INSERT INTO kotis."importai" (
            "rezimas", "nuoDatos", "ikiDatos", "concurrency", "dienuSkaicius", "meta"
         ) VALUES ($1, $2, $3, 1, ($3::date - $2::date) + 1, '{"etapas":"sarasoAtradimas"}')
         RETURNING "id"`,
        [mode, from, to],
    );
    return Number(rows[0].id);
}

export async function storeDiscoveredPage(importId, page, records, db = postgres) {
    if (!records.length) return;
    const payload = records.map((row, index) => ({
        pagalbosId: row.id,
        url: row.url,
        suteikimoData: row.suteikimoData,
        gavejas: row.gavejas,
        teikejas: row.teikejas,
        suma: row.suma,
        teisinisPagrindas: row.teisinisPagrindas,
        pagalbosRusis: row.pagalbosRusis,
        busena: row.busena,
        puslapis: page,
        eilesNumeris: index + 1,
    }));
    await db.query(
        `INSERT INTO kotis."saltinioIrasai" AS s (
            "pagalbosId", "url", "busena", "nuskaitytas",
            "sarasoSuteikimoData", "sarasoGavejas", "sarasoTeikejas", "sarasoSuma",
            "sarasoTeisinisPagrindas", "sarasoPagalbosRusis", "sarasoBusena",
            "sarasoPuslapis", "sarasoEilesNumeris", "paskutinioAtradimoImportoId"
         ) SELECT x."pagalbosId", x."url", 'visible', NULL,
              x."suteikimoData", x."gavejas", x."teikejas", x."suma",
              x."teisinisPagrindas", x."pagalbosRusis", x."busena",
              x."puslapis", x."eilesNumeris", $1
         FROM jsonb_to_recordset($2::jsonb) AS x(
            "pagalbosId" bigint, "url" text, "suteikimoData" date,
            "gavejas" text, "teikejas" text, "suma" numeric,
            "teisinisPagrindas" text, "pagalbosRusis" text, "busena" text,
            "puslapis" integer, "eilesNumeris" integer
         ) ON CONFLICT ("pagalbosId") DO UPDATE SET
            "atradimoVersija" = s."atradimoVersija" + CASE WHEN
                (s."url", s."sarasoSuteikimoData", s."sarasoGavejas", s."sarasoTeikejas",
                 s."sarasoSuma", s."sarasoTeisinisPagrindas", s."sarasoPagalbosRusis",
                 s."sarasoBusena", s."busena") IS DISTINCT FROM
                (EXCLUDED."url", EXCLUDED."sarasoSuteikimoData", EXCLUDED."sarasoGavejas",
                 EXCLUDED."sarasoTeikejas", EXCLUDED."sarasoSuma",
                 EXCLUDED."sarasoTeisinisPagrindas", EXCLUDED."sarasoPagalbosRusis",
                 EXCLUDED."sarasoBusena", 'visible'::kotis."saltinioBusena")
                THEN 1 ELSE 0 END,
            "url" = EXCLUDED."url", "busena" = 'visible',
            "sarasoSuteikimoData" = EXCLUDED."sarasoSuteikimoData",
            "sarasoGavejas" = EXCLUDED."sarasoGavejas", "sarasoTeikejas" = EXCLUDED."sarasoTeikejas",
            "sarasoSuma" = EXCLUDED."sarasoSuma",
            "sarasoTeisinisPagrindas" = EXCLUDED."sarasoTeisinisPagrindas",
            "sarasoPagalbosRusis" = EXCLUDED."sarasoPagalbosRusis",
            "sarasoBusena" = EXCLUDED."sarasoBusena", "sarasoPuslapis" = EXCLUDED."sarasoPuslapis",
            "sarasoEilesNumeris" = EXCLUDED."sarasoEilesNumeris",
            "paskutinioAtradimoImportoId" = $1, "paskutiniKartaMatytas" = now(),
            "saltinyjeNebematomasNuo" = NULL`,
        [importId, JSON.stringify(payload)],
    );
}

export async function finishDiscovery(importId, { count = 0, error = null } = {}, db = postgres) {
    if (!error) {
        await db.query(
            `UPDATE kotis."saltinioIrasai" s SET "busena" = 'missing',
                "saltinyjeNebematomasNuo" = coalesce("saltinyjeNebematomasNuo", now())
             FROM kotis."importai" i
             WHERE i."id" = $1
               AND i."rezimas" = 'fullReconcile'
               AND i."nuoDatos" <= DATE '2016-01-01' AND i."ikiDatos" >= current_date
               AND s."paskutinioAtradimoImportoId" IS DISTINCT FROM i."id"
               AND s."busena" = 'visible'`,
            [importId],
        );
    }
    await db.query(
        `UPDATE kotis."importai" SET "busena" = $2::kotis."importoBusena", "baigta" = now(),
            "nuskaitytuIrasuSkaicius" = $3, "klaida" = $4,
            "pavykusiuDienuSkaicius" = CASE WHEN $4::text IS NULL THEN "dienuSkaicius" ELSE 0 END,
            "nepavykusiuDienuSkaicius" = CASE WHEN $4::text IS NULL THEN 0 ELSE "dienuSkaicius" END
         WHERE "id" = $1`,
        [importId, error ? "failed" : "succeeded", count, error ? errorText(error) : null],
    );
}

import { randomUUID } from "node:crypto";
import { postgres } from "../../postgres/postgres.js";

export async function claimDetail({ maxAttempts = 10, leaseMinutes = 30 } = {}, db = postgres) {
    const token = randomUUID();
    const { rows } = await db.query(
        `WITH candidate AS (
            SELECT "pagalbosId" FROM kotis."saltinioIrasai"
            WHERE "busena" = 'visible'
              AND "apdorotaAtradimoVersija" < "atradimoVersija"
              AND ("kitasBandymas" IS NULL OR "kitasBandymas" <= now())
              AND ("claimToken" IS NULL OR "claimIki" <= now())
              AND "nesekminguBandymuSkaicius" < $1
            ORDER BY "sarasoSuteikimoData" DESC NULLS LAST, "pagalbosId"
            FOR UPDATE SKIP LOCKED LIMIT 1
         ) UPDATE kotis."saltinioIrasai" s SET
            "claimToken" = $2, "claimIki" = now() + make_interval(mins => $3),
            "bandymuSkaicius" = "bandymuSkaicius" + 1
         FROM candidate WHERE s."pagalbosId" = candidate."pagalbosId"
         RETURNING s.*`,
        [maxAttempts, token, leaseMinutes],
    );
    return rows[0] ?? null;
}

export async function failDetail(job, error, db = postgres) {
    const message = String(error?.stack || error?.message || error).slice(0, 20_000);
    await db.query(
        `UPDATE kotis."saltinioIrasai" SET
            "claimToken" = NULL, "claimIki" = NULL,
            "nesekminguBandymuSkaicius" = "nesekminguBandymuSkaicius" + 1,
            "kitasBandymas" = now() + make_interval(secs => LEAST(
                86400, 30 * power(2, LEAST("nesekminguBandymuSkaicius", 11))::integer
            )), "paskutineKlaida" = $3
         WHERE "pagalbosId" = $1 AND "claimToken" = $2`,
        [job.pagalbosId, job.claimToken, message],
    );
}

export async function discoveryRunning(db = postgres) {
    const { rows } = await db.query(
        `SELECT EXISTS (
            SELECT 1 FROM kotis."importai"
            WHERE "busena" = 'running' AND "meta"->>'etapas' = 'sarasoAtradimas'
         ) AS running`,
    );
    return rows[0]?.running === true;
}

import type { PoolClient } from "pg";
import { log } from "../../utils/log.js";

// Retention for the insert-only snapshot model (risk-service-architecture.md
// §6.3). Every run writes a whole snapshot and the site reads exactly one, so
// what expires is a superseded run's rows, not individual signals.

export const RETENTION_INTERVAL = "1 month";

export type RetentionStats = Readonly<{ runsCleared: number; signalsDeleted: number }>;

/**
 * Deletes the signals of runs that are both older than the retention window
 * and no longer the one the site shows.
 *
 * The second condition is the safety belt, and it is the reason this is not a
 * plain `started_at < now() - interval` sweep: if the service has been broken
 * for longer than the window, the newest successful run is itself past the
 * cutoff, and deleting it would empty the public pages. Excluding
 * `v_latest_run` means the worst outcome of a long outage is stale signals,
 * never missing ones.
 *
 * Run rows themselves are kept: ~365 a year, and each one is the provenance
 * (`code_commit`, `data_as_of`) of the signals it produced.
 */
export async function deleteExpiredSnapshots(client: PoolClient): Promise<RetentionStats> {
    const { rows: expired } = await client.query<{ id: string }>(
        `
        SELECT r.id
        FROM risk.evaluation_runs r
        WHERE r.started_at < now() - $1::interval
          AND r.id <> (SELECT id FROM risk.v_latest_run)
          AND EXISTS (SELECT 1 FROM risk.risk_signals s WHERE s.run_id = r.id)
        ORDER BY r.id
        `,
        [RETENTION_INTERVAL],
    );

    if (expired.length === 0) {
        return { runsCleared: 0, signalsDeleted: 0 };
    }

    // One run at a time: each DELETE is an index range scan on the leading
    // run_id column, and a long sweep never holds one enormous transaction.
    let signalsDeleted = 0;
    for (const { id } of expired) {
        const { rowCount } = await client.query(`DELETE FROM risk.risk_signals WHERE run_id = $1`, [id]);
        signalsDeleted += rowCount ?? 0;
    }

    log(`procurement-risk: retention cleared ${expired.length} run(s), ${signalsDeleted} signal(s)`);
    return { runsCleared: expired.length, signalsDeleted };
}

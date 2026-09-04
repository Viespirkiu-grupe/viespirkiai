import type { Pool, PoolClient } from "pg";
import type { ProcurementRiskDecisions } from "../../modules/risk/types.ts";
import { writeDecisions } from "./write.ts";

/**
 * The Decision Writer (docs/indicators-story/risk-service-architecture.md
 * §1.2): wraps write.ts's indicator-independent writeDecisions() in one
 * transaction per call.
 *
 * There is no run row to open or close — `risk."procurementDecisions"` is
 * per-procurement current state, and each row's own "dataAsOf"/"updatedAt"
 * say when it was last refreshed. A process crash mid-batch therefore leaves
 * nothing to reconcile: the pages that committed are current, the rest keep
 * their previous evaluation.
 */
export class DecisionWriter {
    private readonly pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /** One DB transaction per call. */
    async writeDecisions(decisions: readonly ProcurementRiskDecisions[]): Promise<number> {
        const client: PoolClient = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const { written } = await writeDecisions(client, decisions);
            await client.query("COMMIT");
            return written;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }
}

// How a Risk Indicator calculation reaches data — the one port between an
// indicator and a database, kept apart from the EvaluationContext (which says
// *what* is being evaluated, not *how* to read it).
//
// The run job passes a source backed by the read-only connection against the
// real database's `public` canonical facts (§1.2's `risk_calc` stand-in, see
// postgres/postgres.js); an integration test passes one backed by the local
// Docker Postgres's test schema. Same interface, so the calculation cannot
// tell the difference (§8: "tests exercise the calculation through the same
// evaluation context the run job supplies").

export interface RiskDataSource {
    query<T>(sqlText: string, params?: readonly unknown[]): Promise<readonly T[]>;
}

// The slice of `pg`'s Pool/PoolClient this adapter needs — narrow on purpose,
// so a test can hand in a stub without constructing a pool.
export type PgQueryable = {
    query(sqlText: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

export class PostgresRiskDataSource implements RiskDataSource {
    private readonly pool: PgQueryable;

    constructor(pool: PgQueryable) {
        this.pool = pool;
    }

    async query<T>(sqlText: string, params: readonly unknown[] = []): Promise<readonly T[]> {
        const { rows } = await this.pool.query(sqlText, [...params]);
        return rows as readonly T[];
    }
}

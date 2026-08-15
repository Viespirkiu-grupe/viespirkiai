// The interface between a Risk Indicator calculation and a database; kept
// separate from EvaluationContext (evaluationContext.ts), which describes
// what is being evaluated rather than how to read it.

export interface RiskDataSource {
    query<T>(sqlText: string, params?: readonly unknown[]): Promise<readonly T[]>;
}

// The slice of `pg`'s Pool/PoolClient this adapter needs.
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

import { describe, expect, it } from 'vitest';
import { FilterBuilder } from '../utils/filter.js';

describe('FilterBuilder Postgres sorting', () => {
  it('appends NULLS LAST only when requested', () => {
    const base = {
      fields: [],
      sort: {
        default: 'data',
        allowed: ['data'],
      },
    };
    const defaultSql = new FilterBuilder(base)
      .build({}, { table: 'items', limit: 1 }).sql;
    const nullsLastSql = new FilterBuilder({
      ...base,
      sort: { ...base.sort, nullsLast: true },
    }).build({}, { table: 'items', limit: 1 }).sql;

    expect(defaultSql).toContain('ORDER BY "data" DESC LIMIT');
    expect(defaultSql).not.toContain('NULLS LAST');
    expect(nullsLastSql).toContain('ORDER BY "data" DESC NULLS LAST LIMIT');
  });
});

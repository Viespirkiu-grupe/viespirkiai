import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../postgres/postgres.js', () => ({
  postgres: { query: mocks.query },
}));

import { gautiFaila } from '../modules/failai/filesSkaitymas.js';

describe('gautiFaila', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grąžina specialius failo tipus, naudojamus PPA ataskaitos peržiūrai', async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: 42,
        saltinis: 'cvpIs',
        sourceId0: 'PIRKIMAS',
        sourceId1: 'DOKUMENTAS',
        sourceId2: 'VERSIJA',
        sourceId3: null,
        version: null,
        extractionStatus: null,
        specialTypes: ['PPA'],
      }],
    });

    const failas = await gautiFaila(42);

    expect(failas?.specialTypes).toEqual(['PPA']);
    expect(String(mocks.query.mock.calls[0][0])).toContain('files."specialTypes"');
    expect(String(mocks.query.mock.calls[0][0])).toContain('files."specialTypeNames"');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/postgres/postgres.js', () => ({ postgres: { query: vi.fn() } }));

import { cachePageData } from '../src/lib/pgFacets.ts';

describe('cachePageData', () => {
  it('sulieja vienu metu vykstančius vienodo URL krovimus į vieną', async () => {
    const url = new URL('https://x.lt/nepatikimi?search=abc');
    const load = vi.fn().mockResolvedValue('duomenys');

    const [a, b, c] = await Promise.all([
      cachePageData(url, load),
      cachePageData(url, load),
      cachePageData(url, load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['duomenys', 'duomenys', 'duomenys']);
  });

  it('skirtingi filtrai — atskiri krovimai', async () => {
    const load = vi.fn().mockResolvedValue('x');

    await cachePageData(new URL('https://x.lt/neskelbiamos?page=1'), load);
    await cachePageData(new URL('https://x.lt/neskelbiamos?page=2'), load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('klaida nekešuojama — kitas kvietimas bando iš naujo', async () => {
    const url = new URL('https://x.lt/planuojamiPirkimai?sort=kainaDesc');
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('DB nepasiekiama'))
      .mockResolvedValueOnce('pavyko');

    await expect(cachePageData(url, load)).rejects.toThrow('DB nepasiekiama');
    await expect(cachePageData(url, load)).resolves.toBe('pavyko');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildScrapeLogQuery,
  parseScrapeLogFilters,
} from '../src/lib/scrapeLogStatistika.ts';

describe('scrape log statistikos filtrai', () => {
  it('parenka numatytą laikotarpį ir normalizuoja puslapį', () => {
    const filters = parseScrapeLogFilters(new URLSearchParams('page=-2'));
    expect(filters.period.key).toBe('24h');
    expect(filters.page).toBe(1);
  });

  it('sujungia to paties faceto reikšmes su OR, o facetus su AND', () => {
    const filters = parseScrapeLogFilters(new URLSearchParams(
      'scraper=cvpp,sutartys&domain=example.lt&status=500&ok=false',
    ));
    expect(buildScrapeLogQuery(filters)).toBe(
      '(scraper:"cvpp" OR scraper:"sutartys") AND domain:"example.lt" AND status:500 AND ok:false',
    );
  });

  it('faceto agregacijai išmeta tik jo paties filtrą', () => {
    const filters = parseScrapeLogFilters(new URLSearchParams(
      'search=timeout&host=api.example.lt&role=taskRunner',
    ));
    expect(buildScrapeLogQuery(filters, 'host')).toBe('(timeout) AND role:"taskRunner"');
  });

  it('ekranizuoja tikslių facetų reikšmes', () => {
    const filters = parseScrapeLogFilters(new URLSearchParams('operation=a%22b'));
    expect(buildScrapeLogQuery(filters)).toBe('operation:"a\\"b"');
  });
});

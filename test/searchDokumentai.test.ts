import { describe, expect, it } from 'vitest';
import {
  DOKUMENTAI_SORT_OPTIONS,
  buildYearRanges,
  makeSnippet,
  normalizeDocText,
  parseTimelineBuckets,
} from '@/src/lib/searchDokumentai.ts';

describe('dokumentai sorting', () => {
  it('passes one valid Quickwit REST sort field per option', () => {
    for (const option of DOKUMENTAI_SORT_OPTIONS) {
      expect(option.sortBy).not.toContain(',');
    }
  });

  it('sorts largest documents descending', () => {
    expect(DOKUMENTAI_SORT_OPTIONS.find((option) => option.value === 'mostWords')?.sortBy)
      .toBe('wordCount');
    expect(DOKUMENTAI_SORT_OPTIONS.find((option) => option.value === 'mostPages')?.sortBy)
      .toBe('pageCount');
  });

  it('uses Quickwit REST mini-DSL minus prefix only for ascending sorts', () => {
    expect(DOKUMENTAI_SORT_OPTIONS.find((option) => option.value === 'newest')?.sortBy)
      .toBe('happenedAt');
    expect(DOKUMENTAI_SORT_OPTIONS.find((option) => option.value === 'oldest')?.sortBy)
      .toBe('-happenedAt');
  });
});

describe('dokumentai snippets', () => {
  it('words mode highlights every matching term, including single letters', () => {
    expect(makeSnippet('Pradžia A tada B ir galiausiai C pabaiga', 'a b c', 'words'))
      .toContain('<strong>A</strong>');
    expect(makeSnippet('Pradžia A tada B ir galiausiai C pabaiga', 'a b c', 'words'))
      .toContain('<strong>B</strong>');
    expect(makeSnippet('Pradžia A tada B ir galiausiai C pabaiga', 'a b c', 'words'))
      .toContain('<strong>C</strong>');
  });

  it('phrase mode highlights the exact phrase as one range', () => {
    expect(makeSnippet('Pradžia A B C pabaiga', 'a b c', 'phrase'))
      .toContain('<strong>A B C</strong>');
  });

  it('phrase mode falls back to individual terms when the phrase is absent', () => {
    const snippet = makeSnippet('Pradžia A tada B ir galiausiai C pabaiga', 'a b c', 'phrase');
    expect(snippet).toContain('<strong>A</strong>');
    expect(snippet).toContain('<strong>B</strong>');
    expect(snippet).toContain('<strong>C</strong>');
  });

  it('matches Lithuanian text without losing original spelling', () => {
    expect(makeSnippet('Viešųjų pirkimų sutartis', 'viesuju', 'words'))
      .toContain('<strong>Viešųjų</strong>');
  });

  it('folds Lithuanian letters in phrase fallback terms', () => {
    const snippet = makeSnippet('Čia minima žalia spalva ir atskirai sutartis', 'zalia sutartis', 'phrase');
    expect(snippet).toContain('<strong>žalia</strong>');
    expect(snippet).toContain('<strong>sutartis</strong>');
  });

  it('shows a leading preview when there is no text query', () => {
    const snippet = makeSnippet('Pirmas sakinys apie pirkimą. Antras sakinys.', '', 'words');
    expect(snippet).not.toBeNull();
    expect(snippet).toContain('Pirmas sakinys');
    expect(snippet).not.toContain('<strong>');
  });
});

describe('dokumentai stats timeline', () => {
  it('builds inclusive yearly ranges with nanosecond boundaries on Jan 1 UTC', () => {
    const ranges = buildYearRanges(2019, 2021);
    expect(ranges.map((r) => r.key)).toEqual(['2019', '2020', '2021']);
    // 2019-01-01T00:00:00Z = 1546300800 s → nanoseconds.
    expect(ranges[0].from).toBe(Date.UTC(2019, 0, 1) * 1_000_000);
    // Each year's `to` is the next year's `from` (continuous, half-open).
    expect(ranges[0].to).toBe(ranges[1].from);
    expect(ranges[2].to).toBe(Date.UTC(2022, 0, 1) * 1_000_000);
  });

  it('keeps year columns and drops the open-ended (non-numeric) edge buckets', () => {
    const buckets = [
      { key: '*-…', doc_count: 7 },
      { key: '2019', doc_count: 10 },
      { key: '2020', doc_count: 20 },
      { key: '…-*', doc_count: 9 },
    ];
    expect(parseTimelineBuckets(buckets, (n) => n)).toEqual([
      { year: 2019, count: 10 },
      { year: 2020, count: 20 },
    ]);
  });

  it('trims leading and trailing empty years but keeps interior gaps', () => {
    const buckets = [
      { key: '2017', doc_count: 0 },
      { key: '2018', doc_count: 5 },
      { key: '2019', doc_count: 0 },
      { key: '2020', doc_count: 8 },
      { key: '2021', doc_count: 0 },
    ];
    expect(parseTimelineBuckets(buckets, (n) => n)).toEqual([
      { year: 2018, count: 5 },
      { year: 2019, count: 0 },
      { year: 2020, count: 8 },
    ]);
  });

  it('applies the tombstone scale to counts and handles an empty selection', () => {
    expect(parseTimelineBuckets([{ key: '2020', doc_count: 100 }], (n) => Math.round(n * 0.5)))
      .toEqual([{ year: 2020, count: 50 }]);
    expect(parseTimelineBuckets(undefined, (n) => n)).toEqual([]);
    expect(parseTimelineBuckets([{ key: '2020', doc_count: 0 }], (n) => n)).toEqual([]);
  });
});

describe('normalizeDocText', () => {
  it('joins a JSON array of pages into plain text (hides the ["…] wrapper)', () => {
    const out = normalizeDocText(JSON.stringify(['Pirmas puslapis', 'Antras puslapis']));
    expect(out).toBe('Pirmas puslapis Antras puslapis');
    expect(out.startsWith('[')).toBe(false);
  });

  it('keeps a plain string as-is', () => {
    expect(normalizeDocText('Paprastas tekstas')).toBe('Paprastas tekstas');
  });

  it('falls back gracefully on a truncated/invalid JSON array', () => {
    const out = normalizeDocText('["Pirmas puslapis","Antras pusl');
    expect(out.startsWith('[')).toBe(false);
    expect(out).toContain('Pirmas puslapis');
  });

  it('handles an already-parsed array', () => {
    expect(normalizeDocText(['a', 'b'])).toBe('a b');
  });

  it('returns empty string for nullish/non-text input', () => {
    expect(normalizeDocText(undefined as unknown as string)).toBe('');
  });
});

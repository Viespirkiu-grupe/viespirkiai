import { describe, expect, it } from 'vitest';
import { DOKUMENTAI_SORT_OPTIONS, makeSnippet } from '@/src/lib/searchDokumentai.ts';

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
});

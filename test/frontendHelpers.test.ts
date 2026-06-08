import { describe, expect, it } from 'vitest';
import { buildDokumentaiUrl, splitFacetOptions, toggleValue } from '@/src/lib/dokumentaiUrl.ts';
import { externalLinkRel, jsonForHtmlScript } from '@/src/design-system/lib/html.ts';

const state = {
  q: 'keliai',
  mode: 'phrase' as const,
  sort: 'relevance' as const,
  klase: [],
  type: ['failas'],
  host: [],
  jar: [],
  ext: ['pdf'],
  author: [],
  creator: [],
  producer: [],
  lang: [],
  sav: [],
  apskritis: [],
  source: [],
  teismas: [],
  bylosRusis: [],
  kategorija: [],
  teisejas: [],
  area: null,
};

describe('document search URL helpers', () => {
  it('builds stable URLs and omits default sort and empty filters', () => {
    expect(buildDokumentaiUrl(state)).toBe('/dokumentai?search=keliai&mode=phrase&type=failas&ext=pdf');
  });

  it('applies filter and page overrides without mutating state', () => {
    expect(buildDokumentaiUrl(state, { type: [], page: 3 }))
      .toBe('/dokumentai?search=keliai&mode=phrase&ext=pdf&page=3');
    expect(state.type).toEqual(['failas']);
  });

  it('URL-encodes author, creator and producer values without splitting commas', () => {
    const url = buildDokumentaiUrl(state, {
      author: ['Doe, Jane'],
      creator: ['Adobe, Inc.'],
      producer: ['FREE PDFill PDF and Image Writer'],
    });
    const params = new URL(url, 'https://example.test').searchParams;

    expect(params.getAll('author')).toEqual(['Doe, Jane']);
    expect(params.getAll('creator')).toEqual(['Adobe, Inc.']);
    expect(params.getAll('producer')).toEqual(['FREE PDFill PDF and Image Writer']);
  });

  it('toggles values and pins selected facet options', () => {
    expect(toggleValue(['pdf'], 'docx')).toEqual(['pdf', 'docx']);
    expect(toggleValue(['pdf'], 'pdf')).toEqual([]);
    expect(splitFacetOptions([{ value: 'pdf', count: 2 }], ['docx'], 1))
      .toEqual({
        visible: [{ value: 'docx', count: null }],
        hidden: [{ value: 'pdf', count: 2 }],
      });
  });
});

describe('HTML helpers', () => {
  it('makes JSON safe to embed in an HTML script element', () => {
    const value = jsonForHtmlScript({ text: '</script><script>alert(1)</script>' });
    expect(value).not.toContain('</script>');
    expect(JSON.parse(value)).toEqual({ text: '</script><script>alert(1)</script>' });
  });

  it('adds safe rel values only for new-window links', () => {
    expect(externalLinkRel('_blank', 'me')).toBe('me noopener noreferrer');
    expect(externalLinkRel(undefined, 'me')).toBe('me');
  });
});

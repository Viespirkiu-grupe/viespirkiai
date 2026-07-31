import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { cpvaDocumentUrl, cpvaXlsxUrl } from '../modules/cpva/sourceUrls.js';

describe('CPVA source URLs', () => {
  const mirror = 'http://10.1.10.1:9204/';

  it('loads the document page through the configured mirror', () => {
    expect(cpvaDocumentUrl(mirror)).toBe(
      'http://10.1.10.1:9204/dokumentai/cpva-adminstruojami-projektai-ir-tiekejai',
    );
  });

  it('rewrites an absolute upstream XLSX URL to the configured mirror', () => {
    const { document } = parseHTML(`
      <a href="https://2021.esinvesticijos.lt/uploads/cpva.xlsx?download=1">XLSX</a>
    `);

    expect(cpvaXlsxUrl(document, cpvaDocumentUrl(mirror), mirror)).toBe(
      'http://10.1.10.1:9204/uploads/cpva.xlsx?download=1',
    );
  });

  it('accepts relative and case-insensitive XLSX links', () => {
    const { document } = parseHTML('<a href="/files/CPVA.XLSX">XLSX</a>');

    expect(cpvaXlsxUrl(document, cpvaDocumentUrl(mirror), mirror)).toBe(
      'http://10.1.10.1:9204/files/CPVA.XLSX',
    );
  });
});

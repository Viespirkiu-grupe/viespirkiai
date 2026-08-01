import { describe, expect, it } from 'vitest';
import { parseCsvLine } from '../modules/juridiniai/importJarCsv.js';

describe('RC JAR CSV parser', () => {
  it('parses pipes and escaped quotes inside quoted company names', () => {
    expect(parseCsvLine('110003978|"Uždaroji akcinė bendrovė ""Lietkompexim"""|Vilnius')).toEqual([
      '110003978',
      'Uždaroji akcinė bendrovė "Lietkompexim"',
      'Vilnius',
    ]);
  });

  it('keeps an empty field for a missing AOB code', () => {
    expect(parseCsvLine('136052338|Kaunas, Savanorių pr. 271-403||2025-08-06|2026-07-31')[2]).toBe('');
  });

  it('rejects an unclosed quoted field', () => {
    expect(() => parseCsvLine('1|"neuždaryta')).toThrow('Neuždarytos CSV kabutės');
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseCsvLine,
  parseSourceRow,
  SOURCES,
} from '../modules/juridiniai/importJarCsv.js';

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

  it('parses the first data row when RC omits the header', () => {
    const source = SOURCES.find((item) => item.name === 'iregistruoti')!;
    const row = parseSourceRow(
      '110238983|UAB Testas|Vilnius|1994-08-18|520|Atstovybė|0|Statusas|1994-08-18|2026-08-13',
      source,
    );
    expect(row).toMatchObject({
      jarKodas: 110238983,
      pavadinimas: 'UAB Testas',
      duomenuData: '2026-08-13',
    });
  });

  it('still rejects a headerless row with a changed field count', () => {
    const source = SOURCES.find((item) => item.name === 'iregistruoti')!;
    expect(() => parseSourceRow('110238983|per mažai|laukų', source)).toThrow(
      'tikėtasi 10 laukų',
    );
  });
});

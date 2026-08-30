import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importSource,
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

describe('RC JAR CSV related records', () => {
  it.each(['adresai', 'valdymas', 'kapitalas'])(
    'imports %s only for people present in jarAsmenys',
    async (sourceName) => {
      const source = SOURCES.find((item) => item.name === sourceName)!;
      const queries: string[] = [];
      const client = {
        query: async (sql: string) => {
          queries.push(sql);
          return { rowCount: 0 };
        },
      };
      const row = source.map(Array(source.header.length).fill(null));
      row.jarKodas = 110063950;
      if (sourceName === 'valdymas') {
        row.organai = [{
          jarKodas: row.jarKodas,
          tipas: 'valdyba',
          nuo: null,
          vyruKiekis: null,
          moteruKiekis: null,
          lytisNenurodytaKiekis: null,
          duomenuData: null,
        }];
      }

      await source.write(client, [row]);

      const insertQueries = queries.filter((sql) => sql.includes('INSERT INTO'));
      expect(insertQueries.length).toBeGreaterThan(0);
      expect(insertQueries.every((sql) =>
        sql.includes('JOIN public."jarAsmenys" person'),
      )).toBe(true);
    },
  );
});

describe('importSource eilučių skaitymas', () => {
  it('nepraranda pradinių eilučių, kai prieš iteraciją laukiama DB užklausos', async () => {
    const rows = 20_000;
    const lines = ['ja_kodas|ja_pavadinimas|adresas|ja_reg_data|form_kodas|form_pavadinimas|stat_kodas|stat_pavadinimas|stat_data_nuo|formavimo_data'];
    for (let i = 0; i < rows; i++) {
      lines.push(
        `${110000000 + i}|UAB Testas ${i}|Vilnius, Testo g. ${i}|1996-04-03|310|` +
        `Uždaroji akcinė bendrovė|0|Teisinis stat neįregistruotas|1996-04-03|2026-08-28`,
      );
    }
    const localPath = join(await mkdtemp(join(tmpdir(), 'jar-csv-test-')), 'JAR_IREGISTRUOTI.csv');
    await writeFile(localPath, `${lines.join('\n')}\n`);

    // Kiekviena „DB" užklausa atiduoda event loop'ą – būtent per tokį tarpą
    // readline suspėdavo perskaityti ir išmesti pirmuosius tūkstančius eilučių.
    const client = {
      async query() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { rowCount: 0, rows: [] };
      },
    };
    const source = { ...SOURCES.find((item) => item.name === 'iregistruoti')!, localPath, sha256: 'x' };
    const result = await importSource(client as never, source as never);
    expect(result.scanned).toBe(rows);
  });
});

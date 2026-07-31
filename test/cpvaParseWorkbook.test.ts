import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCpvaWorkbook } from '../modules/cpva/parseWorkbook.js';

function workbook(projectRows: unknown[][], contractRows: unknown[][]) {
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet(projectRows), 'Projektai');
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet(contractRows), 'Sutartys');
  return result;
}

describe('CPVA workbook parser', () => {
  it('parses the current format with headers in the first row', () => {
    const parsed = parseCpvaWorkbook(workbook([
      ['Projekto kodas', 'Projekto pavadinimas', 'Projekto vykdytojo pavadinimas', 'Projekto vykdytojo kodas', 'Sutarties įsigaliojimo data', 'Projekto išlaidų suma, eurais', '1.2. EGADP subsidijos lėšos'],
      ['01-001-P-0001', 'Ąžuolų projektas', 'Viešoji įstaiga', 123456789, 44995, '580812,65', '10 200,50'],
    ], [
      ['Projekto kodas', 'Projekto pavadinimas', 'Pirkimo numeris', 'Pirkimo pavadinimas', 'Pirkimo sutarties data', 'Vykdytojo pirkimo sutarties numeris', 'Bendra pirkimo sutarties suma, tenkanti projektui, eurais', 'Tiekėjo pavadinimas', 'Tiekėjo kodas'],
      ['01-001-P-0001', 'Ąžuolų projektas', 'PRK-1', 'Paslaugos', 44406, 'SUT-1', '1 234,56', 'UAB „Tiekėjas“', 987654321],
    ]));

    expect(parsed.projects[0]).toMatchObject({
      projektoNr: '01-001-P-0001',
      projektoPavadinimas: 'Ąžuolų projektas',
      projektoVykdytojoKodas: 123456789,
      sutartiesData: '2023-03-10',
      egadpSubsidijos: 10200.5,
      isViso: 580812.65,
    });
    expect(parsed.contracts[0]).toMatchObject({
      pirkimoNrCvpis: 'PRK-1',
      pirkimoSutartiesNr: 'SUT-1',
      pirkimoSutartiesData: '2021-07-29',
      pirkimoSutartiesSumaSusijusiSuProjektu: 1234.56,
      tiekejoPavadinimasVardasIrPavardeGimimoData: 'UAB „Tiekėjas“',
    });
  });

  it('finds legacy headers after a title row', () => {
    const parsed = parseCpvaWorkbook(workbook([
      ['CPVA projektai'],
      ['Projekto Nr.', 'Projekto pavadinimas', 'Projekto vykdytojo juridinio asmens kodas'],
      ['P-1', 'Senas projektas', '123'],
    ], [
      ['CPVA sutartys'],
      ['Projekto Nr.', 'Pirkimo Nr. CVP IS', 'Pirkimo sutarties Nr.'],
      ['P-1', '123456', 'S-1'],
    ]));

    expect(parsed.projects[0].projektoNr).toBe('P-1');
    expect(parsed.projects[0].projektoVykdytojoKodas).toBe('123');
    expect(parsed.contracts[0]).toMatchObject({
      projektoNr: 'P-1',
      pirkimoNrCvpis: '123456',
      pirkimoSutartiesNr: 'S-1',
    });
  });

  it('keeps a numeric zero contract number', () => {
    const parsed = parseCpvaWorkbook(workbook([
      ['Projekto kodas'],
      ['P-1'],
    ], [
      ['Projekto kodas', 'Vykdytojo pirkimo sutarties numeris'],
      ['P-1', 0],
    ]));

    expect(parsed.contracts[0].pirkimoSutartiesNr).toBe(0);
  });
});

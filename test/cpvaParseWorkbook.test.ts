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
      ['Kvietimo numeris', 'Projekto kodas', 'Projekto pavadinimas', 'Atsakinga Institucija', 'Projekto vykdytojo pavadinimas', 'Projekto vykdytojo kodas', 'Projekto būsena', 'Būsenos data', 'Sutarties įsigaliojimo data', 'Projekto veiklų vykdymo pabaigos data', 'SAI taikymas', 'Projekto išlaidų suma, eurais', '1.1. ES fondų lėšos', '1.2. EGADP subsidijos lėšos', '1.3. EGADP paskolos lėšos'],
      ['01-001-P', '01-001-P-0001', 'Ąžuolų projektas', 'Aplinkos ministerija', 'Viešoji įstaiga', 123456789, 'Baigta įgyvendinti', 46181, 44995, 45930, 'Taikoma', '580812,65', '527 351,13', '10 200,50', '0,00'],
    ], [
      ['Projekto kodas', 'Pirkimą vykdantis subjektas yra užsienyje registruotas juridinis asmuo', 'Projekto vykdytojo pavadinimas', 'Projekto vykdytojo kodas', 'Pirkimą vykdančio subjekto statusas', 'Pirkimo numeris', 'Pirkimo pavadinimas', 'Pirkimo būdas', 'Pirkimo objekto rūšis', 'Pirkimo sutarties data', 'Vykdytojo pirkimo sutarties numeris', 'Bendra pirkimo sutarties suma, tenkanti projektui, eurais', 'Tinkama finansuoti sutarties suma, eurais', 'Tiekėjas fizinis asmuo', 'Tiekėjo pavadinimas', 'Tiekėjo kodas', 'Pirkimo sutartis vykdoma'],
      ['01-001-P-0001', 'Ne', 'Viešoji įstaiga', 123456789, 'Perkančioji organizacija', 'PRK-1', 'Paslaugos', 'Atviras konkursas (tarptautinis)', 'Paslaugos', 44406, 'SUT-1', '1 234,56', '1 200,00', 'Taip', 'UAB „Tiekėjas“', 987654321, 'Taip'],
    ]));

    expect(parsed.projects[0]).toMatchObject({
      projektoNr: '01-001-P-0001',
      kvietimoNr: '01-001-P',
      pavadinimas: 'Ąžuolų projektas',
      atsakingaInstitucija: 'Aplinkos ministerija',
      vykdytojoPavadinimas: 'Viešoji įstaiga',
      vykdytojoKodas: '123456789',
      busena: 'Baigta įgyvendinti',
      busenosData: '2026-06-08',
      sutartiesData: '2023-03-10',
      veikluPabaigosData: '2025-09-30',
      saiTaikoma: true,
      islaiduSuma: 580812.65,
    });
    // Nuliai (1.3) nesaugomi — jų šaltinyje dauguma, o nebuvimas reiškia nulį.
    expect(parsed.projects[0].lesos).toEqual([
      { kodas: '1.1', suma: 527351.13 },
      { kodas: '1.2', suma: 10200.5 },
    ]);

    expect(parsed.contracts[0]).toMatchObject({
      projektoNr: '01-001-P-0001',
      vykdytojoPavadinimas: 'Viešoji įstaiga',
      vykdytojoKodas: '123456789',
      vykdytojoStatusas: 'Perkančioji organizacija',
      vykdytojasUzsienyje: false,
      pirkimoNr: 'PRK-1',
      pirkimoPavadinimas: 'Paslaugos',
      pirkimoBudas: 'Atviras konkursas (tarptautinis)',
      objektoRusis: 'Paslaugos',
      sutartiesData: '2021-07-29',
      sutartiesNr: 'SUT-1',
      sumaProjektui: 1234.56,
      tinkamaFinansuotiSuma: 1200,
      tiekejasFizinisAsmuo: true,
      tiekejoPavadinimas: 'UAB „Tiekėjas“',
      tiekejoKodas: '987654321',
      vykdoma: true,
    });
  });

  it('finds legacy headers after a title row', () => {
    const parsed = parseCpvaWorkbook(workbook([
      ['CPVA projektai'],
      ['Projekto Nr.', 'Projekto pavadinimas', 'Projekto vykdytojo juridinio asmens kodas', 'Didžiausia galima tinkamų finansuoti išlaidų suma EGADP subsidijos lėšos'],
      ['P-1', 'Senas projektas', '123', '5 000,00'],
    ], [
      ['CPVA sutartys'],
      ['Projekto Nr.', 'Pirkimo Nr. CVP IS', 'Pirkimo sutarties Nr.'],
      ['P-1', '123456', 'S-1'],
    ]));

    expect(parsed.projects[0].projektoNr).toBe('P-1');
    expect(parsed.projects[0].vykdytojoKodas).toBe('123');
    // Senasis formatas numeruotų antraščių neturi — jos susiejamos rankiniu žemėlapiu.
    expect(parsed.projects[0].lesos).toEqual([{ kodas: '1.2', suma: 5000 }]);
    expect(parsed.contracts[0]).toMatchObject({
      projektoNr: 'P-1',
      pirkimoNr: '123456',
      sutartiesNr: 'S-1',
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

    expect(parsed.contracts[0].sutartiesNr).toBe('0');
  });

  it('rejects a sheet without a project number', () => {
    expect(() => parseCpvaWorkbook(workbook([
      ['Projekto kodas', 'Projekto pavadinimas'],
      [null, 'Projektas be kodo'],
    ], [
      ['Projekto kodas', 'Vykdytojo pirkimo sutarties numeris'],
      ['P-1', 'S-1'],
    ]))).toThrow(/nėra projekto numerio/);
  });
});

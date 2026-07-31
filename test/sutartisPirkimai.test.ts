import { describe, expect, it, vi } from 'vitest';

vi.mock('../postgres/postgres.js', () => ({ postgres: { query: vi.fn() } }));

const { ivertintiAtitikmeni, pavadinimuPanasumas, parsePirkimoId } = await import('../src/lib/sutartisPirkimai.ts');

const sutartis = {
  pavadinimas: '(PU-13036/24) Audito paslaugos',
  perkanciosiosOrganizacijosKodas: '232112130',
  sudarymoData: '2025-04-23',
};

describe('pavadinimuPanasumas', () => {
  it('ignoruoja bendrinius žodžius', () => {
    expect(pavadinimuPanasumas('Paslaugų pirkimas', 'Darbų pirkimas')).toBe(0);
  });

  it('atpažįsta tą patį pavadinimą su papildomais žodžiais', () => {
    const p = pavadinimuPanasumas(
      'Kauno MBA ir Zabieliškio MAR įvairių buitinių prekių pirkimas',
      'Kauno MBA ir Zabieliškio MAR reikalingų įvairių buitinių prekių pirkimas',
    );
    expect(p).toBeGreaterThan(0.5);
  });
});

describe('ivertintiAtitikmeni', () => {
  it('tikslus, kai sutampa ir pirkėjas, ir pavadinimas', () => {
    const r = ivertintiAtitikmeni(sutartis, {
      sistema: 'nauja',
      pavadinimas: '(PU-13036/24) Audito paslaugos',
      jarKodas: '232112130',
      paskelbimoData: '2024-12-11',
    });
    expect(r.patikimumas).toBe('tikslus');
  });

  it('vien pirkėjo sutapimo nepakanka tiksliam atitikmeniui', () => {
    const r = ivertintiAtitikmeni(sutartis, {
      sistema: 'cvpp',
      pavadinimas: 'Betono mišinių pirkimas',
      jarKodas: '232112130',
      paskelbimoData: '2018-04-21',
    });
    expect(r.patikimumas).toBe('galimas');
    expect(r.pozymiai).toContain('tas pats pirkėjas');
  });

  it('kito pirkėjo pirkimas su tuo pačiu numeriu lieka silpnas', () => {
    const r = ivertintiAtitikmeni(sutartis, {
      sistema: 'cvpp',
      pavadinimas: 'Nešiojamieji kompiuteriai',
      jarKodas: '121351441',
      paskelbimoData: '2020-01-01',
    });
    expect(r.patikimumas).toBe('silpnas');
    expect(r.pozymiai).toContain('kitas pirkėjas');
  });

  it('nebaudžia už CPO LT vykdytą pirkimą', () => {
    const r = ivertintiAtitikmeni(sutartis, {
      sistema: 'nauja',
      pavadinimas: 'Draudimo paslaugų užsakymai per CPO LT elektroninį katalogą',
      jarKodas: '302913276',
      paskelbimoData: '2024-01-01',
    });
    expect(r.balas).toBeGreaterThan(0);
    expect(r.pozymiai).toContain('pirkimą vykdė centrinė perkančioji organizacija');
  });

  it('sumažina balą, jei pirkimas paskelbtas vėliau nei sudaryta sutartis', () => {
    const veliau = ivertintiAtitikmeni(sutartis, { sistema: 'nauja', pavadinimas: 'Kita', jarKodas: '232112130', paskelbimoData: '2026-01-01' });
    const anksciau = ivertintiAtitikmeni(sutartis, { sistema: 'nauja', pavadinimas: 'Kita', jarKodas: '232112130', paskelbimoData: '2024-01-01' });
    expect(veliau.balas).toBeLessThan(anksciau.balas);
    expect(veliau.pozymiai).toContain('paskelbtas vėliau nei sudaryta sutartis');
  });
});

describe('parsePirkimoId', () => {
  it('praleidžia tik skaitinius numerius', () => {
    expect(parsePirkimoId('367590')).toBe(367590);
    expect(parsePirkimoId('BTGS027138')).toBeNull();
    expect(parsePirkimoId('5283282181')).toBeNull();
  });
});

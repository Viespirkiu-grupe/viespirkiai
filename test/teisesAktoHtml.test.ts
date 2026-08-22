import { describe, expect, it } from 'vitest';
import { rewriteETarLegalActLinks } from '../src/lib/teisesAktoHtml.ts';

describe('rewriteETarLegalActLinks', () => {
  it('perrašo absoliučias ir reliatyvias e-TAR teisės aktų nuorodas', () => {
    const html = [
      '<a href="https://www.e-tar.lt/portal/lt/legalAct/TAR.ABC/asr">aktas</a>',
      "<a class='x' href='/portal/lt/legalAct/TAR.DEF/redakcija-1'>redakcija</a>",
    ].join('');

    expect(rewriteETarLegalActLinks(html)).toBe([
      '<a href="/teisesAktas/TAR.ABC/asr">aktas</a>',
      "<a class='x' href='/teisesAktas/TAR.DEF/redakcija-1'>redakcija</a>",
    ].join(''));
  });

  it('perrašo legacy legalAct.html documentId nuorodas', () => {
    const html = [
      '<a href="https://www.e-tar.lt/portal/legalAct.html?documentId=09d20750875611ed8df094f359a60216">naujas</a>',
      '<a href="https://www.e-tar.lt/portal/legalAct.html?documentId=TAR.C54AFFAA7622&amp;lang=lt">senas</a>',
    ].join('');

    expect(rewriteETarLegalActLinks(html)).toBe([
      '<a href="/teisesAktas/09d20750875611ed8df094f359a60216">naujas</a>',
      '<a href="/teisesAktas/TAR.C54AFFAA7622">senas</a>',
    ].join(''));
  });

  it('išlaiko inkarą, bet neliečia failų ir išorinių nuorodų', () => {
    const html = [
      '<a href="https://e-tar.lt/portal/lt/legalAct/TAR.ABC#dalis">dalis</a>',
      '<a href="https://www.e-tar.lt/portal/legalActDocument/123">failas</a>',
      '<a href="https://example.com/portal/lt/legalAct/TAR.X">išorė</a>',
    ].join('');

    expect(rewriteETarLegalActLinks(html)).toBe([
      '<a href="/teisesAktas/TAR.ABC#dalis">dalis</a>',
      '<a href="https://www.e-tar.lt/portal/legalActDocument/123">failas</a>',
      '<a href="https://example.com/portal/lt/legalAct/TAR.X">išorė</a>',
    ].join(''));
  });
});

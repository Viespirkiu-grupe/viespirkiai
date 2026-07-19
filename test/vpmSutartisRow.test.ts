import { describe, expect, it } from 'vitest';
import {
  VPM_SUTARTIS_ROW_FROM,
  VPM_SUTARTIS_ROW_SELECT,
} from '../modules/sutartys/vpmSutartisRow.js';

describe('VPM sutarties BVPŽ projekcija', () => {
  it('rodo pilną BVPŽ kodą su kontroline cifra, o ne sutrumpintą mask', () => {
    expect(VPM_SUTARTIS_ROW_FROM).toContain(
      'SELECT b.code, b.checksum, b.pavadinimas',
    );
    expect(VPM_SUTARTIS_ROW_SELECT).toContain("'-' || bvpz.checksum");
    expect(VPM_SUTARTIS_ROW_SELECT).not.toContain('bvpz.mask');
    expect(VPM_SUTARTIS_ROW_FROM).not.toContain('b.mask');
  });
});

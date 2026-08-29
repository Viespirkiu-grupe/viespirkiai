import { describe, expect, it } from 'vitest';
import { parseCommitMode } from '../modules/documents/quickwitProcessIndexQueue.js';

describe('parseCommitMode', () => {
  it('be nustatymų – „auto", kaip ir kituose indeksuose', () => {
    expect(parseCommitMode([], {})).toBe('auto');
  });

  it('priima --commit force ir --commit=force', () => {
    expect(parseCommitMode(['--commit', 'force'], {})).toBe('force');
    expect(parseCommitMode(['--commit=force'], {})).toBe('force');
  });

  it('skaito DOCUMENTS_INDEX_COMMIT', () => {
    expect(parseCommitMode([], { DOCUMENTS_INDEX_COMMIT: 'force' })).toBe('force');
  });

  it('argumentas nusveria aplinkos kintamąjį', () => {
    expect(parseCommitMode(['--commit', 'auto'], { DOCUMENTS_INDEX_COMMIT: 'force' })).toBe('auto');
  });

  it('atmeta nežinomą reikšmę, o ne tyliai indeksuoja kitaip', () => {
    expect(() => parseCommitMode(['--commit', 'kazkas'], {})).toThrow(/Netinkamas --commit/);
    expect(() => parseCommitMode([], { DOCUMENTS_INDEX_COMMIT: 'kazkas' })).toThrow(/DOCUMENTS_INDEX_COMMIT/);
  });
});

import { describe, expect, it } from 'vitest';
import { botChallengeResponse, isBotChallengePath } from '@/src/lib/botChallenge.ts';

describe('bot cookie challenge', () => {
  it.each([
    '/',
    '/viesiejiPirkimai',
    '/viesiejiPirkimai/',
    '/dokumentai',
    '/dokumentai/',
    '/juridiniai',
    '/juridiniai/',
  ])('protects the expensive search route %s', (pathname) => {
    expect(isBotChallengePath(pathname)).toBe(true);
  });

  it.each([
    '/api/dokumentaiFacet',
    '/viesiejiPirkimai/123',
    '/dokumentai/map/tiles/1/2/3.json',
    '/juridiniai/match',
    '/sutartys',
  ])('does not challenge other routes such as %s', (pathname) => {
    expect(isBotChallengePath(pathname)).toBe(false);
  });

  it('returns a non-cacheable page which sets bot=no and reloads', async () => {
    const response = botChallengeResponse();
    const html = await response.text();

    expect(response.status).toBe(418);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(html).toContain('document.cookie = "bot=no; Path=/; SameSite=Lax"');
    expect(html).toContain('window.setTimeout(() => window.location.reload(), 100)');
    expect(html).toContain('.help { opacity: 0; animation: reveal 0s 5s forwards; }');
    expect(html).toContain('Įjunkite Javascript arba nustatykite Cookie <code>bot=no</code>, ačiū!');
  });
});

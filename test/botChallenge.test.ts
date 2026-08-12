import { describe, expect, it } from 'vitest';
import { botChallengeResponse, isBotChallengePath, isGoogleCrawler } from '@/src/lib/botChallenge.ts';

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

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Safari/537.36',
    'Googlebot-Image/1.0',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
    'AdsBot-Google (+http://www.google.com/adsbot.html)',
    'Mozilla/5.0 (compatible; Storebot-Google/1.0)',
  ])('recognises the Google crawler %s', (userAgent) => {
    expect(isGoogleCrawler(userAgent)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'NotGooglebot/1.0',
    'curl/8.5.0',
    '',
  ])('does not treat %s as a Google crawler', (userAgent) => {
    expect(isGoogleCrawler(userAgent)).toBe(false);
  });

  it('treats a missing user agent as not a Google crawler', () => {
    expect(isGoogleCrawler(null)).toBe(false);
    expect(isGoogleCrawler(undefined)).toBe(false);
  });

  it('returns a non-cacheable page which sets bot=no and reloads', async () => {
    const response = botChallengeResponse();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(html).toContain('document.cookie = "bot=no; Path=/; SameSite=Lax"');
    expect(html).toContain('window.setTimeout(() => window.location.reload(), 100)');
    expect(html).toContain('.help { opacity: 0; animation: reveal 0s 5s forwards; }');
    expect(html).toContain('Įjunkite Javascript arba nustatykite Cookie <code>bot=no</code>, ačiū!');
  });
});

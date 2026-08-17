import { describe, expect, it } from 'vitest';
import { botChallengeResponse, isBotChallengePath, isGoogleCrawler } from '@/src/lib/botChallenge.ts';
import { describeSearchQuery } from '@/src/lib/searchOgMeta.ts';

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

describe('bot challenge OG tags', () => {
  const meta = describeSearchQuery(
    '/',
    new URLSearchParams('search=asfaltas&sumaNuo=100000'),
    'https://viespirkiai.org',
  )!;

  it('carries the query-derived OG tags on the challenge page itself', async () => {
    const response = botChallengeResponse(meta);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    // Iššūkis lieka — OG antraštės jo nepakeičia, tik papildo.
    expect(html).toContain('document.cookie = "bot=no; Path=/; SameSite=Lax"');
    expect(html).toContain('<title>asfaltas – sutarčių paieška – Viešpirkiai</title>');
    expect(html).toContain('<meta property="og:title" content="asfaltas – sutarčių paieška">');
    expect(html).toContain('<meta property="og:description" content="Sutarčių paieška. Filtrai: suma nuo 100 000 €.">');
    expect(html).toContain('<meta property="og:image" content="https://viespirkiai.org/sutartys.png?search=asfaltas&amp;sumaNuo=100000">');
    expect(html).toContain('<meta property="og:url" content="https://viespirkiai.org/?search=asfaltas&amp;sumaNuo=100000">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<link rel="canonical" href="https://viespirkiai.org/?search=asfaltas&amp;sumaNuo=100000">');
    // Ši versija indekse neturi konkuruoti su tikruoju puslapiu.
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('stays the plain challenge page outside the search routes', async () => {
    const html = await botChallengeResponse(null).text();

    expect(html).toContain('<title>Tikrinama naršyklė…</title>');
    expect(html).not.toContain('og:title');
  });

  it('escapes query text instead of letting it into the markup', async () => {
    const injected = describeSearchQuery('/', new URLSearchParams('search="><script>alert(1)</script>'))!;
    const html = await botChallengeResponse(injected).text();

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

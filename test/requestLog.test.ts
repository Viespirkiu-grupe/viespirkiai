import { describe, expect, it } from 'vitest';
import { getClientIp, makeRequestLogEntry } from '@/requestLog.mjs';

describe('request logging', () => {
  it('prefers the Cloudflare client IP over proxy and socket addresses', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.20, 10.0.0.1',
      'x-real-ip': '192.0.2.30',
    });

    expect(getClientIp(headers, '127.0.0.1')).toBe('203.0.113.10');
  });

  it('uses the preserved IPv6 address in Cloudflare Pseudo IPv4 mode', () => {
    const headers = new Headers({
      'cf-connecting-ip': '240.0.0.1',
      'cf-connecting-ipv6': '2001:db8::1234',
    });

    expect(getClientIp(headers)).toBe('2001:db8::1234');
  });

  it('falls back through the first forwarded address to the socket address', () => {
    expect(getClientIp(new Headers({
      'x-forwarded-for': '198.51.100.20, 10.0.0.1',
    }), '127.0.0.1')).toBe('198.51.100.20');
    expect(getClientIp(new Headers(), '127.0.0.1')).toBe('127.0.0.1');
  });

  it('creates a structured entry with method, URL and user agent', () => {
    const request = new Request('https://viespirkiai.org/paieska?q=keliai', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'user-agent': 'Example Browser/1.0',
      },
    });

    expect(makeRequestLogEntry(request, undefined, new Date('2026-07-30T12:00:00Z')))
      .toEqual({
        type: 'http_request',
        timestamp: '2026-07-30T12:00:00.000Z',
        method: 'POST',
        url: '/paieska?q=keliai',
        ip: '203.0.113.10',
        userAgent: 'Example Browser/1.0',
      });
  });
});

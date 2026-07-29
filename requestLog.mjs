/**
 * Return the original client address when the application is behind a proxy.
 *
 * Cloudflare's Pseudo IPv4 "Overwrite Headers" mode replaces
 * CF-Connecting-IP with a synthetic IPv4 address and preserves the real IPv6
 * address in CF-Connecting-IPv6, so that header takes precedence when present.
 * X-Forwarded-For is ordered client-first by conventional proxies.
 *
 * @param {Headers} headers
 * @param {string | undefined} socketAddress
 */
export function getClientIp(headers, socketAddress) {
  const forwardedFor = headers.get('x-forwarded-for')
    ?.split(',', 1)[0]
    ?.trim();

  return headers.get('cf-connecting-ipv6')?.trim()
    || headers.get('cf-connecting-ip')?.trim()
    || headers.get('true-client-ip')?.trim()
    || forwardedFor
    || headers.get('x-real-ip')?.trim()
    || socketAddress?.trim()
    || null;
}

/**
 * Convert Node's IncomingHttpHeaders to the Fetch Headers interface shared by
 * the standalone and development request loggers.
 *
 * @param {import('node:http').IncomingHttpHeaders} input
 */
export function nodeRequestHeaders(input) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * @param {{ method?: string, url?: string, headers: Headers }} request
 * @param {string | undefined} socketAddress
 * @param {Date} now
 */
export function makeRequestLogEntry(request, socketAddress, now = new Date()) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  return {
    type: 'http_request',
    timestamp: now.toISOString(),
    method: request.method ?? '',
    url: url.pathname + url.search,
    ip: getClientIp(request.headers, socketAddress),
    userAgent: request.headers.get('user-agent'),
  };
}

/** @param {unknown} value */
export function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

/** @param {import('node:http').IncomingMessage} request */
export function logNodeRequest(request) {
  const entry = makeRequestLogEntry(
    {
      method: request.method,
      url: request.url,
      headers: nodeRequestHeaders(request.headers),
    },
    request.socket.remoteAddress,
  );
  console.error(JSON.stringify(entry));
}

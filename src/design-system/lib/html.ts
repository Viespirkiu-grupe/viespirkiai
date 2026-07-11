/** Ekranuoja HTML metasimbolius, kad reikšmę būtų saugu įterpti į innerHTML /
 *  atributą. Priima bet ką — `null`/`undefined` virsta tuščia eilute. Vienas
 *  kanoninis variantas: ekranuoja & < > " ' (superaibė, tinka ir tekstui, ir
 *  atributams). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function jsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function externalLinkRel(target?: string, rel?: string): string | undefined {
  if (target !== '_blank') return rel;

  const values = new Set((rel ?? '').split(/\s+/).filter(Boolean));
  values.add('noopener');
  values.add('noreferrer');
  return [...values].join(' ');
}

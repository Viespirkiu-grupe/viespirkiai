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

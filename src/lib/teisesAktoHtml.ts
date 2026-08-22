const ETAR_HOSTS = new Set(['e-tar.lt', 'www.e-tar.lt']);

/**
 * e-TAR oficialiame HTML esančias nuorodas į kitus teisės aktus nukreipia į
 * mūsų akto puslapį. Failų, paieškos ir kitų e-TAR puslapių neliečia.
 */
export function rewriteETarLegalActLinks(html: string): string {
  return html.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi,
    (attribute, prefix: string, quote: string, rawHref: string) => {
      const href = rawHref.replace(/&amp;/gi, '&');
      let url: URL;
      try {
        url = new URL(href, 'https://www.e-tar.lt');
      } catch {
        return attribute;
      }

      // Reliatyvius adresus laikom e-TAR adresais tik kai jie prasideda jo
      // portalo keliu. Taip neliečiam dokumente pasitaikiusių vietinių inkarų.
      const absolute = /^(?:https?:)?\/\//i.test(href);
      if (absolute && !ETAR_HOSTS.has(url.hostname.toLowerCase())) return attribute;
      if (!absolute && !href.startsWith('/portal/')) return attribute;

      const legacyDocumentId = /^\/portal\/legalAct\.html$/i.test(url.pathname)
        ? url.searchParams.get('documentId')?.trim()
        : null;
      const match = url.pathname.match(/^\/portal\/lt\/legalAct\/([^/]+)(?:\/([^/]+))?\/?$/i);
      if (!match && !legacyDocumentId) return attribute;

      let legalActId: string;
      let version: string | undefined;
      try {
        legalActId = legacyDocumentId || decodeURIComponent(match![1]);
        version = match?.[2] ? decodeURIComponent(match[2]) : undefined;
      } catch {
        return attribute;
      }

      const localHref = `/teisesAktas/${encodeURIComponent(legalActId)}`
        + (version ? `/${encodeURIComponent(version)}` : '')
        + url.hash;
      return `${prefix}${quote}${localHref}${quote}`;
    },
  );
}

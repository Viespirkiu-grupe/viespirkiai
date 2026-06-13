const prefetchedUrls = new Set<string>();
let timeout: ReturnType<typeof setTimeout> | undefined;
let pendingAnchor: HTMLAnchorElement | undefined;

function isSlowConnection(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  return Boolean(connection?.saveData || /2g/.test(connection?.effectiveType ?? ''));
}

function prefetch(anchor: HTMLAnchorElement): void {
  if (anchor.dataset.astroPrefetch === 'false' || anchor.hasAttribute('download')) return;

  const url = new URL(anchor.href, location.href);
  const currentUrl = new URL(location.href);
  url.hash = '';
  currentUrl.hash = '';

  if (
    url.origin !== location.origin ||
    url.href === currentUrl.href ||
    prefetchedUrls.has(url.href) ||
    isSlowConnection()
  ) {
    return;
  }

  prefetchedUrls.add(url.href);
  void fetch(url, { credentials: 'same-origin', priority: 'low' }).catch(() => {
    prefetchedUrls.delete(url.href);
  });
}

function schedulePrefetch(anchor: HTMLAnchorElement): void {
  clearTimeout(timeout);
  pendingAnchor = anchor;
  timeout = setTimeout(() => {
    pendingAnchor = undefined;
    prefetch(anchor);
  }, 80);
}

function cancelPrefetch(anchor: HTMLAnchorElement): void {
  if (anchor !== pendingAnchor) return;
  clearTimeout(timeout);
  timeout = undefined;
  pendingAnchor = undefined;
}

function closestAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest('a[href]') : null;
}

document.addEventListener('mouseover', (event) => {
  const anchor = closestAnchor(event.target);
  const relatedTarget = event.relatedTarget;
  if (anchor && (!(relatedTarget instanceof Node) || !anchor.contains(relatedTarget))) schedulePrefetch(anchor);
});

document.addEventListener('mouseout', (event) => {
  const anchor = closestAnchor(event.target);
  const relatedTarget = event.relatedTarget;
  if (anchor && (!(relatedTarget instanceof Node) || !anchor.contains(relatedTarget))) cancelPrefetch(anchor);
});

document.addEventListener('focusin', (event) => {
  const anchor = closestAnchor(event.target);
  if (anchor) schedulePrefetch(anchor);
});

document.addEventListener('focusout', (event) => {
  const anchor = closestAnchor(event.target);
  if (anchor) cancelPrefetch(anchor);
});

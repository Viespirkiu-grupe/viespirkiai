// Open/close helpers for the generic Modal component: toggle [hidden] and lock
// the document scroll while a modal is open. Callers import these to open a
// modal on demand; Modal's own script handles closing (backdrop / ✕ / Escape).

export function openModal(target: string | HTMLElement): HTMLElement | null {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return null;
  el.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  return el;
}

export function closeModal(target: string | HTMLElement): void {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.hidden = true;
  document.documentElement.style.overflow = '';
}

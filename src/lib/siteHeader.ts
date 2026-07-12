// Svetainės antraštės (SiteHeaderShell) elgesys: temos perjungiklis, info-juostos
// „marquee" sinchronizavimas, antraštės aukščio CSS kintamasis, mobilus meniu ir
// slėpimas slenkant. Iškelta iš SiteHeaderShell.astro inline script'ų (tipizavimui
// ir kad sun/moon SVG bei aukščio skaičiavimas turėtų vieną šaltinį).

// Vienas SVG šaltinis — naudojamas ir SSR pradinei ikonai (frontmatter), ir
// perjungiant temą kliente.
export const SUN_SVG =
  '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>';
export const MOON_SVG =
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

// Antraštės aukštis (info-juosta + navbar) → --site-header-offset. Vienas skaičiavimas,
// kviečiamas ir iš anksti (inline, prieš pirmą piešinį — FOUC prevencija), ir per
// initSiteHeader (resize / pageshow / šriftams pasikrovus).
export function syncHeaderOffset() {
  const navbar = document.querySelector<HTMLElement>('.navbar');
  if (!navbar) return;
  const infoBanner = document.querySelector<HTMLElement>('.navbar-info-banner');
  const total = (infoBanner ? infoBanner.offsetHeight : 0) + navbar.offsetHeight;
  document.documentElement.style.setProperty('--site-header-offset', `${total}px`);
}

export function initSchemeToggle() {
  const schemeToggle = document.getElementById('schemeToggle') as HTMLButtonElement | null;

  const updateSchemeIcon = (scheme: string) => {
    const svg = document.getElementById('schemeIcon');
    if (svg) svg.innerHTML = scheme === 'dark' ? SUN_SVG : MOON_SVG;
  };

  const syncScheme = () => {
    const cookie = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('colorScheme='));
    const scheme = cookie ? cookie.split('=')[1] : 'auto';
    const isDark = scheme === 'dark' || (scheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    updateSchemeIcon(isDark ? 'dark' : 'light');
  };

  schemeToggle?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.cookie = 'colorScheme=' + next + ';path=/;max-age=31536000';
    updateSchemeIcon(next);
  });

  syncScheme();
  window.addEventListener('pageshow', (e) => { if (e.persisted) syncScheme(); });
}

export function initSiteHeader() {
  const hamburger = document.getElementById('navHamburger');
  const mobileNav = document.getElementById('navMobile');
  const header = document.querySelector('header');
  const infoBannerMarquee = document.querySelector<HTMLElement>('.navbar-info-banner-marquee');
  const infoBannerTrack = document.querySelector<HTMLElement>('.navbar-info-banner-track');
  const infoBannerTextPrimary = document.querySelector<HTMLElement>('.navbar-info-banner-text[data-copy="primary"]');

  function syncInfoBannerMarquee() {
    if (!infoBannerMarquee || !infoBannerTrack || !infoBannerTextPrimary) return;
    infoBannerMarquee.dataset.marquee = 'idle';
    infoBannerTrack.style.removeProperty('--banner-step');
    infoBannerTrack.style.removeProperty('--banner-gap');
    infoBannerTrack.style.removeProperty('--banner-duration');
    const containerWidth = infoBannerMarquee.clientWidth;
    const textWidth = infoBannerTextPrimary.scrollWidth;
    if (!containerWidth || !textWidth) return;
    const availableWidth = Math.max(containerWidth - 32, 0);
    if (textWidth <= availableWidth) { infoBannerMarquee.dataset.marquee = 'idle'; return; }
    const gap = Math.max(128, containerWidth - textWidth + 24);
    const step = textWidth + gap;
    const duration = Math.max(10, step / 52);
    infoBannerTrack.style.setProperty('--banner-gap', `${gap}px`);
    infoBannerTrack.style.setProperty('--banner-step', `${step}px`);
    infoBannerTrack.style.setProperty('--banner-duration', `${duration.toFixed(2)}s`);
    infoBannerMarquee.dataset.marquee = 'running';
  }

  syncHeaderOffset();
  syncInfoBannerMarquee();
  window.addEventListener('resize', syncHeaderOffset, { passive: true });
  window.addEventListener('resize', syncInfoBannerMarquee, { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(() => { syncHeaderOffset(); syncInfoBannerMarquee(); }).catch(() => {});

  hamburger?.addEventListener('click', () => {
    if (!mobileNav) return;
    const open = mobileNav.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    mobileNav.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('nav-open', open);
  });

  let lastY = 0;
  window.addEventListener('scroll', () => {
    if (!header) return;
    const y = window.scrollY;
    if (y > lastY && y > 60) header.classList.add('nav-hidden');
    else header.classList.remove('nav-hidden');
    lastY = y;
  }, { passive: true });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { syncHeaderOffset(); syncInfoBannerMarquee(); }
  });
}

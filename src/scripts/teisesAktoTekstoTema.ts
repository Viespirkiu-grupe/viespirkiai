// Akto teksto rėmelio valdymas: tema, slinkties vieta ir turinio rodyklės
// sekimas.
//
// Tekstas yra izoliuotame <iframe> su atskiru vidiniu adresu. Jis
// yra to paties kilmės (`allow-same-origin`), tad puslapis gali skaityti jo
// slinktį ir dalių pozicijas; skriptų tame dokumente nėra ir būti negali —
// `sandbox` neturi `allow-scripts`, o CSP yra `default-src 'none'`.
//
// Temos rėmelis pats nemato (siteHeader.ts tik perjungia `.dark` klasę ir įrašo
// slapuką, puslapio neperkraudamas), tad ji perduodama `?scheme=` adrese.
// Perkraunam tik tada, kai tema tikrai pasikeitė: atsakymas kešuojamas valandai,
// tad perjungimas atrodo momentinis, o slinkties vieta atkuriama.

/** Kiek pikselių nuo rėmelio viršaus laikom „dabartine" akto vieta. */
const SKAITYMO_LINIJA = 90;

function frameEl() {
  return document.getElementById('taTekstas') as HTMLIFrameElement | null;
}

/**
 * Telefono akto puslapyje rėmelis yra tik paspaudžiama ištrauka, ne antras
 * slinkties konteineris. Užrakinam patį iframe dokumentą, nes vien tėvinio
 * elemento `pointer-events` Android naršyklėse vizualios scrollbar nepaslepia.
 */
export function initTeisesAktoMobiliaPerziura() {
  const frame = document.querySelector<HTMLIFrameElement>('.ta-panel:not(.is-reader) #taTekstas');
  if (!frame) return;

  const mq = window.matchMedia('(max-width: 640px)');
  const apply = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const overflow = mq.matches ? 'hidden' : '';
    doc.documentElement.style.overflow = overflow;
    if (doc.body) doc.body.style.overflow = overflow;
  };

  frame.addEventListener('load', apply);
  mq.addEventListener('change', apply);
  if (frame.contentDocument?.readyState === 'complete') apply();
}

/** Per MPA navigaciją perduoda jau ekrane pritaikytą temą naujam skaitytuvui. */
export function initTeisesAktoSkaitytuvoNuorodas() {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[data-ta-skaitytuvas]');
  const sync = (link: HTMLAnchorElement) => {
    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('scheme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    link.href = `${url.pathname}${url.search}${url.hash}`;
  };

  links.forEach((link) => {
    link.addEventListener('pointerdown', () => sync(link));
    link.addEventListener('click', () => sync(link));
    link.addEventListener('focus', () => sync(link));
  });
}

export function initTeisesAktoTekstoTema() {
  const frame = frameEl();
  const base = frame?.dataset.base;
  if (!frame || !base) return;

  // Turinio nuorodą prieš pat paspaudimą suvienodinam su tuo, kas rėmelyje jau
  // atidaryta: jei adresai skiriasi kad ir vien `?scheme=`, naršyklė krauna
  // dokumentą iš naujo (dideliam aktui — matomas strigimas), o sutampant lieka
  // tik šuolis prie inkaro tame pačiame dokumente.
  document.querySelectorAll<HTMLAnchorElement>('a[data-ta-dalis]').forEach((link) => {
    link.addEventListener('click', () => {
      link.href = `${frame.src.split('#')[0]}#${encodeURIComponent(link.dataset.taDalis || '')}`;
    });
  });

  // Ką rėmelis rodo dabar: arba serverio įrašytą `?scheme=`, arba — kai puslapis
  // atiduotas „auto" režimu — tą pačią temą, kurią sprendžia `prefers-color-scheme`
  // ir puslapio `.dark` klasė. Tad pirmo krovimo dubliuoti nereikia.
  const nustatyta = new URL(frame.src, window.location.origin).searchParams.get('scheme');
  let taikoma = nustatyta
    ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

  const apply = () => {
    const scheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    if (scheme === taikoma) return;
    taikoma = scheme;

    // Skaitymo vieta išlieka: pasižymim slinktį ir grąžinam ją, kai naujos
    // temos dokumentas atsikrauna.
    const y = frame.contentWindow?.scrollY ?? 0;
    frame.addEventListener('load', () => frame.contentWindow?.scrollTo(0, y), { once: true });
    const url = new URL(base, window.location.origin);
    url.searchParams.set('scheme', scheme);
    frame.src = `${url.pathname}${url.search}`;
  };

  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

/**
 * Turinio rodyklė seka skaitomą vietą: slenkant aktą pažymima ta dalis, kuri
 * dabar yra ekrane, ir atviras sąrašas pats prislenka prie jos.
 */
export function initTeisesAktoTurinioSekimas() {
  const frame = frameEl();
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-ta-dalis]'));
  if (!frame || !links.length) return;

  const sarasas = document.querySelector<HTMLElement>('.ta-toc');
  // Dalių pozicijos matuojamos VIENĄ kartą po dokumento pakrovimo. Matuoti jas
  // slenkant (juolab kas kadrą) reikštų priverstinį maketo perskaičiavimą
  // šimtams mazgų kiekviename žingsnyje — nuo to akto slinktis ir užspringo.
  let dalys: { id: string; virsus: number }[] = [];
  let laukiaKadro = false;

  const pazymeti = () => {
    const win = frame.contentWindow;
    if (!win || !dalys.length) return;
    const riba = win.scrollY + SKAITYMO_LINIJA;

    let esama = dalys[0].id;
    for (const dalis of dalys) {
      if (dalis.virsus <= riba) esama = dalis.id;
      else break;
    }

    for (const link of links) {
      const aktyvus = link.dataset.taDalis === esama;
      if (link.classList.contains('is-active') === aktyvus) continue;   // be tuščių rašymų
      link.classList.toggle('is-active', aktyvus);
      if (!aktyvus) { link.removeAttribute('aria-current'); continue; }

      link.setAttribute('aria-current', 'true');
      // Prislenkam tik atvirą sąrašą — kitaip judintume paslėptą turinį.
      if (sarasas?.closest('details')?.open) {
        const s = sarasas.getBoundingClientRect();
        const l = link.getBoundingClientRect();
        if (l.top < s.top || l.bottom > s.bottom) {
          sarasas.scrollTop += l.top - s.top - s.height / 2 + l.height / 2;
        }
      }
    }
  };

  // Slinkties įvykių būna dešimtys per sekundę — darbą atliekam ne dažniau kaip
  // kartą per kadrą ir tik skaitymo fazėje.
  const suplanuoti = () => {
    if (laukiaKadro) return;
    laukiaKadro = true;
    requestAnimationFrame(() => { laukiaKadro = false; pazymeti(); });
  };

  const israsyti = () => {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return;   // kito kilmės dokumento neskaitysim
    dalys = links
      .map((link) => {
        const el = doc.getElementById(link.dataset.taDalis || '');
        return el
          ? { id: link.dataset.taDalis || '', virsus: el.getBoundingClientRect().top + win.scrollY }
          : null;
      })
      .filter((d): d is { id: string; virsus: number } => d != null);
    pazymeti();
  };

  const surinkti = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    israsyti();
    // Klausytojai kabinami ant kiekvieno naujo dokumento (perkrovus temą jie
    // dingsta kartu su senuoju langu). Slinktis, priklausomai nuo naršyklės,
    // ateina arba per langą, arba per dokumentą — klausom abiejų.
    frame.contentWindow?.addEventListener('scroll', suplanuoti, { passive: true });
    doc.addEventListener('scroll', suplanuoti, { passive: true });
    // Pasikeitus rėmelio pločiui tekstas persilaužo — pozicijas persimatuojam.
    new ResizeObserver(israsyti).observe(frame);
  };

  frame.addEventListener('load', surinkti);
  if (frame.contentDocument?.readyState === 'complete') surinkti();
}

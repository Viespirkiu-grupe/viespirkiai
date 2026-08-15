// „Dvigubai sticky" šoninė filtrų juosta paieškos puslapiuose.
//
// Kai juosta aukštesnė už matomą sritį, paprastas `position: sticky; top: X`
// netinka — apačios nepasieksi. Norima elgsena: slenkant žemyn juosta slenka
// kartu, kol prilimpa APAČIA prie lango apačios; slenkant aukštyn — atlimpa,
// slenka kartu, kol prilimpa VIRŠUS po sticky navbar'u.
//
// Mechanika: `top` perjungiamas pagal slinkimo kryptį, o `margin-top` „įšaldo"
// statinę poziciją ties dabartine vieta, kad perjungimo momentu nebūtų šuolio.
//
// SVARBU: stiliai rašomi TIK keičiantis būsenai (kryptis / prilipimo taškas),
// niekada kas kadrą. Chrome slinkimą apdoroja kompozitoriuje, tad kas kadrą
// rašomas `top`/`margin-top` nusėda kadru vėliau nei pats slinkimas — juosta
// ima virpėti (matėsi tik Chrome ir tik slenkant aukštyn, nes ten anksčiau
// buvo perskaičiuojama kas kadrą). Būsenose stiliai savaime teisingi:
//  - `bottom`: top = vh - railH → prilipusi apačia, slenkant žemyn nekinta;
//  - `free`:   top „įšaldytas" ties dabartine vieta, o margin sulygina statinę
//              poziciją su ja, tad slenkant aukštyn juosta natūraliai atlimpa
//              ir keliauja su turiniu — be jokių papildomų rašymų;
//  - `top`:    top = navbar aukštis, margin = 0 → prilipusi po navbar'u; grįžus
//              į puslapio viršų sticky atlimpa savaime, tarpo nelieka.
export function initStickyRail(railSel = '.sf-rail') {
  const rail = document.querySelector<HTMLElement>(railSel);
  const parent = rail?.parentElement;
  if (!rail || !parent) return;

  const nav = document.querySelector<HTMLElement>('.site-header-shell .navbar');
  const mq = window.matchMedia('(min-width: 901px)');
  let lastY = window.scrollY;
  type Mode = 'none' | 'mobile' | 'fit' | 'top' | 'bottom' | 'free';
  let mode: Mode = 'none';

  const update = () => {
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;

    if (!mq.matches) {
      // Mobilus vieno stulpelio maketas — sticky nedalyvauja.
      if (mode !== 'mobile') {
        rail.style.top = '';
        rail.style.marginTop = '';
        mode = 'mobile';
      }
      return;
    }

    const stickTop = nav?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const railH = rail.offsetHeight;

    // Juosta telpa ekrane — paprastas top-sticky po navbar'u.
    if (railH + stickTop <= vh) {
      if (mode !== 'fit') {
        rail.style.top = `${stickTop}px`;
        rail.style.marginTop = '0px';
        mode = 'fit';
      }
      return;
    }

    const railTop = rail.getBoundingClientRect().top;
    const parentTop = parent.getBoundingClientRect().top;
    // „Įšaldo" statinę poziciją ties dabartine matoma vieta, kad perjungiant
    // prilipimo tašką nebūtų šuolio.
    const freezeStaticPosition = () => {
      rail.style.marginTop = `${Math.max(0, railTop - parentTop)}px`;
    };

    if (dy > 0) {
      // Žemyn: leidžiam juostai kilti, kol apačia prilips prie lango apačios.
      if (mode !== 'bottom') {
        freezeStaticPosition();
        rail.style.top = `${vh - railH}px`;
        mode = 'bottom';
      }
    } else if (dy < 0 || mode === 'none') {
      if (railTop >= stickTop) {
        // Pasiekė navbar'ą — prilimpa viršumi. margin nebereikalingas: statinė
        // pozicija lieka aukščiau prilipimo taško, o puslapio viršuje sticky
        // atlimpa pati, tad tarpo neatsiranda.
        if (mode !== 'top') {
          rail.style.top = `${stickTop}px`;
          rail.style.marginTop = '0px';
          mode = 'top';
        }
      } else if (mode !== 'free') {
        // Dar nepasiekė: „įšaldom" vietoje (top = dabartinė pozicija) ir
        // inkaruojam statinę poziciją čia — juosta slenka žemyn su turiniu.
        freezeStaticPosition();
        rail.style.top = `${railTop}px`;
        mode = 'free';
      }
    }
  };

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', () => { mode = 'none'; update(); });
  update();
}

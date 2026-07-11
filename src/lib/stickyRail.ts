// „Dvigubai sticky" šoninė filtrų juosta paieškos puslapiuose.
//
// Kai juosta aukštesnė už matomą sritį, paprastas `position: sticky; top: X`
// netinka — apačios nepasieksi. Norima elgsena: slenkant žemyn juosta slenka
// kartu, kol prilimpa APAČIA prie lango apačios; slenkant aukštyn — atlimpa,
// slenka kartu, kol prilimpa VIRŠUS po sticky navbar'u.
//
// Mechanika: `top` perjungiamas pagal slinkimo kryptį, o `margin-top` „įšaldo"
// statinę poziciją ties dabartine vieta, kad perjungimo momentu nebūtų šuolio.
// Prilipus viršuje margin kas kadrą mažinamas, tad grįžus į puslapio viršų
// neliktų tarpo.
export function initStickyRail(railSel = '.sf-rail') {
  const rail = document.querySelector<HTMLElement>(railSel);
  const parent = rail?.parentElement;
  if (!rail || !parent) return;

  const nav = document.querySelector<HTMLElement>('.site-header-shell .navbar');
  const mq = window.matchMedia('(min-width: 901px)');
  let lastY = window.scrollY;

  const update = () => {
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;

    if (!mq.matches) {
      // Mobilus vieno stulpelio maketas — sticky nedalyvauja.
      rail.style.top = '';
      rail.style.marginTop = '';
      return;
    }

    const stickTop = nav?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    const railH = rail.offsetHeight;
    const parentTop = parent.getBoundingClientRect().top;
    const railTop = rail.getBoundingClientRect().top;

    // Juosta telpa ekrane — paprastas top-sticky po navbar'u.
    if (railH + stickTop <= vh) {
      rail.style.top = `${stickTop}px`;
      rail.style.marginTop = '0px';
      return;
    }

    if (dy > 0) {
      // Žemyn: leidžiam juostai kilti, kol apačia prilips prie lango apačios.
      // margin paliekam įšaldytą — statinė pozicija lieka kur buvusi, tad
      // perjungiant iš viršaus prilipimo šuolio nėra.
      rail.style.top = `${vh - railH}px`;
    } else if (dy < 0) {
      if (railTop >= stickTop) {
        // Pasiekė navbar'ą — prilimpa viršumi. margin sekamas kas kadrą, kad
        // statinė pozicija liktų ties linija ir grįžus į viršų tarpo neliktų.
        rail.style.top = `${stickTop}px`;
        rail.style.marginTop = `${Math.max(0, stickTop - parentTop)}px`;
      } else {
        // Dar nepasiekė: „įšaldom" vietoje (top = dabartinė pozicija) ir
        // inkaruojam statinę poziciją čia — juosta slenka žemyn su turiniu.
        rail.style.top = `${railTop}px`;
        rail.style.marginTop = `${Math.max(0, railTop - parentTop)}px`;
      }
    }
  };

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

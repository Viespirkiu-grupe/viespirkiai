// Teksto rėmo juostelės meniukai („Turinys" ir redakcijos).
//
// `<details>` pats savaime yra tik atveriamas blokas — kaip meniu jis elgiasi
// tik pridėjus tai, ko naudotojas tikisi: paspaudus šalia — užsidaro, Esc —
// užsidaro ir grąžina fokusą į mygtuką, atvėrus vieną — antras užsiveria, o
// pasirinkus įrašą meniu dingsta (nes tekstas šalia jau pasikeitė).

export function initTeisesAktoJuosta() {
  const bar = document.querySelector<HTMLElement>('.ta-panel-bar');
  if (!bar) return;

  const menus = Array.from(bar.querySelectorAll<HTMLDetailsElement>('details'));
  if (!menus.length) return;

  const close = (except?: HTMLDetailsElement) => {
    for (const menu of menus) {
      if (menu !== except) menu.open = false;
    }
  };

  for (const menu of menus) {
    // Vienu metu atviras tik vienas.
    menu.addEventListener('toggle', () => { if (menu.open) close(menu); });

    // Pasirinkus įrašą meniu nebereikalingas.
    menu.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a')) menu.open = false;
    });
  }

  document.addEventListener('click', (event) => {
    if (!bar.contains(event.target as Node)) close();
  });

  // Paspaudus į patį akto tekstą, `click` lieka <iframe> viduje ir tėvinio
  // dokumento nepasiekia — vienintelis ženklas, kad fokusas išėjo, yra lango
  // `blur`. Be šito meniu liktų atviras virš teksto.
  window.addEventListener('blur', () => close());

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = menus.find((menu) => menu.open);
    if (!open) return;
    open.open = false;
    open.querySelector('summary')?.focus();
  });
}

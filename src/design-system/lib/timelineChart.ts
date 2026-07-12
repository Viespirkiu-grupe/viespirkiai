// TimelineColumnChart interaktyvumas: užvedus / fokusavus stulpelį atnaujinamas
// gyvas rodmuo (skaičius + etiketė) ir paryškinamas tas stulpelis; palikus
// diagramą grąžinama ramybės būsena (aktyvi/piko etiketė). Stulpelio paspaudimas
// — įprasta nuoroda (filtras), JS tam nereikalingas. Iškelta iš
// DokumentaiStatsPanel inline script'o į bendrą primityvą.
export function initTimelineColumnCharts(scope: ParentNode = document) {
  for (const tl of scope.querySelectorAll<HTMLElement>('.tlc')) {
    const chart = tl.querySelector<HTMLElement>('.tlc__chart');
    const out = tl.querySelector<HTMLElement>('.tlc__readout');
    const labelEl = out?.querySelector<HTMLElement>('.tlc__readout-label');
    const countEl = out?.querySelector<HTMLElement>('.tlc__readout-count');
    if (!chart || !out || !labelEl || !countEl) continue;
    const cols = [...chart.querySelectorAll<HTMLElement>('.tlc__col')];
    const defLabel = out.dataset.defaultLabel ?? '';
    const defCount = out.dataset.defaultCount ?? '';

    const show = (col: HTMLElement) => {
      for (const c of cols) c.classList.toggle('is-hover', c === col);
      labelEl.textContent = col.dataset.label ?? '';
      countEl.textContent = col.dataset.count ?? '';
    };
    const reset = () => {
      for (const c of cols) c.classList.remove('is-hover');
      labelEl.textContent = defLabel;
      countEl.textContent = defCount;
    };

    for (const col of cols) {
      col.addEventListener('pointerenter', () => show(col));
      col.addEventListener('focus', () => show(col));
    }
    chart.addEventListener('pointerleave', reset);
    chart.addEventListener('focusout', (e) => {
      if (!chart.contains(e.relatedTarget as Node)) reset();
    });
  }
}

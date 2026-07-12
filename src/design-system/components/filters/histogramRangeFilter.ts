// Dvipusio histogramos + slankiklio filtro elgesys. Vienas engine dviem režimams:
//   mode="number" — reikšmės skaičiai (pvz. €), laukeliai type=number;
//   mode="date"   — reikšmės epoch-millis, laukeliai type=date.
// Slankiklis dirba tomis pačiomis koordinatėmis kaip histograma: kiekvienas kaušas
// užima vienodą pločio dalį (flex:1), tad reikšmė ↔ pozicija skaičiuojama atkarpomis
// per kaušus. Vilkant laukeliai ir „burbulai" atsinaujina realiu laiku; filtras
// pritaikomas paleidus (change) — telefone (≤900px) neperkraunam, nes laukeliai yra
// GET formos dalis ir pritaikomi per „Ieškoti".
//
// Konfigūracija skaitoma iš data-atributų ant šakninio [data-hrf] elemento, tad
// keli filtrai viename puslapyje veikia nepriklausomai.

const STEPS = 1000;
const DAY = 86_400_000;

function initOne(root: HTMLElement) {
  // Be duomenų slankiklio/diagramos nėra — nėra ko inicializuoti.
  const slider = root.querySelector('.hrf-slider');
  if (!slider) return;

  const mode = (root.getAttribute('data-mode') === 'date' ? 'date' : 'number') as 'number' | 'date';
  const domainMin = Number(root.getAttribute('data-domain-min')) || 0;
  const domainMax = Number(root.getAttribute('data-domain-max')) || (domainMin + 1);
  const unit = root.getAttribute('data-unit') || '';
  const redirectBase = root.getAttribute('data-redirect-base') || '/';
  const nameFrom = root.getAttribute('data-name-from') || '';
  const nameTo = root.getAttribute('data-name-to') || '';

  const hMin = root.querySelector<HTMLInputElement>('.hrf-handle--min')!;
  const hMax = root.querySelector<HTMLInputElement>('.hrf-handle--max')!;
  const rangeEl = root.querySelector<HTMLElement>('.hrf-range')!;
  const bubMin = root.querySelector<HTMLElement>('.hrf-bubble--min')!;
  const bubMax = root.querySelector<HTMLElement>('.hrf-bubble--max')!;
  const inMin = root.querySelector<HTMLInputElement>('.hrf-input--min')!;
  const inMax = root.querySelector<HTMLInputElement>('.hrf-input--max')!;
  const bars = [...root.querySelectorAll<HTMLElement>('.hrf-bar')];

  const bkts = bars.map((bar) => ({
    from: Number(bar.dataset.from),
    to: bar.dataset.to ? Number(bar.dataset.to) : domainMax,
  }));
  if (bkts.length === 0) bkts.push({ from: domainMin, to: domainMax });
  const N = bkts.length;

  // frac: reikšmė -> pozicijos dalis 0..1 (atkarpomis per kaušus).
  const frac = (v: number) => {
    if (v <= domainMin) return 0;
    if (v >= domainMax) return 1;
    for (let i = 0; i < N; i++) {
      const { from, to } = bkts[i];
      if (v < to || i === N - 1) {
        const local = to > from ? (v - from) / (to - from) : 0;
        return (i + Math.min(1, Math.max(0, local))) / N;
      }
    }
    return 1;
  };
  const posToVal = (p: number) => {
    if (p <= 0) return domainMin;
    if (p >= STEPS) return domainMax;
    const x = (p / STEPS) * N;
    const i = Math.min(N - 1, Math.floor(x));
    const { from, to } = bkts[i];
    return from + (x - i) * (to - from);
  };
  const valToPos = (v: number) => Math.round(frac(v) * STEPS);

  // Režimui specifiškos funkcijos: reikšmės „prigludimas", formatavimas,
  // laukelio reikšmė, laukelio skaitymas.
  const niceNum = (v: number) => {
    if (v <= 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / mag) * mag;
  };
  const snapDay = (ms: number) => Math.round(ms / DAY) * DAY;
  const toDateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const snap = mode === 'date' ? snapDay : niceNum;

  const fmt = (v: number): string => {
    if (mode === 'date') return new Date(v).toLocaleDateString('lt-LT');
    const suffix = unit ? ' ' + unit : '';
    if (v >= 1e6) return (v / 1e6).toLocaleString('lt-LT', { maximumFractionDigits: 1 }) + ' mln.' + suffix;
    if (v >= 1e3) return Math.round(v / 1e3).toLocaleString('lt-LT') + ' tūkst.' + suffix;
    return Math.round(v).toLocaleString('lt-LT') + suffix;
  };
  const toFieldValue = (v: number) => (mode === 'date' ? toDateStr(v) : String(v));
  const readInput = (el: HTMLInputElement): number | null => {
    if (mode === 'date') {
      const t = Date.parse(el.value || '');
      return Number.isFinite(t) ? t : null;
    }
    const n = parseFloat((el.value || '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  let minVal = readInput(inMin) ?? domainMin;
  let maxVal = readInput(inMax) ?? domainMax;

  function paint() {
    const lo = frac(minVal) * 100;
    const hi = frac(maxVal) * 100;
    rangeEl.style.left = lo + '%';
    rangeEl.style.width = Math.max(0, hi - lo) + '%';
    bubMin.style.left = lo + '%';
    bubMax.style.left = hi + '%';
    bubMin.textContent = fmt(minVal);
    // Skaičių režime prie viršutinės ribos rodom „…+"; datos režime — pačią datą.
    bubMax.textContent = mode === 'number' && maxVal >= domainMax ? fmt(domainMax) + '+' : fmt(maxVal);
    const effMax = maxVal >= domainMax ? Infinity : maxVal;
    for (const bar of bars) {
      const from = Number(bar.dataset.from);
      const to = bar.dataset.to ? Number(bar.dataset.to) : Infinity;
      bar.classList.toggle('is-active', to > minVal && from < effMax);
    }
  }

  function syncFromSlider() {
    let a = Number(hMin.value);
    let b = Number(hMax.value);
    if (a > b) [a, b] = [b, a];
    minVal = a <= 0 ? domainMin : snap(posToVal(a));
    maxVal = b >= STEPS ? domainMax : snap(posToVal(b));
    inMin.value = minVal > domainMin ? toFieldValue(minVal) : '';
    inMax.value = maxVal < domainMax ? toFieldValue(maxVal) : '';
    paint();
  }
  function syncFromInputs() {
    minVal = Math.max(domainMin, readInput(inMin) ?? domainMin);
    maxVal = readInput(inMax) ?? domainMax;
    if (maxVal <= 0) maxVal = domainMax;
    if (minVal > maxVal) minVal = maxVal;
    hMin.value = String(valToPos(minVal));
    hMax.value = String(maxVal >= domainMax ? STEPS : valToPos(maxVal));
    paint();
  }
  function commit() {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    const p = new URLSearchParams(location.search);
    if (minVal > domainMin) p.set(nameFrom, toFieldValue(Math.round(minVal))); else p.delete(nameFrom);
    if (maxVal < domainMax) p.set(nameTo, toFieldValue(Math.round(maxVal))); else p.delete(nameTo);
    p.delete('page');
    location.href = redirectBase + '?' + p.toString();
  }

  hMin.value = String(valToPos(minVal));
  hMax.value = String(maxVal >= domainMax ? STEPS : valToPos(maxVal));
  paint();

  // Burbulų rodymą tvarko CSS (:active / :focus-visible ant rankenėlės), tad
  // jie niekada „neįstringa" — čia tik atnaujinam reikšmes ir pritaikom paleidus.
  hMin.addEventListener('input', syncFromSlider);
  hMax.addEventListener('input', syncFromSlider);
  hMin.addEventListener('change', commit);
  hMax.addEventListener('change', commit);
  for (const el of [inMin, inMax]) {
    el.addEventListener('input', syncFromInputs);
    el.addEventListener('change', commit);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
  }
}

export function initHistogramRangeFilters(scope: ParentNode = document) {
  for (const root of scope.querySelectorAll<HTMLElement>('[data-hrf]')) initOne(root);
}

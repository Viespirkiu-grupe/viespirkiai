// Paieškos pasiūlymų (autocomplete) elgesys bendram <SearchForm> langeliui.
// Prisikabina prie #searchForm / #search / .search-bar ir po langeliu parodo gyvą,
// diakritiniam ženklui nejautrų pasiūlymų sąrašą, maitinamą /api/searchSuggestion.
// Iškelta iš SearchSuggest.astro inline script'o (tipizavimui ir atskyrimui nuo
// markup'o). Konfigūracija (saltinis) skaitoma iš .search-suggest-config data-atr.
interface Suggestion { id: string; pavadinimas: string; saltinis: string; count: number; }

const SALTINIS_VIENETAS: Record<string, string> = {
  sutartysPavadinimai: 'sutarčių',
};

// Indeksais sutampantis (1:1) diakritikų pašalinimas, kad paryškinimo intervalai
// tiktų originaliam tekstui (ė -> e, bet ilgis nekinta).
export function fold(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const f = str.charAt(i).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += f.length === 1 ? f : str.charAt(i).toLowerCase();
  }
  return out;
}

export function highlightInto(el: HTMLElement, text: string, query: string) {
  el.textContent = '';
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) { el.textContent = text; return; }
  const hay = fold(text);
  const ranges: [number, number][] = [];
  for (const tok of tokens) {
    let from = 0;
    while (from < hay.length) {
      const idx = hay.indexOf(tok, from);
      if (idx === -1) break;
      ranges.push([idx, idx + tok.length]);
      from = idx + tok.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let cur = 0;
  for (const [s, e] of merged) {
    if (s > cur) el.appendChild(document.createTextNode(text.slice(cur, s)));
    const m = document.createElement('mark');
    m.textContent = text.slice(s, e);
    el.appendChild(m);
    cur = e;
  }
  if (cur < text.length) el.appendChild(document.createTextNode(text.slice(cur)));
}

const SEARCH_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
const DOC_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 13h6M9 17h4"/></svg>';
// Juridiniam asmeniui (JAR kolekcijos pasiūlymui) – pastato ikona, kad įmonės
// vizualiai skirtųsi nuo dokumentų eilučių.
const BUILDING_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 21V9h3a1 1 0 0 1 1 1v11"/><path d="M8 7h2M8 11h2M8 15h2"/></svg>';

export function initSearchSuggest() {
  const form = document.getElementById('searchForm') as HTMLFormElement | null;
  const bar = form?.querySelector('.search-bar') as HTMLElement | null;
  const input = document.getElementById('search') as HTMLInputElement | null;
  if (!form || !bar || !input) return;

  const cfg = document.querySelector<HTMLElement>('.search-suggest-config');
  const SALTINIS = cfg?.dataset.saltinis || '';

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'searchSuggestPanel');
  bar.classList.add('ss-has-suggest');

  const panel = document.createElement('div');
  panel.className = 'ss-suggest-panel';
  panel.id = 'searchSuggestPanel';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  const list = document.createElement('div');
  list.className = 'ss-suggest-list';
  const foot = document.createElement('div');
  foot.className = 'ss-suggest-foot';
  foot.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> naršyti</span><span><kbd>↵</kbd> pasirinkti</span><span><kbd>esc</kbd> užverti</span>';
  panel.append(list, foot);
  bar.appendChild(panel);

  type Item = { kind: 'freeform' | 'suggestion'; label: string; sugg?: Suggestion };
  // items[0] visada freeform ("Ieškoti …"); items[1..] – pasiūlymai iš tinklo.
  let items: Item[] = [{ kind: 'freeform', label: '' }];
  let active = -1;
  let open = false;
  let sendSeq = 0;       // didėja su kiekviena išsiųsta užklausa
  let renderedSeq = -1;  // paskutinio ATVAIZDUOTO atsakymo seq
  let lastQuery = '';
  let dismissed = false; // vartotojas užvėrė panelę (Esc / paspaudimas šalia) –
                         // vėluojantis tinklo atsakymas jos neatidaro iš naujo

  // ── Freeform įrašas: PERSISTENTUS DOM mazgas ────────────────────────────────
  // Pirmoji eilutė ("Ieškoti „…“") gyvena nuolat ir atnaujinama TIK lokaliai –
  // perrašom jos teksto mazgą su kiekvienu paspaudimu. Tinklo atsakymai jos
  // niekada neperpiešia, todėl ji nemirksi, panelė nešokčioja, o Enter taikinys
  // visada atitinka tai, kas įvesta.
  const freeformBtn = document.createElement('button');
  freeformBtn.type = 'button';
  freeformBtn.className = 'ss-suggest-item';
  freeformBtn.setAttribute('role', 'option');
  const freeformGlyph = document.createElement('span');
  freeformGlyph.className = 'ss-suggest-glyph';
  freeformGlyph.innerHTML = SEARCH_GLYPH;
  const freeformTitle = document.createElement('span');
  freeformTitle.className = 'ss-suggest-title';
  freeformTitle.append('Ieškoti „');
  const freeformLabel = document.createElement('span');
  freeformLabel.className = 'ss-suggest-q';
  freeformTitle.append(freeformLabel, '“');
  freeformBtn.append(freeformGlyph, freeformTitle);
  freeformBtn.addEventListener('mouseenter', () => setActive(0));
  freeformBtn.addEventListener('mousedown', (e) => e.preventDefault()); // išlaikom fokusą
  freeformBtn.addEventListener('click', () => choose(items[0]));
  list.appendChild(freeformBtn);

  function setOpen(next: boolean) {
    open = next;
    panel.hidden = !next;
    input!.setAttribute('aria-expanded', String(next));
    if (!next) setActive(-1);
  }

  function setActive(i: number) {
    active = i;
    const opts = list.querySelectorAll<HTMLElement>('.ss-suggest-item');
    opts.forEach((o, idx) => {
      const on = idx === i;
      o.classList.toggle('is-active', on);
      o.setAttribute('aria-selected', String(on));
      if (on) o.scrollIntoView({ block: 'nearest' });
    });
  }

  // Lokalus, pigus freeform atnaujinimas: tik teksto mazgas, jokio perpiešimo.
  function updateFreeform(q: string) {
    items[0] = { kind: 'freeform', label: q };
    freeformLabel.textContent = q;
  }

  // Perpiešiam TIK pasiūlymų eiles (po nuolatinio freeform mazgo). Kviečiama
  // vien gavus naujesnį (pagal seq) tinklo atsakymą – freeform lieka nepaliestas.
  function renderSuggestions(query: string, suggItems: Item[]) {
    while (freeformBtn.nextSibling) list.removeChild(freeformBtn.nextSibling);
    suggItems.forEach((it, i) => {
      const idx = i + 1; // freeform užima 0
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-suggest-item';
      btn.setAttribute('role', 'option');

      const glyph = document.createElement('span');
      glyph.className = 'ss-suggest-glyph';
      glyph.innerHTML = it.sugg?.saltinis === 'juridiniai' ? BUILDING_GLYPH : DOC_GLYPH;

      const title = document.createElement('span');
      title.className = 'ss-suggest-title';
      highlightInto(title, it.label, query);

      btn.append(glyph, title);

      if (it.sugg && it.sugg.count > 0) {
        const meta = document.createElement('span');
        meta.className = 'ss-suggest-meta';
        const vienetas = SALTINIS_VIENETAS[it.sugg.saltinis] || '';
        meta.textContent = `${it.sugg.count.toLocaleString('lt-LT')}${vienetas ? ' ' + vienetas : ''}`;
        btn.append(meta);
      }

      btn.addEventListener('mouseenter', () => setActive(idx));
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // išlaikom fokusą
      btn.addEventListener('click', () => choose(it));
      list.appendChild(btn);
    });
  }

  function choose(it: Item) {
    // Freeform ("Ieškoti …") visada ieško pagal TAI, KAS DABAR įvesta, o ne pagal
    // galimai pasenusį atvaizduotą label: greitai rašant lėtam tinkle Enter turi
    // taikytis į naujausią tekstą, ne į paskutinį tinklo atsakymą.
    if (it.kind !== 'freeform') input!.value = it.label;
    dismissed = true;
    setOpen(false);
    form!.requestSubmit();
  }

  // Be debounce ir be atšaukimo: kiekvienas paspaudimas iškart paleidžia užklausą,
  // visos lekia lygiagrečiai. Pasiūlymus atvaizduojam tik jei atsakymas naujesnis
  // už paskutinį parodytą (monotoniškai pagal seq) — senas, vėluojantis atsakymas
  // niekada neperrašo naujesnio. Freeform tuo metu jau atnaujintas lokaliai, tad
  // pirma eilutė nepriklauso nuo tinklo.
  async function fetchSuggestions(q: string, mySeq: number) {
    let suggestions: Suggestion[] = [];
    try {
      const url = `/api/searchSuggestion?q=${encodeURIComponent(q)}&limit=8`
        + (SALTINIS ? `&saltinis=${encodeURIComponent(SALTINIS)}` : '');
      const res = await fetch(url);
      if (res.ok) suggestions = (await res.json()).suggestions ?? [];
    } catch { /* tinklas — paliekam tik freeform */ }
    if (mySeq <= renderedSeq) return;        // jau parodytas naujesnis atsakymas
    renderedSeq = mySeq;
    if (!input!.value.trim()) { setOpen(false); return; } // langelis ištuštintas
    if (dismissed) return;                   // vartotojas užvėrė – neatverinėjam

    const suggItems: Item[] = suggestions
      .filter((s) => fold(s.pavadinimas) !== fold(q)) // nedubliuojam tikslaus atitikmens
      .map((s) => ({ kind: 'suggestion' as const, label: s.pavadinimas, sugg: s }));
    items = [items[0], ...suggItems];        // freeform jau atnaujintas lokaliai
    renderSuggestions(q, suggItems);         // perpiešiam TIK pasiūlymų eiles
    setActive(0);
    setOpen(true);
  }

  function onInput() {
    const q = input!.value.trim();
    lastQuery = q;
    if (!q) {
      renderedSeq = sendSeq; // ignoruojam dar skrendančius senus atsakymus
      setOpen(false);
      return;
    }
    dismissed = false;
    // Pirmoji eilutė – LOKALIAI ir IŠKART (tik teksto mazgas, jokio perpiešimo),
    // tad panelė ir Enter taikinys nelaukia tinklo, o laikant klavišą nieko
    // nemirksi. Pasiūlymus klausiam tinklo – kiekvienas paspaudimas paleidžia
    // užklausą (be debounce, be atšaukimo), atvaizduojam naujausią pagal seq.
    updateFreeform(q);
    setActive(0);
    setOpen(true);
    fetchSuggestions(q, ++sendSeq);
  }

  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => {
    const q = input.value.trim();
    dismissed = false;
    if (q && q === lastQuery && items.length) setOpen(true);
    else if (q) onInput();
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!open && input.value.trim()) { onInput(); e.preventDefault(); return; }
      if (!items.length) return;
      e.preventDefault();
      setActive((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      setActive((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        choose(items[active]);
      }
      // kitaip – įprastas formos pateikimas (freeform per submit-perėmiklį)
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); dismissed = true; setOpen(false); }
    } else if (e.key === 'Tab') {
      if (open && active >= 0 && items[active] && items[active].kind === 'suggestion') {
        e.preventDefault();
        input.value = items[active].label;
        dismissed = true;
        setOpen(false);
      }
    }
  });

  // Paspaudus už ribų – užveriam.
  document.addEventListener('mousedown', (e) => {
    if (!bar.contains(e.target as Node)) { dismissed = true; setOpen(false); }
  });
}

// Mobilaus filtrų paketavimo (batching) pagalbininkai.
//
// Telefone (≤900px) šoninės juostos filtrai neperkrauna puslapio prie kiekvieno
// paspaudimo — vietoj to pakeitimai kaupiami paieškos formoje (paslėpti/įprasti
// laukai), o pritaikomi vienu „Ieškoti" (formos pateikimu). Darbastalyje viskas
// veikia kaip anksčiau (facetai — nuorodos, slankikliai/dialogai — navigacija).
//
// Naudojama ir /sutartys, ir /viesiejiPirkimai puslapiuose bei jų dialoguose ir
// histogramų komponentuose.

/** Ar dabar aktyvus mobilus (paketavimo) režimas. Tikrinama iškvietimo metu. */
export const isMobileFilter = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;

function searchForm(): HTMLFormElement | null {
  return document.getElementById("searchForm") as HTMLFormElement | null;
}

/** Dabartinės parametro reikšmės (iš formos lauko, jei yra; kitaip iš URL). */
export function readParam(param: string, sep: string): string[] {
  const form = searchForm();
  const el = form?.querySelector<HTMLInputElement>(`input[name="${param}"]`);
  const raw = el ? el.value : new URLSearchParams(location.search).get(param) ?? "";
  return raw.split(sep).map((s) => s.trim()).filter(Boolean);
}

/**
 * Įrašo parametro reikšmes į paieškos formą (paslėptą arba esamą lauką). Tuščias
 * sąrašas — pašalina paslėptą lauką (arba išvalo matomą), tad pateikus formą
 * parametras dingsta.
 */
export function writeParam(param: string, list: string[], sep: string) {
  const form = searchForm();
  if (!form) return;
  let el = form.querySelector<HTMLInputElement>(`input[name="${param}"]`);
  if (list.length) {
    if (!el) {
      el = document.createElement("input");
      el.type = "hidden";
      el.name = param;
      form.appendChild(el);
    }
    el.value = list.join(sep);
  } else if (el) {
    if (el.type === "hidden") el.remove();
    else el.value = "";
  }
}

/**
 * Šoninės juostos inline facetų (DokFacetSection nuorodų) paketavimas telefone:
 * perima paspaudimą, perjungia reikšmę formoje ir atnaujina sekcijos „pažymėta"
 * būseną — be perkrovimo. Darbastalyje nieko nedaro (nuorodos veikia įprastai).
 *
 * @param facetsSelector Facetų konteinerio selektorius (`.sut-facets` / `.vp-facets`).
 * @param sepFor Skirtukas pagal parametrą (BVPŽ — tarpas, kiti — kablelis).
 */
export function initRailFacetBatch(
  facetsSelector: string,
  sepFor: (param: string) => string,
) {
  const root = document.querySelector(facetsSelector);
  if (!root) return;

  root.addEventListener("click", (e) => {
    if (!isMobileFilter()) return; // darbastalyje — natūrali navigacija
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-param]");
    if (!link || !root.contains(link)) return;
    e.preventDefault();

    const param = link.dataset.param!;
    const sep = sepFor(param);
    const value = link.dataset.value ?? ""; // „Visi" nuoroda — be data-value
    const section = link.closest(".dok-filter-section");
    if (!section) return;

    if (value === "") {
      writeParam(param, [], sep); // „Visi" — išvalom parametrą
    } else {
      const list = readParam(param, sep);
      const i = list.indexOf(value);
      if (i >= 0) list.splice(i, 1);
      else list.push(value);
      writeParam(param, list, sep);
    }

    // Atnaujinam sekcijos „pažymėta" žymas (įsk. „Visi").
    const cur = new Set(readParam(param, sep));
    section.querySelectorAll<HTMLElement>("a[data-value]").forEach((el) => {
      el.classList.toggle("is-selected", cur.has(el.dataset.value!));
    });
    section.querySelector(".dok-filter-all")?.classList.toggle("is-selected", cur.size === 0);
  });
}

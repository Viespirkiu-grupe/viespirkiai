export const ORIGIN = "https://cvpp.eviesiejipirkimai.lt";

// Turinio parsinimo būsena valdoma "nuskaitymas" stulpeliu (kaip scrapeNotice.js):
//   null  -> dar nesuparsinta,
//   >= 1  -> suparsinta ta versija,
//   -1    -> klaida.
// v3: pridėtas struktūrinis "pirkimoObjektoRusis" stulpelis (iš turinio).
export const NUSKAITYMO_VERSIJA = 3;
export const KLAIDOS_BUSENA = -1;

// ─── helpers ─────────────────────────────────────────────────────────────────

// Lengvas HTML minify tik saugojimui: nuimam komentarus (paliekam IE conditional)
// ir suspaudžiam tarpus tarp tag'ų. .tab-content viduje pre/script/style nebūna.
export function minifyHtml(html) {
    return String(html ?? "")
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
        .replace(/>\s+</g, "><")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Iš ataskaitos Details nuorodos ištraukia { id, formTypeId }.
// pvz. https://.../ReportsOrProtocol/Details/2024-677876?formTypeId=4
export function parseAtaskaitosLink(link) {
    const u = new URL(link, ORIGIN);
    const id = u.pathname.match(/\/Details\/([^/?#]+)/)?.[1] || null;
    const formTypeId = u.searchParams.get("formTypeId");
    return { id, formTypeId };
}

export const txt = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;
export const bool = (v) => {
    // Some fields embed the question text before the answer; use the last word.
    const last = String(v ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    return last === "taip" ? true : last === "ne" ? false : null;
};
// Read a td value: boolean for checkboxes, text otherwise
export const cellVal = (td) => {
    const cb = td.querySelector("input[type=checkbox]");
    if (cb) return cb.hasAttribute("checked");
    return txt(td);
};
// Convert Lithuanian decimal string ("124 618,50") to number; leave others as-is
export const numLt = (v) => {
    if (!v) return v;
    const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? v : n;
};
// Column keys whose values should be numeric (monetary amounts, counts, scores, row/part numbers)
export const NUM_KEY_RE = /(?:verte|skaicius|kaina|santykis|naudingumas|nr)\d*$/i;

// Lithuanian → ASCII
const LT = {ą:"a",č:"c",ę:"e",ė:"e",į:"i",š:"s",ų:"u",ū:"u",ž:"z",Ą:"A",Č:"C",Ę:"E",Ė:"E",Į:"I",Š:"S",Ų:"U",Ū:"U",Ž:"Z"};
const LT_RE = /[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g;

// Verbose/long keys (post-transliteration) → short equivalents
const LABEL_MAP = {
    // Org fields from parseOrgTable / parseKeyValueSections
    oficialusPavadinimas:              "pavadinimas",
    juridinioAsmensKodas:              "kodas",
    asmuoRysiais:                      "asmuo",
    asmuoRysiams:                      "asmuo",
    internetoAdresas:                  "svetaine",
    pagrindinisAdresas:                "svetaine",
    pirkejoProfilioAdresas:            "pirkejoProfilis",
    vardasPavarde:                     "vardas",
    telefonoNumeris:                   "telefonas",
    elektroninioPastoAdresas:          "elPastas",
    // Common table columns
    pirkimoObjektoDaliesNumeris:       "daliesNr",
    nustatytosPasiulymuEilesNumeris:   "eileNr",
    kodasPavadinimas:                  "kodas",
    kodasPavadinimas2:                 "pavadinimas",
    dalyvioKodasPavadinimas:           "kodas",
    dalyvioKodasPavadinimas2:          "pavadinimas",
    pasiulymuArGalutiniuPasiulymuNepateikimas: "nepateikimas",
    pasiulymuAtmetimoTeisiniaiPagrindai: "teisiniaiPagrindai",
    pasiulymuAtmetimoPriezastys:       "priezastys",
    pasiulymoKainosArSanauduIrKokybesSantykis: "kainosSantykis",
    pasiulymoKainosSanauduIsraiska:    "kainosIsraiska",
    pasiulymoEkonominisNaudingumas:    "naudingumas",
    pasiulymoKaina:                    "kaina",
    pasiulymoKainosIsraiska:           "kainosIsraiska",
    sprendimaNulemusiosPriezastys:     "priezastys",
    sutartyjeNustatytaBendraPirkimoObjektoDaliesVerteBendraNumatomaSutartiesVerte: "verte",
    zymetiJeiguVerteYraOrientacine:    "orientacine",
    // Annual report table columns
    pirkimoObjektoRusis:               "rusis",
    bendraSudarytuSutarciuVerte:       "verte",
    bendraSudarytosSutartiesVerte:     "verte",
    bendrasPirkimuSkaicius:            "pirkimuSkaicius",
    is2StulpelyjeNurodytosVertesIvykdytuZaliujuPirkimuSudarytuSutarciuVerte: "zaliujuVerte",
    is3StulpelyjeNurodytoSkaiciausIvykdytuZaliujuPirkimuSkaicius: "zaliujuSkaicius",
    bendraSudarytuSutarciuAtlikusTarptautiniusPirkimusVerte: "tarptautinoVerte",
    bendraSudarytuSutarciuAtlikusSupaprastintusPirkimusVerte: "supaprastintoVerte",
    bendraSudarytuSutarciuAtlikusMazosVertesPirkimusArbaBendraPerkanciosiosOrganizacijosArPerkanciojoSubjektoKuriamTaikomaViesujuPirkimuIstatymo25Straipsnio5DaliesArbaKomunalinioSektoriausPirkimuIstatymo37Straipsnio4DaliesIsimtisSudarytuSutarciuVerte: "mazosVertesVerte",
    kontroliuojamoSubjektoIrSusijusiosImonesKodasPavadinimas:  "subjektoKodas",
    kontroliuojamoSubjektoIrSusijusiosImonesKodasPavadinimas2: "subjektoPavadinimas",
    susijusiImone:                     "imone",
    numatomaSutartiesIvykdymoData:     "ivykdymoData",
    sudarytosSutartiesVerte:           "verte",
    // Concession participant detail table (V.2)
    pateikeParaiska:                                          "paraiska",
    pateikePreliminaruNeisipareigojaMajiPasiulyma:            "preliminarisPasiulymas",
    priezastysJeiguNepateikeNeisipareigojaMojoPasiulymo:      "preliminaroPriezastys",
    pateikeIssamuIsipareigojamajiPasiulyma:                   "issamusPasiulymas",
    priezastysJeiguNepateikeIssamausIsipareigojamojoPasiulymo: "issamoPriezastys",
    poVykdytuDerybuPateikeGalutiniPasiulyma:                  "galutinisPasiulymas",
    priezastysJeiguPoVykdytuDerybuNepateikeGalutinioPasiulymo: "galutinioPriezastys",
    // Concession table columns
    koncesijosDaliesNumeris:           "daliesNr",
    dalyvioEilesNumerisSaraseSudarytamePagalSuteiktuVertinimuEiliskuma: "eileNr",
    pasiulymoCharakteristikosLemusiosPasiulymuiSuteiktaVietaEileje: "charakteristikos",
    sprendimaNulemusioPriezastys:       "priezastys",
    koncesijosDalyvioKodasPavadinimas:  "kodas",
    koncesijosDalyvioKodasPavadinimas2: "pavadinimas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas:  "kodas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas2: "pavadinimas",
    koncesininkoKodasPavadinimasKoncesininkuGrupesPavadinimas3: "grupe",
    koncesijosSutartisDelKuriosBuvoSudarytaSutartisNumeris:    "daliesNr",
    koncesijosSutartisDelKuriosBuvoSudarytaSutartisNumeris2:   "nr",
    koncesijosSutartiesSudarymoData:   "sudarymoData",
    koncesijosSutartiesTrukme:         "trukme",
    koncesijosVerte:                   "verte",
};

export function toCamelRaw(label) {
    const words = label
        .replace(LT_RE, (c) => LT[c])
        .replace(/\([^)]*\)/g, "")
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
    return words
        .map((w, i) => {
            const lower = w.toLowerCase();
            return i === 0 ? lower : lower[0].toUpperCase() + lower.slice(1);
        })
        .join("");
}

export function toCamel(label) {
    const raw = toCamelRaw(label);
    return LABEL_MAP[raw] ?? raw;
}

// Find first .eps-section whose h2 contains heading


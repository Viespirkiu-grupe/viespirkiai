// Pertvarko gautiPinregDeklaracijasPagalJarKoda rezultatą į kompaktišką, pagal
// asmenis sugrupuotą struktūrą, skirtą get_pinreg_jar MCP įrankiui.
//
// Plokščia struktūra (darbovietes + sutuoktinioDarbovietes + rysiaiSuJa, kur tas
// pats asmuo kartojasi dešimtimis eilučių) sujungiama į vieną `asmenys` sąrašą:
// kiekvienas asmuo – vienas objektas su visa savo deklaracijų/įrašų istorija.
// `rysiaiSuJa` lieka atskira kategorija, bet grupuojama tuo pačiu principu.
// Duomenys neprarandami – tik pakeičiama struktūra, pašalinami censuoti/dubliuoti
// vardo laukai ir `null`/tušti laukai.

// Laukai, kurie nukeliami į asmens / deklaracijos lygį arba yra pertekliniai,
// todėl į patį įrašą (`iraso`) nepatenka.
const DROP_FIELDS = new Set([
    "vardas",
    "pavarde",
    "susijusioAsmensVardas",
    "susijusioAsmensPavarde",
    "deklaruojancioVardas",
    "deklaruojancioPavarde",
    "sutuoktinioVardas",
    "sutuoktinioPavarde",
    "deklaracija",
    "uuid",
    "asmuo",
    "sutuoktinis",
    "pateikimoData",
    "irasoTipas",
    "jarKodas",
]);

// Title Case su lietuviškomis raidėmis; tvarko ir brūkšneliu jungtas pavardes
// (pvz. "VIRŽINTAITĖ-METRIKIENĖ" -> "Viržintaitė-Metrikienė").
function toTitleCase(name) {
    if (!name) return null;
    const trimmed = String(name).trim();
    if (!trimmed) return null;
    return trimmed
        .toLowerCase()
        .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// Bendri (core) laukai – aktualūs ir darbovietėms, ir ryšiams su JA. Įtraukiami
// į kiekvieną įrašą visada (net jei null), kad asmenys ir rysiaiSuJa įrašai
// turėtų vienodą bazinę schemą. Tipui specifiniai laukai (pareigos,
// darbovietesTipas / kienoRysys, rysioPobudzioPavadinimas...) rodomi tik kai
// turi reikšmę.
const CORE_FIELDS = [
    "pavadinimas",
    "rysioPradzia",
    "rysioPabaiga",
    "registruotaLietuvoje",
    "uzpildytaAutomatiskai",
];

// Sukuria įrašą: id + bendri laukai (visada) + likę laukai (tik kai turi reikšmę).
function statytiIraso(row) {
    const iraso = {};

    if (row.id !== null && row.id !== undefined) iraso.id = row.id;

    for (const key of CORE_FIELDS) {
        let value = row[key];
        if (value === undefined) value = null;
        if (typeof value === "string" && value.trim() === "") value = null;
        iraso[key] = value;
    }

    for (const [key, value] of Object.entries(row)) {
        if (DROP_FIELDS.has(key)) continue;
        if (key === "id" || CORE_FIELDS.includes(key)) continue;
        if (value === null || value === undefined) continue;
        if (typeof value === "string" && value.trim() === "") continue;
        if (Array.isArray(value) && value.length === 0) continue;
        iraso[key] = value;
    }

    return iraso;
}

// Įrašo tapatybės raktas dubliams pašalinti vienos deklaracijos viduje.
// Įtraukiame `darbovietesTipas`, kad nesujungtume skirtingo tipo veiklų
// (pvz. STANDARTINE vs EKSPERTO) – duomenys neprarandami.
function irasoRaktas(iraso) {
    return [
        iraso.pavadinimas ?? "",
        iraso.pareigos ?? iraso.rysioPobudzioPavadinimas ?? "",
        iraso.rysioPradzia ?? "",
        iraso.rysioPabaiga ?? "",
        iraso.darbovietesTipas ?? "",
    ]
        .map(String)
        .join("|");
}

// Pašalina identiškus įrašus vienos deklaracijos viduje, išlaiko eiliškumą.
function dedupIrasos(irasos) {
    const matyti = new Set();
    const rezultatas = [];
    for (const iraso of irasos) {
        const raktas = irasoRaktas(iraso);
        if (matyti.has(raktas)) continue;
        matyti.add(raktas);
        rezultatas.push(iraso);
    }
    return rezultatas;
}

// Sugrupuoja eilutes pagal asmenį, viduje – pagal deklaraciją (uuid).
function grupuotiPagalAsmeni(rows, { rysys } = {}) {
    const asmenys = new Map();

    for (const row of rows || []) {
        const asmuo = toTitleCase(`${row.vardas || ""} ${row.pavarde || ""}`);
        if (!asmuo) continue;

        // sutuoktinio darbovietėse pagrindinis asmuo yra sutuoktinis
        // (vardas/pavarde), o deklaruojantysis – susijęs asmuo.
        const deklaruojantis =
            rysys === "sutuoktinis"
                ? toTitleCase(
                      `${row.susijusioAsmensVardas || ""} ${row.susijusioAsmensPavarde || ""}`,
                  )
                : null;

        const personKey = `${asmuo}|${deklaruojantis || ""}`;

        let asmuoObj = asmenys.get(personKey);
        if (!asmuoObj) {
            asmuoObj = {
                asmuo,
                ...(rysys ? { rysys } : {}),
                ...(deklaruojantis ? { deklaruojantis } : {}),
                _deklaracijos: new Map(),
            };
            asmenys.set(personKey, asmuoObj);
        }

        const uuid = row.deklaracija || row.uuid || null;
        let dekl = asmuoObj._deklaracijos.get(uuid);
        if (!dekl) {
            dekl = { uuid, pateikimoData: row.pateikimoData, irasos: [] };
            asmuoObj._deklaracijos.set(uuid, dekl);
        }
        dekl.irasos.push(statytiIraso(row));
    }

    return Array.from(asmenys.values()).map(({ _deklaracijos, ...rest }) => ({
        ...rest,
        deklaracijos: Array.from(_deklaracijos.values()).map((dekl) => ({
            ...dekl,
            irasos: dedupIrasos(dekl.irasos),
        })),
    }));
}

/**
 * Pertvarko gautiPinregDeklaracijasPagalJarKoda rezultatą į pagal asmenis
 * sugrupuotą struktūrą. `limit` riboja unikalių asmenų (ne eilučių) skaičių.
 *
 * @param {object} result - plokščias gautiPinregDeklaracijasPagalJarKoda atsakymas
 * @param {{ limit?: number }} [options]
 * @returns {{ asmenys: Array<any>, rysiaiSuJa: Array<any>, counts: {asmenys: number, rysiaiSuJa: number}, limit: number|null }}
 */
export function pertvarkytiPinregAsmenims(result, options = {}) {
    const limit = options.limit ? Number(options.limit) : null;

    const tiesioginiai = grupuotiPagalAsmeni(result?.darbovietes, {
        rysys: "tiesioginis",
    });
    const sutuoktiniai = grupuotiPagalAsmeni(result?.sutuoktinioDarbovietes, {
        rysys: "sutuoktinis",
    });
    const asmenys = [...tiesioginiai, ...sutuoktiniai];
    // `rysiaiSuJa` lieka atskira kategorija, bet objekto schema tokia pati kaip
    // `asmenys` (asmuo, rysys, deklaracijos[...]).
    const rysiaiSuJa = grupuotiPagalAsmeni(result?.rysiaiSuJa, {
        rysys: "kiti",
    });

    return {
        asmenys: limit ? asmenys.slice(0, limit) : asmenys,
        rysiaiSuJa: limit ? rysiaiSuJa.slice(0, limit) : rysiaiSuJa,
        counts: {
            asmenys: asmenys.length,
            rysiaiSuJa: rysiaiSuJa.length,
        },
        limit,
    };
}

/**
 * Šaltinio (data.gov.lt Spinta `datasets/gov/uzt/ldv/Vieta`) objekto vertimas
 * į `uzt."darboVietos"` eilutę. Grynos funkcijos – jokių DB kreipinių: žodynų
 * reikšmės čia lieka tekstu, id jiems parenka SQL (žr. darboVietos.js).
 */

/** Tuščias tekstas šaltinyje reiškia „nenurodyta". */
export function reiksme(v) {
    if (v === null || v === undefined) return null;
    const t = typeof v === "string" ? v.trim() : v;
    return t === "" ? null : t;
}

/** Šaltinis „ar_*" laukus rašo tai '0'/'1', tai 'false'/'true'. */
export function arReiksme(v) {
    const t = reiksme(v);
    if (t === null) return null;
    if (typeof t === "boolean") return t;
    return ["1", "true", "t", "taip"].includes(String(t).toLowerCase());
}

/** Sveikas skaičius arba null (šaltinyje būna tekstas). */
export function sveikas(v) {
    const t = reiksme(v);
    if (t === null) return null;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? null : n;
}

function skaicius(v) {
    const t = reiksme(v);
    if (t === null) return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
}

/**
 * [šaltinio laukas, eilutės laukas, konverteris]. Vienintelė vieta, kur
 * aprašyta šaltinio ir `uzt` schemos atitiktis – ja naudojasi ir pilnas
 * importas, ir ADP `:changes` patch'ai.
 *
 * Eilutės laukų vardai nebūtinai sutampa su stulpeliais: žodyninės reikšmės
 * (`statusas`, `profesija`, …) virsta id stulpeliais, o darbdavio laukai
 * (`darbdavys`, `teisinisStatusas`, …) keliauja į uzt.darbdaviai.
 */
const LAUKAI = [
    ["_id", "_id"],
    ["_revision", "_revision"],
    ["darbo_vietos_id", "darboVietosId"],

    ["statusas", "statusas"],
    ["valiuta", "valiuta"],
    ["darbo_vietos_sav_pav", "savivaldybe"],
    ["registravimo_pagrindo_pav", "registravimoPagrindas"],
    ["registravimo_budo_pav", "registravimoBudas"],
    ["pageidavimo_pateikimo_pav", "pageidavimoBudas"],
    // Kableliais atskirtą baigtinio žodyno sąrašą skaido SQL; rizikos ir
    // gebėjimai – laisvas tekstas su kableliais, tad laikomi ištisai.
    ["susisiekimo_budas", "susisiekimoBudas"],
    ["rizikos_lt", "rizikos"],
    ["reik_gebejimai", "gebejimai"],
    ["reik_issilavinimo_pav", "issilavinimas"],
    ["reik_mok_progr_pav", "mokymoPrograma"],
    ["kontrakto_tipas", "kontraktoTipas"],
    ["profesijos_pareigybes_pav", "profesija"],
    ["profesijos_kodas", "profesijosKodas"],
    ["profesijos_grupes_pav", "profesijuGrupe"],
    ["profesijos_grupes_kodas", "profesijuGrupesKodas"],

    ["ikelimo_data", "ikelimoData"],
    ["galioja_nuo", "galiojaNuo"],
    ["galioja_iki", "galiojaIki"],
    ["pageidaujama_darbo_pradzia", "pageidaujamaDarboPradzia"],

    ["prelim_darbo_uzmokestis", "prelimDarboUzmokestis", skaicius],
    ["vid_darbo_uzmokestis", "vidDarboUzmokestis", skaicius],
    ["maks_darbo_uzmokestis", "maksDarboUzmokestis", skaicius],
    ["uzmokescio_komentaras_lt", "uzmokescioKomentaras"],

    ["darbo_aprasymas_lt", "darboAprasymas"],
    ["darbo_vietu_skaicius", "darboVietuSkaicius", sveikas],
    ["darbo_vietos_adresas", "darboVietosAdresas"],
    ["reik_darbo_patirtis", "reikDarboPatirtis", sveikas],
    ["reik_kompetencijos_lt", "reikKompetencijos"],

    ["darbdavio_kontaktinis_asmuo", "darbdavioKontaktinisAsmuo"],
    ["darbdavio_tel_nr", "darbdavioTelNr"],
    ["darbdavio_mob_nr", "darbdavioMobNr"],
    ["darbdavio_el_pastas", "darbdavioElPastas"],

    ["ar_aktuali_siandien", "arAktualiSiandien", arReiksme],
    ["ar_uzpildyta", "arUzpildyta", arReiksme],
    ["ar_papildomai_remia", "arPapildomaiRemia", arReiksme],
    ["ar_darbina_po_mokymu", "arDarbinaPoMokymu", arReiksme],
    ["ar_apmoka_keliones", "arApmokaKeliones", arReiksme],
    ["ar_apgyvendina", "arApgyvendina", arReiksme],
    ["ar_maitina", "arMaitina", arReiksme],
    ["ar_moksleiviams", "arMoksleiviams", arReiksme],
    ["ar_iki_18", "arIki18", arReiksme],
    ["ar_studentams", "arStudentams", arReiksme],
    ["ar_kariams", "arKariams", arReiksme],
    ["ar_ukrainieciams", "arUkrainieciams", arReiksme],
    ["ar_turintiems_negalia", "arTurintiemsNegalia", arReiksme],

    // Darbdavio rekvizitai – į uzt.darbdaviai.
    ["jar_kodas", "jarKodas"],
    ["darbdavys", "darbdavys"],
    ["teisinio_statuso_pav", "teisinisStatusas"],
    ["teisines_formos_pav", "teisineForma"],
    ["darbdavio_bustine", "darbdavioBustine"],
    ["imones_iregistravimas", "imonesIregistravimas"],
];

/** Šaltinio lauko vardas -> eilutės lauko vardas. */
export const SALTINIO_LAUKAI = Object.fromEntries(
    LAUKAI.map(([saltinis, raktas]) => [saltinis, raktas]),
);

/** Šaltinio objektas -> eilutė, tinkama darboVietos.js funkcijoms. */
export function paruostiEilute(obj) {
    const eilute = {};
    for (const [saltinis, raktas, konverteris = reiksme] of LAUKAI) {
        eilute[raktas] = konverteris(obj[saltinis]);
    }
    return eilute;
}

/*
Importuoja juridinių asmenų transporto priemonių duomenis į staging lentelę
`regitraImportas`.
https://www.regitra.lt/imone/atviri-duomenys/

Paprastai kviečiama iš modules/regitra/atnaujintiRegitra.js (naktinis darbas).
Rankiniam paleidimui su jau turimu CSV:
    node modules/regitra/importRegitra.js <file.csv>
*/
import { createHash } from "node:crypto";
import { postgres } from "../../postgres/postgres.js";
import { parseCSV } from "../../utils/csv.js";
import { log } from "../../utils/log.js";

/**
 * Regitros CSV antraštės → `regitra` lentelės stulpeliai.
 *
 * Siejama pagal antraštės pavadinimą, o ne poziciją — taip importas nesulūžtų,
 * jei Regitra sukeistų stulpelius vietomis. Tvarka čia yra ta pati kaip lentelėje
 * (`md5` pridedamas gale), nes nuo jos priklauso ir kanoninis JSON, ir
 * `INSERT INTO regitra."priemoniuTipai" SELECT * FROM regitra."importas"`.
 */
export const STULPELIAI = {
    MARKE: "marke",
    KOMERCINIS_PAV: "komercinisPavadinimas",
    GAMINTOJO_PAV: "gamintojoPavadinimas",
    GAMINTOJO_PAV_BAZ: "gamintojoPavadinimasBazinis",
    TIPAS: "tipas",
    VARIANTAS: "variantas",
    VERSIJA: "versija",
    ES_TIPO_PATVIRTINIMO_NR: "EsTipoPatvirtinimoNr",
    NAC_TIPO_PATVIRTINIMO_NR: "NacTipoPatvirtinimoNr",
    INVIDUAL_PATVIRTINIMO_NR: "IndividualusPatvirtinimoNr",
    INTERPOLIACIJA: "Interpoliacija",
    VAIRAS_DESINEJE: "vairasDesineje",
    KATEGORIJA_PILNAI: "kategorijaPilna",
    KATEGORIJA_KLASE: "kategorijaKlase",
    KEB_KODAS: "kebuloKodas",
    SPEC_KODAS: "specKodas",
    KEB_KODAS_ES: "kebuloKodasEs",
    NUOSAVA_MASE: "nuosavaMase",
    NUOSAVA_MAS: "nuosavaMaseBazine",
    MAKS_MASE: "maksimaliMase",
    MAKS_MASE_F2: "maksimaliMaseF2",
    MAKS_MASE_F5: "maksimaliMaseF5",
    BANDOMOJI_MASE: "bandomojiMase",
    DIS_T: "darbinisTuris",
    GALIA: "galia",
    SUKIU_SK: "sukiuSkaicius",
    GALIA_ELEKTR: "galiaElektrine",
    DEGALAI: "degalai",
    DEGALU_REZIMAS: "degaluRezimas",
    ELEKTRINE_TP: "arElektrine",
    HIBRIDINES_TP_KATEGORIJA: "hibridoKategorija",
    PAVARU_DEZES_TIPAS: "pavaruDezesTipas",
    CO2_KIEKIS: "CO2Kiekis",
    CO2_KIEKIS__WLTP: "CO2KiekisWLTP",
    EKO_NAUJOVES_KODAS: "ekoNaujovesKodas",
    CO2_SUMAZEJIMAS_NEDC: "CO2SumazejimasNEDC",
    CO2_SUMAZEJIMAS_WLTP: "CO2SumazejimasWLTP",
    ELEKTR_ENERG_SANAUD_NEDC: "elektrEnergijosSanaudosNEDC",
    ELEKTR_ENERG_SANAUD_WLTP_E: "elektrEnergijosSanaudosWLTPE",
    ELEKTR_ENERG_SANAUD_WLTP_H: "elektrEnergijosSanaudosWLTPH",
    ELEKTRINE_RIDA_NEDC: "elektrineRidaNEDC",
    ELEKTRINE_RIDA_WLTP_E: "elektrineRidaWLTPE",
    ELEKTRINE_RIDA_WLTP_H: "elektrineRidaWLTPH",
    TERSALU_LYGIS: "tersaluLygis",
    TERSALU_NORM_AKTO_NR: "tersaluNorminioAktoNumeris",
    RATU_BAZE: "ratuBaze",
    TV_PLOTIS1: "priekinesAsiesVezesPlotis",
    TV_PLOTIS2: "galinesAsiesVezesPlotis",
    GALIOS_MASES_SANT: "galiosMasesSantykis",
    MAKS_GREITIS: "maksGreitis",
    SEDIMU_VIETU_SK: "sedimuVietuSkaicius",
    STOVIMU_VIETU_SK: "stovimuVietuSkaicius",
    GAMYBOS_METAI: "gamybosMetai",
    MODELIO_METAI: "modelioMetai",
    PIRM_REG_DATA: "pirmosiosRegistracijosData",
    PIRM_REG_DATA_LT: "pirmosiosRegistracijosLietuvojeData",
    PASKUTINES_REG_DATA: "paskutinesRegistracijosData",
    DAE_STATUSAS: "dalyvavimoEismeStatusas",
    KILMES_SALIS: "kilmesSalis",
    TP_VALDYMO_TEISE: "valdymoTeise",
    KODAS: "jarKodas",
    PAVADINIMAS: "jarPavadinimas",
    SAVIVALDYBE: "savivaldybe",
    APSKRITIS: "apskritis",
    TP_VALDYMO_TEISE_SAV: "valdymoTeiseSavininkas",
    KODAS_SAV: "jarSavininkasKodas",
    PAVADINIMAS_SAV: "jarSavininkasPavadinimas",
    SAVIVALDYBE_SAV: "savininkasSavivaldybe",
    APSKRITIS_SAV: "savininkasApskritis",
};

const CSV_ANTRASTES = Object.keys(STULPELIAI);
const DB_STULPELIAI = Object.values(STULPELIAI);

// 70 stulpelių (69 duomenų + md5) × 500 eilučių = 35 000 parametrų.
// Postgres riba vienai užklausai — 65 535.
const ITERPIMO_DYDIS = 500;

/**
 * Išvalo CSV lauko reikšmę: tuščia eilutė virsta `null`.
 *
 * @param {string|null|undefined} reiksme
 * @returns {string|null}
 */
function isvalyti(reiksme) {
    if (reiksme === undefined || reiksme === null || reiksme === "") return null;
    return reiksme;
}

/**
 * Apskaičiuoja eilutės tapatybę — md5 nuo kanoninio JSON.
 *
 * Anonimizuotuose Regitros duomenyse nėra nei VIN, nei valstybinio numerio,
 * todėl pats eilutės turinys ir yra transporto priemonės tapatybė. Raktų tvarka
 * fiksuota (`DB_STULPELIAI`), todėl tas pats turinys visada duoda tą patį md5.
 *
 * @param {(string|null)[]} reiksmes - 69 išvalytos reikšmės lentelės stulpelių tvarka.
 * @returns {string} md5 hex.
 */
function eilutesMd5(reiksmes) {
    const kanoninis = {};
    for (let i = 0; i < DB_STULPELIAI.length; i++) {
        kanoninis[DB_STULPELIAI[i]] = reiksmes[i];
    }
    return createHash("md5").update(JSON.stringify(kanoninis)).digest("hex");
}

const INSERT_STULPELIAI = [...DB_STULPELIAI, "md5"]
    .map((s) => `"${s}"`)
    .join(", ");
const STULPELIU_SKAICIUS = DB_STULPELIAI.length + 1;

/**
 * Skaito Regitros CSV ir generuoja paruoštas eilutes su tapatybės md5.
 * Atskirta nuo įterpimo, kad parsinimą būtų galima patikrinti be duomenų bazės.
 *
 * @param {string} csvKelias
 * @yields {{reiksmes: (string|null)[], md5: string}}
 */
export async function* skaitytiCsvEilutes(csvKelias) {
    let antrastePatikrinta = false;

    for await (const irasas of parseCSV(csvKelias)) {
        if (!antrastePatikrinta) {
            const truksta = CSV_ANTRASTES.filter((a) => !(a in irasas));
            if (truksta.length > 0) {
                throw new Error(`CSV trūksta stulpelių: ${truksta.join(", ")}`);
            }
            antrastePatikrinta = true;
        }

        const reiksmes = CSV_ANTRASTES.map((antraste) =>
            isvalyti(irasas[antraste]),
        );

        yield { reiksmes, md5: eilutesMd5(reiksmes) };
    }
}

/**
 * Įterpia eilučių paketą į staging lentelę.
 *
 * @param {(string|null)[][]} eilutes
 * @returns {Promise<void>}
 */
async function iterptiPaketa(eilutes) {
    if (eilutes.length === 0) return;

    const placeholderiai = eilutes
        .map(
            (_, eilNr) =>
                `(${Array.from(
                    { length: STULPELIU_SKAICIUS },
                    (_, i) => `$${eilNr * STULPELIU_SKAICIUS + i + 1}`,
                ).join(", ")})`,
        )
        .join(", ");

    await postgres.query(
        `INSERT INTO regitra."importas" (${INSERT_STULPELIAI}) VALUES ${placeholderiai}`,
        eilutes.flat(),
    );
}

/**
 * Nuskaito Regitros CSV ir sukelia jį į `regitraImportas` staging lentelę.
 * Lentelė prieš tai išvaloma.
 *
 * @param {string} csvKelias - Kelias iki išpakuoto CSV failo.
 * @returns {Promise<{eiluciuSkaicius: number, praleista: number}>}
 */
export async function importuotiCsvIStaginga(csvKelias) {
    await postgres.query(`TRUNCATE TABLE regitra."importas"`);

    let eilute = 0;
    let praleista = 0;
    let paketas = [];
    const jarKodoIndeksas = DB_STULPELIAI.indexOf("jarKodas");

    for await (const { reiksmes, md5 } of skaitytiCsvEilutes(csvKelias)) {
        // Eilutė be jokio JAR kodo yra nenaudinga — visa lentelė skaitoma pagal jį.
        if (reiksmes[jarKodoIndeksas] === null) {
            praleista++;
            continue;
        }

        paketas.push([...reiksmes, md5]);

        if (paketas.length === ITERPIMO_DYDIS) {
            await iterptiPaketa(paketas);
            eilute += paketas.length;
            paketas = [];
            if (eilute % 50000 === 0) log(`Įterpta ${eilute} eilučių...`);
        }
    }

    if (paketas.length > 0) {
        await iterptiPaketa(paketas);
        eilute += paketas.length;
    }

    log(`Į staging įterptos eilutės: ${eilute} (praleista: ${praleista})`);
    return { eiluciuSkaicius: eilute, praleista };
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const failas = process.argv[2];
    if (!failas) {
        console.error("Naudojimas: node importRegitra.js <file.csv>");
        process.exit(1);
    }

    try {
        await importuotiCsvIStaginga(failas);
        log(
            "Duomenys sukelti į `regitraImportas`. Perkėlimui į `regitra` naudokite " +
                "modules/regitra/atnaujintiRegitra.js",
        );
    } finally {
        await postgres.end();
    }
}

import * as XLSX from "xlsx";
import { toCamelCase } from "../../utils/text.js";
import {
    boolOrNull,
    cleanValue,
    excelDate,
    first,
    numberOrNull,
    textOrNull,
} from "./laukai.js";

// Šaltinio lėšų stulpeliai antraštėje numeruoti ("1.2. EGADP subsidijos lėšos"),
// o tas numeris ir yra cpva."lesuStraipsniai"."kodas". Remiamės numeriu, o ne
// formuluote — CPVA pavadinimus koreguoja, numeraciją keičia rečiau.
const LESU_ANTRASTE_RE = /^(\d+(?:\.\d+)*)\.\s/;

// Senesnis failo formatas numeracijos neturėjo; jo stulpelius susiejame rankomis.
const SENOS_LESOS = new Map([
    ["didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPSubsidijosLesos", "1.2"],
    ["didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPPaskolosLesos", "1.3"],
    ["didziausiaGalimaTinkamuFinansuotiIslaiduSumaBendrojoFinansavimoLesos", "1.4"],
    ["didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRValstybesBiudzetoLesos", "1.5"],
    [
        "didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRVBLesosSkirtosESFonduLesomisNetinkamamFinasnsuotiPVMApmoketi",
        "1.6",
    ],
    ["didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavoInasoLesos", "2"],
    [
        "didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavasInasasTenkantisLRVBNetinkamamPVMApmoketi",
        "2.1.4",
    ],
]);

const DATE_KEY_RE = /data/i;
// Vienintelė "data" antraštė, kuri yra ne data, o tiekėjo pavadinimo dalis.
const IGNORED_DATE_KEYS = new Set([
    "subtiekejoPavadinimasVardasIrPavardeGimimoData",
    "tiekejoPavadinimasVardasIrPavardeGimimoData",
]);

function findHeaderRow(sheet, expectedKeys) {
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
    const preview = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        blankrows: true,
        range: {
            s: { r: range.s.r, c: range.s.c },
            e: { r: Math.min(range.e.r, range.s.r + 9), c: range.e.c },
        },
    });

    const offset = preview.findIndex((row) => {
        const keys = new Set(row.map((value) => toCamelCase(String(value ?? ""))));
        return expectedKeys.some((key) => keys.has(key));
    });
    if (offset === -1) {
        throw new Error(
            `CPVA Excel lape nerasta antraščių eilutė (${expectedKeys.join(" arba ")})`,
        );
    }
    return range.s.r + offset;
}

/**
 * Nuskaito lapą į camelCase raktais aprašytas eilutes ir kartu grąžina
 * camelCase -> originali antraštė žemėlapį (jo reikia lėšų numeracijai).
 */
function readRows(sheet, expectedKeys) {
    const headerRow = findHeaderRow(sheet, expectedKeys);
    const sourceRows = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        range: headerRow,
    });

    const antrastes = new Map();
    const rows = sourceRows.map((sourceRow) => {
        const row = {};
        for (const [header, sourceValue] of Object.entries(sourceRow)) {
            if (/^__EMPTY/.test(header)) continue;
            const key = toCamelCase(header);
            antrastes.set(key, header);
            let value = cleanValue(sourceValue);
            if (DATE_KEY_RE.test(key) && !IGNORED_DATE_KEYS.has(key)) {
                value = excelDate(value);
            }
            row[key] = value;
        }
        return row;
    });

    return { rows, antrastes };
}

/** Iš antraščių išrenka lėšų stulpelius kaip [camelKey, straipsnioKodas] poras. */
function lesuStulpeliai(antrastes) {
    const stulpeliai = [];
    for (const [key, header] of antrastes) {
        const match = LESU_ANTRASTE_RE.exec(String(header).trim());
        if (match) {
            stulpeliai.push([key, match[1]]);
        } else if (SENOS_LESOS.has(key)) {
            stulpeliai.push([key, SENOS_LESOS.get(key)]);
        }
    }
    return stulpeliai;
}

function lesos(row, stulpeliai) {
    const result = [];
    for (const [key, kodas] of stulpeliai) {
        const suma = numberOrNull(row[key]);
        // Nulių nesaugome — šaltinyje jų ~77 %, o nebuvimas reiškia nulį.
        if (suma !== null && suma !== 0) result.push({ kodas, suma });
    }
    return result;
}

function projectRow(row, lesuStulp) {
    return {
        projektoNr: textOrNull(first(row, "projektoKodas", "projektoNr")),
        kvietimoNr: textOrNull(first(row, "kvietimoNumeris")),
        pavadinimas: textOrNull(first(row, "projektoPavadinimas")),
        atsakingaInstitucija: textOrNull(first(
            row,
            "atsakingaInstitucija",
            "atsakingaMinisterija",
        )),
        vykdytojoPavadinimas: textOrNull(first(
            row,
            "projektoVykdytojoPavadinimas",
            "projektoVykdytojas",
        )),
        vykdytojoKodas: textOrNull(first(
            row,
            "projektoVykdytojoKodas",
            "projektoVykdytojoJuridinioAsmensKodas",
        )),
        busena: textOrNull(first(row, "projektoBusena")),
        busenosData: first(row, "busenosData"),
        sutartiesData: first(row, "sutartiesIsigaliojimoData", "sutartiesData"),
        veikluPabaigosData: first(
            row,
            "projektoVeikluVykdymoPabaigosData",
            "projektoVeikluPabaigosData",
        ),
        igyvendinimoVieta: textOrNull(first(
            row,
            "projektoIgyvendinimoVietaSavivaldybe",
        )),
        pagrindineApskritis: textOrNull(first(
            row,
            "apskritisKuriaiTenkaDidziojiDalisProjektoLesu",
        )),
        kitosApskritys: textOrNull(first(
            row,
            "kitaOsApskritisYsKuriaiIomsTenkaDalisProjektoLesu",
            "kitaOsApskritisYsKuriaiIomsTenkaDalisProje",
        )),
        saiTaikoma: boolOrNull(first(row, "sAITaikymas")),
        islaiduSuma: numberOrNull(first(
            row,
            "projektoIslaiduSumaEurais",
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIsViso",
        )),
        lesos: lesos(row, lesuStulp),
    };
}

function contractRow(row) {
    return {
        projektoNr: textOrNull(first(row, "projektoKodas", "projektoNr")),
        vykdytojoPavadinimas: textOrNull(first(
            row,
            "projektoVykdytojoPavadinimas",
            "pirkimaVykdantisSubjektas",
        )),
        vykdytojoKodas: textOrNull(first(row, "projektoVykdytojoKodas")),
        vykdytojoStatusas: textOrNull(first(row, "pirkimaVykdancioSubjektoStatusas")),
        vykdytojasUzsienyje: boolOrNull(first(
            row,
            "pirkimaVykdantisSubjektasYraUzsienyjeRegistruotasJuridinisAsmuo",
        )),
        pirkimoNr: textOrNull(first(row, "pirkimoNumeris", "pirkimoNrCVPIS")),
        pirkimoPavadinimas: textOrNull(first(
            row,
            "pirkimoPavadinimas",
            "pirkimoObjektas",
        )),
        pirkimoBudas: textOrNull(first(row, "pirkimoBudas")),
        objektoRusis: textOrNull(first(row, "pirkimoObjektoRusis")),
        sutartiesData: first(row, "pirkimoSutartiesData"),
        sutartiesNr: textOrNull(first(
            row,
            "vykdytojoPirkimoSutartiesNumeris",
            "pirkimoSutartiesNr",
        )),
        sumaProjektui: numberOrNull(first(
            row,
            "bendraPirkimoSutartiesSumaTenkantiProjektuiEurais",
            "pirkimoSutartiesSumaSusijusiSuProjektu",
        )),
        tinkamaFinansuotiSuma: numberOrNull(first(
            row,
            "tinkamaFinansuotiSutartiesSumaEurais",
        )),
        tiekejoPavadinimas: textOrNull(first(
            row,
            "tiekejoPavadinimas",
            "tiekejoPavadinimasVardasIrPavardeGimimoData",
        )),
        tiekejoKodas: textOrNull(first(row, "tiekejoKodas")),
        tiekejasFizinisAsmuo: boolOrNull(first(row, "tiekejasFizinisAsmuo")),
        tiekejasUzsienyje: boolOrNull(first(
            row,
            "tiekejasYraUzsienyjeRegistruotasJuridinisAsmuo",
        )),
        vykdoma: boolOrNull(first(row, "pirkimoSutartisVykdoma")),
    };
}

function validateRows(rows, type) {
    for (const [index, row] of rows.entries()) {
        if (row.projektoNr == null) {
            throw new Error(`CPVA ${type} eilutėje ${index + 2} nėra projekto numerio`);
        }
        if (type === "sutarčių" && row.sutartiesNr == null) {
            throw new Error(`CPVA sutarčių eilutėje ${index + 2} nėra sutarties numerio`);
        }
    }
}

/** Nuskaito tiek seną (su tituliniu row), tiek dabartinį CPVA XLSX formatą. */
export function parseCpvaWorkbook(workbook) {
    if (workbook.SheetNames.length < 2) {
        throw new Error("CPVA Excel faile turi būti bent du lapai");
    }

    const raktai = ["projektoKodas", "projektoNr"];
    const projektuLapas = readRows(workbook.Sheets[workbook.SheetNames[0]], raktai);
    const sutarciuLapas = readRows(workbook.Sheets[workbook.SheetNames[1]], raktai);

    const lesuStulp = lesuStulpeliai(projektuLapas.antrastes);
    const projects = projektuLapas.rows.map((row) => projectRow(row, lesuStulp));
    const contracts = sutarciuLapas.rows.map(contractRow);

    validateRows(projects, "projektų");
    validateRows(contracts, "sutarčių");
    return { projects, contracts };
}

import * as XLSX from "xlsx";
import { toCamelCase } from "../../utils/text.js";

const DATE_KEY_RE = /data/i;
const IGNORED_DATE_KEYS = new Set([
    "subtiekejoPavadinimasVardasIrPavardeGimimoData",
]);

function cleanValue(value) {
    if (typeof value !== "string") return value;
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned.toUpperCase() === "NULL" ? null : cleaned;
}

function excelDate(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "number" && value >= 0 && value < 100_000) {
        return new Date(Math.round((value - 25569) * 86_400_000))
            .toISOString()
            .slice(0, 10);
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    return null;
}

function numberOrNull(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value)
        .replace(/[\s\u00a0]/g, "")
        .replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function sumOrNull(...values) {
    const numbers = values.map(numberOrNull).filter((value) => value !== null);
    return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0);
}

function first(row, ...keys) {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
            return row[key];
        }
    }
    return null;
}

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

function readRows(sheet, expectedKeys) {
    const headerRow = findHeaderRow(sheet, expectedKeys);
    const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        range: headerRow,
    });

    return rows.map((sourceRow) => {
        const row = {};
        for (const [header, sourceValue] of Object.entries(sourceRow)) {
            if (/^__EMPTY/.test(header)) continue;
            const key = toCamelCase(header);
            let value = cleanValue(sourceValue);
            if (DATE_KEY_RE.test(key) && !IGNORED_DATE_KEYS.has(key)) {
                value = excelDate(value);
            }
            row[key] = value;
        }
        return row;
    });
}

function projectRow(row) {
    return {
        projektoNr: first(row, "projektoNr", "projektoKodas"),
        finansavimoSaltinis: first(row, "finansavimoSaltinis"),
        projektoVykdytojas: first(
            row,
            "projektoVykdytojas",
            "projektoVykdytojoPavadinimas",
        ),
        projektoVykdytojoKodas: first(
            row,
            "projektoVykdytojoJuridinioAsmensKodas",
            "projektoVykdytojoKodas",
        ),
        projektoPavadinimas: first(row, "projektoPavadinimas"),
        atsakingaMinisterija: first(
            row,
            "atsakingaMinisterija",
            "atsakingaInstitucija",
        ),
        projektasSuPartneriais: first(row, "projektasSuPartneriais"),
        sutartiesData: first(row, "sutartiesData", "sutartiesIsigaliojimoData"),
        projektoVeikluPradziosData: first(row, "projektoVeikluPradziosData"),
        projektoVeikluPabaigosData: first(
            row,
            "projektoVeikluPabaigosData",
            "projektoVeikluVykdymoPabaigosData",
        ),
        egadpSubsidijos: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPSubsidijosLesos",
            "12EGADPSubsidijosLesos",
        )),
        egadpPaskolos: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaEGADPPaskolosLesos",
            "13EGADPPaskolosLesos",
        )),
        iperpfLesos: numberOrNull(first(row, "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPERPFLesos")),
        ipesfLesos: numberOrNull(first(row, "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPESFLesos")),
        ipsaFLesos: numberOrNull(first(row, "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPSaFLesos")),
        iptpfLesos: numberOrNull(first(row, "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIPTPFLesos")),
        bendrojoFinansavimo: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaBendrojoFinansavimoLesos",
            "14BendrojoFinansavimoLesos",
        )),
        lrBiudzetoLesos: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRValstybesBiudzetoLesos",
            "15ValstybesBiudzetoLesos",
        )),
        lrvbEsFonduLesos: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaLRVBLesosSkirtosESFonduLesomisNetinkamamFinasnsuotiPVMApmoketi",
            "16ValstybesBiudzetoLesosSkirtosESFonduLesomisNetinkamamFinansuotiPVMApmoketi",
        )),
        nuosavoInasoLesos: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavoInasoLesos",
            "2NuosavasInasas",
        )),
        nuosavasInasasNetinkamam: first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavasInasasTenkantisLRVBNetinkamamPVMApmoketi",
        ) !== null
            ? numberOrNull(first(
                row,
                "didziausiaGalimaTinkamuFinansuotiIslaiduSumaNuosavasInasasTenkantisLRVBNetinkamamPVMApmoketi",
            ))
            : sumOrNull(
                row["214NacionalinesViesosiosLesosSkirtosESFonduNetinkamamFinansuotiPVMApmoketi"],
                row["223PrivaciosLesosSkirtosESFonduLesomisNetinkamamFinansuotiPVMApmoketi"],
            ),
        isViso: numberOrNull(first(
            row,
            "didziausiaGalimaTinkamuFinansuotiIslaiduSumaIsViso",
            "projektoIslaiduSumaEurais",
        )),
    };
}

function contractRow(row) {
    return {
        projektoNr: first(row, "projektoNr", "projektoKodas"),
        projektoPavadinimas: first(row, "projektoPavadinimas"),
        arProjektasFinansuojamasEGADPLesoms: first(
            row,
            "arProjektasFinansuojamasEGADPLesoms",
        ),
        pirkimoNrCvpis: first(row, "pirkimoNrCVPIS", "pirkimoNumeris"),
        pirkimaVykdantisSubjektas: first(
            row,
            "pirkimaVykdantisSubjektas",
            "projektoVykdytojoPavadinimas",
        ),
        pirkimoObjektas: first(row, "pirkimoObjektas", "pirkimoPavadinimas"),
        pirkimoSutartiesNr: first(
            row,
            "pirkimoSutartiesNr",
            "vykdytojoPirkimoSutartiesNumeris",
        ),
        pirkimoSutartiesData: first(row, "pirkimoSutartiesData"),
        pirkimoSutartiesSumaSusijusiSuProjektu: numberOrNull(first(
            row,
            "pirkimoSutartiesSumaSusijusiSuProjektu",
            "bendraPirkimoSutartiesSumaTenkantiProjektuiEurais",
        )),
        tiekejoPavadinimasVardasIrPavardeGimimoData: first(
            row,
            "tiekejoPavadinimasVardasIrPavardeGimimoData",
            "tiekejoPavadinimas",
        ),
        tiekejoKodas: first(row, "tiekejoKodas"),
        subtiekejoPavadinimasVardasIrPavardeGimimoData: first(
            row,
            "subtiekejoPavadinimasVardasIrPavardeGimimoData",
        ),
        subtiekejoKodas: first(row, "subtiekejoKodas"),
    };
}

function validateRows(rows, type) {
    for (const [index, row] of rows.entries()) {
        if (row.projektoNr == null || row.projektoNr === "") {
            throw new Error(`CPVA ${type} eilutėje ${index + 2} nėra projekto numerio`);
        }
        if (
            type === "sutarčių" &&
            (row.pirkimoSutartiesNr == null || row.pirkimoSutartiesNr === "")
        ) {
            throw new Error(`CPVA sutarčių eilutėje ${index + 2} nėra sutarties numerio`);
        }
    }
}

/** Nuskaito tiek seną (su tituliniu row), tiek dabartinį CPVA XLSX formatą. */
export function parseCpvaWorkbook(workbook) {
    if (workbook.SheetNames.length < 2) {
        throw new Error("CPVA Excel faile turi būti bent du lapai");
    }

    const projects = readRows(
        workbook.Sheets[workbook.SheetNames[0]],
        ["projektoNr", "projektoKodas"],
    ).map(projectRow);
    const contracts = readRows(
        workbook.Sheets[workbook.SheetNames[1]],
        ["projektoNr", "projektoKodas"],
    ).map(contractRow);

    validateRows(projects, "projektų");
    validateRows(contracts, "sutarčių");
    return { projects, contracts };
}

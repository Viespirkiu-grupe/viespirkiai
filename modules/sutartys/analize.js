import { specialJarCodes } from "../juridiniai/specialJarCodes.js";
import ExcelJS from "exceljs";

/**
 * @param {object[]} results
 * @returns {object}
 */
export function buildAnalize(results) {
    const analize = {
        tipai: {},
        sumosVsDatos: {},
        metinesSumos: {},
        topTiekejai: {},
        topPirkejai: {},
    };

    for (const r of results) {
        const tipas = r.tipas || "Nežinomas";
        analize.tipai[tipas] = (analize.tipai[tipas] ?? 0) + 1;

        const data = r.sudarymoData
            ? new Date(r.sudarymoData).toISOString().split("T")[0]
            : "Nežinoma";
        analize.sumosVsDatos[data] =
            (analize.sumosVsDatos[data] ?? 0) + (parseFloat(r.verte) || 0);

        if (r.sudarymoData && (r.tipas || "").trim().toUpperCase() !== "SP") {
            const metai = new Date(r.sudarymoData).getFullYear();
            analize.metinesSumos[metai] =
                (analize.metinesSumos[metai] ?? 0) + (parseFloat(r.verte) || 0);
        }

        if (tipas !== "SP") {
            const verte =
                parseFloat(r.faktineIvykdymoVerte) || parseFloat(r.verte) || 0;
            const tiekejai = r.tiekejai || [];
            const kodai = r.tiekejaiKodai || [];

            tiekejai.forEach((tiekejas, i) => {
                const kodas = kodai[i];
                if (!kodas) return;
                const pavadinimas =
                    specialJarCodes[kodas]?.pavadinimas ?? tiekejas;
                if (!analize.topTiekejai[kodas])
                    analize.topTiekejai[kodas] = {
                        kodas,
                        tiekejas: pavadinimas,
                        suma: 0,
                        kiekis: 0,
                    };
                analize.topTiekejai[kodas].suma += verte;
                analize.topTiekejai[kodas].kiekis++;
            });

            const kodas = r.perkanciosiosOrganizacijosKodas;
            if (kodas) {
                if (!analize.topPirkejai[kodas])
                    analize.topPirkejai[kodas] = {
                        kodas,
                        pirkejas: r.perkanciojiOrganizacija || "Nežinomas",
                        suma: 0,
                        kiekis: 0,
                    };
                analize.topPirkejai[kodas].suma += verte;
                analize.topPirkejai[kodas].kiekis++;
            }
        }
    }

    return {
        tipai: Object.entries(analize.tipai)
            .map(([tipas, count]) => ({ tipas, count }))
            .sort((a, b) => b.count - a.count),
        sumosVsDatos: Object.entries(analize.sumosVsDatos)
            .map(([data, suma]) => ({ data, suma }))
            .sort((a, b) => new Date(a.data) - new Date(b.data)),
        metinesSumos: Object.entries(analize.metinesSumos)
            .map(([metai, suma]) => ({ metai, suma }))
            .sort((a, b) => a.metai - b.metai),
        topTiekejai: Object.values(analize.topTiekejai).sort(
            (a, b) => b.suma - a.suma,
        ),
        topPirkejai: Object.values(analize.topPirkejai).sort(
            (a, b) => b.suma - a.suma,
        ),
    };
}
const FONT = { name: "Calibri", size: 11 };
const HEADER_FILL = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F0F0" },
};
const BORDER_THIN = { style: "thin", color: { argb: "FFD4D4D4" } };
const CELL_BORDER = {
    top: BORDER_THIN,
    left: BORDER_THIN,
    bottom: BORDER_THIN,
    right: BORDER_THIN,
};

function makeSheet(wb, sheetName, rows, headers, keys, numericCols, colWidths) {
    const ws = wb.addWorksheet(sheetName, {
        views: [{ state: "frozen", ySplit: 1 }],
    });

    ws.columns = headers.map((header, i) => ({
        header,
        key: keys[i],
        width: colWidths[i],
    }));

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, colNum) => {
        if (colNum > headers.length) return;
        cell.font = { ...FONT, bold: true };
        cell.fill = HEADER_FILL;
        cell.border = CELL_BORDER;
    });

    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
    };

    const numericColSet = new Map(
        numericCols.map(({ col, format }) => [col, format]),
    );

    for (const row of rows) {
        const added = ws.addRow(keys.map((k) => row[k]));
        added.eachCell((cell, colNum) => {
            cell.font = FONT;
            cell.border = CELL_BORDER;
            const format = numericColSet.get(colNum - 1);
            if (format !== undefined) {
                cell.value = parseFloat(cell.value) || 0;
                if (format) cell.numFmt = format;
            }
        });
    }
}

const SUTARTYS_HEADERS = [
    "Tipas",
    "Kategorija",
    "Pavadinimas",
    "Numatyta vertė",
    "Faktinė vertė",
    "Pirkėjo pavadinimas",
    "Pirkėjo kodas",
    "Tiekėjų pavadinimai",
    "Tiekėjų kodai",
    "Sudarymo data",
    "Faktinė įvykdymo data",
    "Redagavimo data",
    "BVPZ kodai",
    "Sutarties numeris",
    "Unikalus ID",
];

const SUTARTYS_WIDTHS = [
    8, 14, 45, 16, 16, 40, 14, 40, 20, 14, 18, 14, 20, 18, 14,
];

const SUTARTYS_NUMERIC = [
    { col: 3, format: "€#,##0.00" }, // Numatyta vertė
    { col: 4, format: "€#,##0.00" }, // Faktinė vertė
];

function resultToRow(r) {
    const fmt = (v) => (v ? v.toString().slice(0, 10) : "");
    return [
        r.tipas,
        r.kategorija,
        r.pavadinimas,
        parseFloat(r.verte) || 0,
        parseFloat(r.faktineVerte) || 0,
        r.perkanciojiOrganizacija,
        r.perkanciosiosOrganizacijosKodas,
        r.tiekejai.join("; "),
        r.tiekejaiKodai.join("; "),
        fmt(r.sudarymoData),
        fmt(r.faktineIvykdymoData),
        fmt(r.paskutinioRedagavimoData),
        r.bvpzKodai.join("; ") || "",
        r.sutartiesNumeris || "",
        r.sutartiesUnikalusId,
    ];
}

function makeSutartysSheet(wb, results) {
    const ws = wb.addWorksheet("Sutartys", {
        views: [{ state: "frozen", ySplit: 1 }],
    });

    ws.columns = SUTARTYS_HEADERS.map((header, i) => ({
        header,
        width: SUTARTYS_WIDTHS[i],
    }));

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, colNum) => {
        if (colNum > SUTARTYS_HEADERS.length) return;
        cell.font = { ...FONT, bold: true };
        cell.fill = HEADER_FILL;
        cell.border = CELL_BORDER;
    });

    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: SUTARTYS_HEADERS.length },
    };

    const numericColSet = new Map(
        SUTARTYS_NUMERIC.map(({ col, format }) => [col, format]),
    );

    for (const r of results) {
        const added = ws.addRow(resultToRow(r));
        added.eachCell((cell, colNum) => {
            cell.font = FONT;
            cell.border = CELL_BORDER;
            const format = numericColSet.get(colNum - 1);
            if (format !== undefined && format) cell.numFmt = format;
        });
    }
}

export async function buildAnalizeXlsx(analize, results) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "viespirkiai.org";
    wb.created = new Date();

    makeSutartysSheet(wb, results);

    makeSheet(
        wb,
        "Top tiekėjai",
        analize.topTiekejai,
        [
            "Tiekėjo kodas",
            "Tiekėjo pavadinimas",
            "Sutarčių verčių suma",
            "Sutarčių skaičius",
        ],
        ["kodas", "tiekejas", "suma", "kiekis"],
        [
            { col: 2, format: "€#,##0.00" },
            { col: 3, format: "" },
        ],
        [18, 45, 22, 20],
    );

    makeSheet(
        wb,
        "Top pirkėjai",
        analize.topPirkejai,
        [
            "Pirkėjo kodas",
            "Pirkėjo pavadinimas",
            "Sutarčių verčių suma",
            "Sutarčių skaičius",
        ],
        ["kodas", "pirkejas", "suma", "kiekis"],
        [
            { col: 2, format: "€#,##0.00" },
            { col: 3, format: "" },
        ],
        [18, 45, 22, 20],
    );

    makeSheet(
        wb,
        "Metinės sumos",
        analize.metinesSumos,
        ["Metai", "Sutarčių verčių suma"],
        ["metai", "suma"],
        [{ col: 1, format: "€#,##0.00" }],
        [12, 22],
    );

    makeSheet(
        wb,
        "Sutarčių tipai",
        analize.tipai,
        ["Tipas", "Sutarčių skaičius"],
        ["tipas", "count"],
        [{ col: 1, format: "" }],
        [12, 20],
    );

    return wb.xlsx.writeBuffer();
}

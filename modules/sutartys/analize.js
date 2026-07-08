import AdmZip from "adm-zip";
import { specialJarCodes } from "../juridiniai/specialJarCodes.js";

const EUR_FORMAT = '#,##0.00 [$€-lt-LT]';
// Eksporto viršutinė riba. Quickwit 0.8 leidžia pasiekti nebent 20 000 įrašų
// (max_hits 10 000 + start_offset 10 000), tad tiek ir eksportuojam (xlsx/csv/jsonl).
export const XLSX_EXPORT_LIMIT = 20_000;

export function canExportAnalizeXlsx(count) {
    return Number.isInteger(count) && count >= 0 && count <= XLSX_EXPORT_LIMIT;
}

const xml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const date = (value) => value ? String(value).slice(0, 10) : "";

function addGroup(groups, key, name, value) {
    const id = key || "Nežinoma";
    const current = groups.get(id) ?? { kodas: key || "", pavadinimas: name || "Nežinoma", suma: 0, kiekis: 0 };
    current.suma += value;
    current.kiekis++;
    groups.set(id, current);
}

function sortedGroups(groups) {
    return [...groups.values()].sort((a, b) => b.suma - a.suma || b.kiekis - a.kiekis);
}

export function buildAnalize(results) {
    const tiekejai = new Map();
    const pirkejai = new Map();
    const bvpz = new Map();
    const metai = new Map();
    const tipai = new Map();
    let bendraVerte = 0;

    for (const row of results) {
        const isPakeitimas = String(row.tipas || "").trim().toUpperCase() === "SP";
        const verte = isPakeitimas
            ? 0
            : number(row.faktineIvykdimoVerte ?? row.faktineVerte ?? row.verte);
        bendraVerte += verte;

        addGroup(tipai, row.tipas, row.tipoPavadinimas || row.tipas, verte);
        if (isPakeitimas) continue;

        const metaiKey = date(row.sudarymoData).slice(0, 4);
        if (metaiKey) addGroup(metai, metaiKey, metaiKey, verte);
        addGroup(
            pirkejai,
            row.perkanciosiosOrganizacijosKodas,
            row.perkanciojiOrganizacija,
            verte,
        );

        const supplierCodes = row.tiekejaiKodai ?? [];
        (row.tiekejai ?? []).forEach((name, index) => {
            const code = supplierCodes[index] ?? "";
            addGroup(tiekejai, code || name, specialJarCodes[code]?.pavadinimas ?? name, verte);
        });

        const bvpzNames = row.bvpzPavadinimai ?? [];
        (row.bvpzKodai ?? []).filter(Boolean).forEach((code, index) => {
            addGroup(bvpz, code, bvpzNames[index] || code, verte);
        });
    }

    return {
        santrauka: [
            { rodiklis: "Sutarčių skaičius", reiksme: results.length },
            { rodiklis: "Bendra vertė", reiksme: bendraVerte },
            { rodiklis: "Tiekėjų skaičius", reiksme: tiekejai.size },
            { rodiklis: "Pirkėjų skaičius", reiksme: pirkejai.size },
            { rodiklis: "BVPŽ kodų skaičius", reiksme: bvpz.size },
        ],
        tiekejai: sortedGroups(tiekejai),
        pirkejai: sortedGroups(pirkejai),
        bvpz: sortedGroups(bvpz),
        metai: sortedGroups(metai).sort((a, b) => String(a.kodas).localeCompare(String(b.kodas))),
        tipai: sortedGroups(tipai),
    };
}

function resultRows(results) {
    return results.map((row) => [
        row.tipas ?? "",
        row.kategorija ?? "",
        row.pavadinimas ?? "",
        number(row.verte),
        number(row.faktineIvykdimoVerte ?? row.faktineVerte),
        row.perkanciojiOrganizacija ?? "",
        row.perkanciosiosOrganizacijosKodas ?? "",
        (row.tiekejai ?? []).filter(Boolean).join("; "),
        (row.tiekejaiKodai ?? []).filter(Boolean).join("; "),
        date(row.sudarymoData),
        date(row.faktineIvykdimoData ?? row.faktineIvykdymoData),
        date(row.paskutinioRedagavimoData),
        (row.bvpzKodai ?? []).filter(Boolean).join("; "),
        row.sutartiesNumeris ?? "",
        row.sutartiesUnikalusId ?? "",
    ]);
}

function summaryRows(analysis, metadata) {
    const exportedAt = metadata.exportedAt ?? new Date();
    const filters = metadata.filters || "Filtrai netaikyti";

    return [
        ["", "Sutarčių rezultatų analizė", "", ""],
        ["", `Eksportuota ${exportedAt.toLocaleString("lt-LT", { timeZone: "Europe/Vilnius" })}`, "", ""],
        ["", "Paieškos rezultatų nuoroda", metadata.viewUrl || "", ""],
        ["", "Naudoti filtrai", filters, ""],
        ["", "", "", ""],
        ["", "Pagrindiniai rodikliai", "", ""],
        ["", "Sutarčių skaičius", "Bendra vertė be pakeitimų", "Unikalūs tiekėjai"],
        [
            "",
            String(analysis.santrauka[0].reiksme),
            `${number(analysis.santrauka[1].reiksme).toLocaleString("lt-LT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
            String(analysis.santrauka[2].reiksme),
        ],
        ["", "Unikalūs pirkėjai", "BVPŽ kodai", ""],
        [
            "",
            String(analysis.santrauka[3].reiksme),
            String(analysis.santrauka[4].reiksme),
            "",
        ],
        ["", "", "", ""],
        ["", "Atidaryti lenteles", "", ""],
        ["", "Sutartys", "Tiekėjai", "Pirkėjai"],
        ["", "BVPŽ", "Metai", "Tipai"],
    ];
}

export function buildAnalizeSheets(results, metadata = {}) {
    const analysis = buildAnalize(results);
    const groupSheet = (name, rows, firstHeader) => ({
        name,
        headers: [firstHeader, "Pavadinimas", "Sutarčių verčių suma", "Sutarčių skaičius"],
        rows: rows.map((row) => [row.kodas, row.pavadinimas, row.suma, row.kiekis]),
        numeric: new Set([2, 3]),
        currency: new Set([2]),
    });

    return [
        {
            name: "Santrauka",
            headers: ["", "", "", ""],
            rows: summaryRows(analysis, metadata),
            numeric: new Set(),
            currency: new Set(),
            widths: [3, 54, 28, 32],
            summary: true,
            viewUrl: metadata.viewUrl || "",
        },
        {
            name: "Sutartys",
            headers: ["Tipas", "Kategorija", "Pavadinimas", "Numatyta vertė", "Faktinė vertė", "Pirkėjo pavadinimas", "Pirkėjo kodas", "Tiekėjų pavadinimai", "Tiekėjų kodai", "Sudarymo data", "Faktinė įvykdymo data", "Redagavimo data", "BVPŽ kodai", "Sutarties numeris", "Unikalus ID"],
            rows: resultRows(results),
            numeric: new Set([3, 4]),
            currency: new Set([3, 4]),
            widths: [12, 18, 58, 20, 20, 48, 18, 52, 28, 16, 20, 16, 28, 24, 16],
        },
        { ...groupSheet("Tiekėjai", analysis.tiekejai, "Tiekėjo kodas"), widths: [18, 52, 24, 20] },
        { ...groupSheet("Pirkėjai", analysis.pirkejai, "Pirkėjo kodas"), widths: [18, 52, 24, 20] },
        { ...groupSheet("BVPŽ", analysis.bvpz, "BVPŽ kodas"), widths: [16, 58, 24, 20] },
        {
            name: "Metai",
            headers: ["Metai", "Sutarčių verčių suma", "Sutarčių skaičius"],
            rows: analysis.metai.map((row) => [row.kodas, row.suma, row.kiekis]),
            numeric: new Set([1, 2]),
            currency: new Set([1]),
            widths: [12, 24, 20],
        },
        { ...groupSheet("Tipai", analysis.tipai, "Tipas"), widths: [16, 42, 24, 20] },
    ];
}

function columnName(index) {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
}

function xlsxCell(value, row, col, sheet) {
    const ref = `${columnName(col)}${row}`;
    if (sheet.numeric.has(col)) {
        return `<c r="${ref}" s="${sheet.currency.has(col) ? 2 : 1}"><v>${number(value)}</v></c>`;
    }
    if (sheet.summary && row === 4 && col === 2 && value) {
        return `<c r="${ref}" s="6" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }
    const sheetLinks = {
        "2:1": "Sutartys",
        "2:2": "Tiekėjai",
        "2:3": "Pirkėjai",
        "3:1": "BVPŽ",
        "3:2": "Metai",
        "3:3": "Tipai",
    };
    const linkedSheet = sheet.summary ? sheetLinks[`${row - 12}:${col}`] : undefined;
    if (linkedSheet) {
        return `<c r="${ref}" s="6" t="inlineStr"><is><t>${xml(value)} →</t></is></c>`;
    }
    const sectionRows = new Set([7, 13]);
    const kpiLabelRows = new Set([8, 10]);
    const kpiValueRows = new Set([9, 11]);
    const style = sheet.summary && row === 2 && col >= 1 && col <= 3
        ? ' s="8"'
        : sheet.summary && sectionRows.has(row) && col === 1 && value
        ? ' s="4"'
        : sheet.summary && kpiLabelRows.has(row) && col > 0
            ? ' s="7"'
            : sheet.summary && kpiValueRows.has(row) && col > 0
                ? ' s="8"'
                : sheet.summary
                    ? ' s="5"'
                    : ' s="1"';
    const text = value === "" && sheet.summary ? " " : value;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function xlsxSheet(sheet) {
    const rows = [sheet.headers, ...sheet.rows].map((values, index) => {
        const cells = values.map((value, col) => index === 0
            ? `<c r="${columnName(col)}1" s="${sheet.summary ? 0 : 3}" t="inlineStr"><is><t>${xml(value === "" ? " " : value)}</t></is></c>`
            : xlsxCell(value, index + 1, col, sheet)).join("");
        const height = sheet.summary
            ? (index === 0 ? 12 : index === 1 ? 32 : index === 6 || index === 12 ? 26 : 24)
            : index === 0 ? 22 : 18;
        return `<row r="${index + 1}" ht="${height}" customHeight="1">${cells}</row>`;
    }).join("");
    const lastColumn = columnName(sheet.headers.length - 1);
    const columns = sheet.widths.map((width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    ).join("");
    const view = sheet.summary
        ? "<sheetViews><sheetView showGridLines=\"0\" workbookViewId=\"0\"/></sheetViews>"
        : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    const filter = sheet.summary ? "" : `<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>`;
    const summaryExtras = sheet.summary
        ? `<mergeCells count="5"><mergeCell ref="B2:D2"/><mergeCell ref="B3:D3"/><mergeCell ref="C4:D4"/><mergeCell ref="C5:D5"/><mergeCell ref="B13:D13"/></mergeCells><hyperlinks><hyperlink ref="C4" r:id="rId2"/><hyperlink ref="B14" location="'Sutartys'!A1" display="Sutartys →"/><hyperlink ref="C14" location="'Tiekėjai'!A1" display="Tiekėjai →"/><hyperlink ref="D14" location="'Pirkėjai'!A1" display="Pirkėjai →"/><hyperlink ref="B15" location="'BVPŽ'!A1" display="BVPŽ →"/><hyperlink ref="C15" location="'Metai'!A1" display="Metai →"/><hyperlink ref="D15" location="'Tipai'!A1" display="Tipai →"/></hyperlinks>`
        : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${sheet.rows.length + 1}"/>${view}<cols>${columns}</cols><sheetData>${rows}</sheetData>${filter}${summaryExtras}</worksheet>`;
}

export function buildAnalizeXlsx(results, metadata = {}) {
    const sheets = buildAnalizeSheets(results, metadata);
    const zip = new AdmZip();
    const add = (path, contents) => zip.addFile(path, Buffer.from(contents));

    add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
    add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
    add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="${xml(EUR_FORMAT)}"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Ubuntu"/></font><font><b/><sz val="11"/><name val="Ubuntu"/></font><font><u/><color rgb="FF075985"/><sz val="11"/><name val="Ubuntu"/></font><font><b/><color rgb="FF57534E"/><sz val="10"/><name val="Ubuntu"/></font><font><b/><color rgb="FF0C0A09"/><sz val="18"/><name val="Ubuntu"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAFAF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E5E4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6D3D1"/></left><right style="thin"><color rgb="FFD6D3D1"/></right><top style="thin"><color rgb="FFD6D3D1"/></top><bottom style="thin"><color rgb="FFD6D3D1"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="10"><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="3" fillId="0" borderId="0" applyFont="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="3" fillId="1" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" horizontal="left" vertical="center" indent="1"/></xf><xf fontId="4" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" horizontal="left" vertical="center" indent="1"/></xf><xf fontId="0" fillId="1" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf></cellXfs></styleSheet>`);
    sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, xlsxSheet(sheet)));
    add("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(metadata.viewUrl || "https://viespirkiai.org")}" TargetMode="External"/></Relationships>`);
    return zip.toBuffer();
}

import AdmZip from "adm-zip";
import { specialJarCodes } from "../juridiniai/specialJarCodes.js";

const EUR_FORMAT = '#,##0.00 [$€-lt-LT]';
export const XLSX_EXPORT_LIMIT = 50_000;

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
        ? `<mergeCells count="5"><mergeCell ref="B2:D2"/><mergeCell ref="B3:D3"/><mergeCell ref="C4:D4"/><mergeCell ref="C5:D5"/><mergeCell ref="B13:D13"/></mergeCells><hyperlinks><hyperlink ref="C4" r:id="rId2"/><hyperlink ref="B14" location="'Sutartys'!A1" display="Sutartys →"/><hyperlink ref="C14" location="'Tiekėjai'!A1" display="Tiekėjai →"/><hyperlink ref="D14" location="'Pirkėjai'!A1" display="Pirkėjai →"/><hyperlink ref="B15" location="'BVPŽ'!A1" display="BVPŽ →"/><hyperlink ref="C15" location="'Metai'!A1" display="Metai →"/><hyperlink ref="D15" location="'Tipai'!A1" display="Tipai →"/></hyperlinks><drawing r:id="rId1"/>`
        : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${sheet.rows.length + 1}"/>${view}<cols>${columns}</cols><sheetData>${rows}</sheetData>${filter}${summaryExtras}</worksheet>`;
}

function chart(title, sheet, categories, values, type = "bar", color = "2F6B8A", empty = false) {
    if (empty) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:spPr><a:solidFill><a:srgbClr val="FFFAF9"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D6D3D1"/></a:solidFill></a:ln></c:spPr><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="lt-LT" typeface="Ubuntu" sz="1200" b="1"><a:solidFill><a:srgbClr val="0C0A09"/></a:solidFill></a:rPr><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:plotArea><c:layout/></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
    }
    const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Sutarčių vertė</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strRef><c:f>'${sheet}'!${categories}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'${sheet}'!${values}</c:f></c:numRef></c:val></c:ser>`;
    const plot = type === "line"
        ? `<c:lineChart><c:grouping val="standard"/>${series}<c:marker val="1"/><c:dLbls><c:showVal val="1"/><c:showLegendKey val="0"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls><c:axId val="123456"/><c:axId val="654321"/></c:lineChart>`
        : `<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:dLbls><c:showVal val="1"/><c:showLegendKey val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:dLblPos val="outEnd"/></c:dLbls><c:gapWidth val="60"/><c:axId val="123456"/><c:axId val="654321"/></c:barChart>`;
    const layout = type === "bar"
        ? '<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="factor"/><c:yMode val="factor"/><c:wMode val="factor"/><c:hMode val="factor"/><c:x val="0.42"/><c:y val="0.08"/><c:w val="0.52"/><c:h val="0.78"/></c:manualLayout></c:layout>'
        : '<c:layout/>';
    const categoryOrientation = type === "bar" ? "maxMin" : "minMax";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:spPr><a:solidFill><a:srgbClr val="FFFAF9"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D6D3D1"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr typeface="Ubuntu" sz="900"><a:solidFill><a:srgbClr val="57534E"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="lt-LT" typeface="Ubuntu" sz="1200" b="1"><a:solidFill><a:srgbClr val="0C0A09"/></a:solidFill></a:rPr><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea>${layout}${plot}<c:catAx><c:axId val="123456"/><c:scaling><c:orientation val="${categoryOrientation}"/></c:scaling><c:delete val="0"/><c:axPos val="${type === "bar" ? "l" : "b"}"/><c:tickLblPos val="nextTo"/><c:crossAx val="654321"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="654321"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${type === "bar" ? "b" : "l"}"/><c:numFmt formatCode="#,##0 [$€-lt-LT]" sourceLinked="0"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="E7E5E4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:tickLblPos val="nextTo"/><c:crossAx val="123456"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function drawing() {
    const anchor = (id, chartId, fromCol, fromRow, toCol, toRow) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Diagrama ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${chartId}"/></a:graphicData></a:graphic><xdr:clientData/></xdr:graphicFrame></xdr:twoCellAnchor>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchor(1, 1, 1, 17, 11, 35)}${anchor(2, 2, 1, 37, 11, 63)}${anchor(3, 3, 1, 65, 11, 91)}</xdr:wsDr>`;
}

export function buildAnalizeXlsx(results, metadata = {}) {
    const sheets = buildAnalizeSheets(results, metadata);
    const zip = new AdmZip();
    const add = (path, contents) => zip.addFile(path, Buffer.from(contents));
    const topTiekejaiEnd = Math.max(2, Math.min(6, sheets[2].rows.length + 1));
    const topPirkejaiEnd = Math.max(2, Math.min(6, sheets[3].rows.length + 1));
    const metaiEnd = Math.max(2, sheets[5].rows.length + 1);

    add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
    add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
    add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="${xml(EUR_FORMAT)}"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Ubuntu"/></font><font><b/><sz val="11"/><name val="Ubuntu"/></font><font><u/><color rgb="FF075985"/><sz val="11"/><name val="Ubuntu"/></font><font><b/><color rgb="FF57534E"/><sz val="10"/><name val="Ubuntu"/></font><font><b/><color rgb="FF0C0A09"/><sz val="18"/><name val="Ubuntu"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAFAF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E5E4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD6D3D1"/></left><right style="thin"><color rgb="FFD6D3D1"/></right><top style="thin"><color rgb="FFD6D3D1"/></top><bottom style="thin"><color rgb="FFD6D3D1"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="10"><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment vertical="center"/></xf><xf fontId="3" fillId="0" borderId="0" applyFont="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="0" fillId="0" borderId="0" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf><xf fontId="3" fillId="1" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" horizontal="left" vertical="center" indent="1"/></xf><xf fontId="4" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" horizontal="left" vertical="center" indent="1"/></xf><xf fontId="0" fillId="1" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment wrapText="1" vertical="center" indent="1"/></xf></cellXfs></styleSheet>`);
    sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, xlsxSheet(sheet)));
    add("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(metadata.viewUrl || "https://viespirkiai.org")}" TargetMode="External"/></Relationships>`);
    add("xl/drawings/drawing1.xml", drawing());
    add("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart3.xml"/></Relationships>`);
    add("xl/charts/chart1.xml", chart("Sutarčių vertė pagal metus", "Metai", `$A$2:$A$${metaiEnd}`, `$B$2:$B$${metaiEnd}`, "line", "57534E", sheets[5].rows.length === 0));
    add("xl/charts/chart2.xml", chart("Didžiausi tiekėjai pagal vertę", "Tiekėjai", `$B$2:$B$${topTiekejaiEnd}`, `$C$2:$C$${topTiekejaiEnd}`, "bar", "57534E", sheets[2].rows.length === 0));
    add("xl/charts/chart3.xml", chart("Didžiausi pirkėjai pagal vertę", "Pirkėjai", `$B$2:$B$${topPirkejaiEnd}`, `$C$2:$C$${topPirkejaiEnd}`, "bar", "78716C", sheets[3].rows.length === 0));
    return zip.toBuffer();
}

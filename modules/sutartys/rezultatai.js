import { fixHtmlEntities } from "../../utils/fixHtmlEntities.js";
import { specialJarCodes } from "../juridiniai/specialJarCodes.js";
import * as XLSX from "xlsx";

const CONTRACT_TYPES = {
    TSP: "Tarptautinis arba supaprastintas pirkimas",
    MVP: "Mažos vertės pirkimas",
    ŽS: "Žodinė sutartis",
    MVPŽ: "Mažos vertės žodinis pirkimas",
    SPŽ: "Supaprastintos vertės žodinis pirkimas",
    PPS: "Pagrindinė pirkimo sutartis",
    VS: "Vidaus sandoris",
    SP: "Sutarties pakeitimas",
    PSĮ: "Pirkimas iš susijusios įmonės",
    "ILGALAIKĖ MVPŽ": "Ilgalaikė mažos vertės žodinė sutartis",
};

/**
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiRezultata(r) {
    if (r.id) {
        r.sutartiesUnikalusId = r.id;
        delete r.id;
    }
    if (r.sutartiesUnikalusID) {
        r.id = r.sutartiesUnikalusID;
        delete r.sutartiesUnikalusID;
    }

    r.bvpzKodai = [r.bvpzKodas, ...(r.papildomiBvpzKodai ?? [])];
    delete r.bvpzKodas;
    delete r.papildomiBvpzKodai;

    r.bvpzPavadinimai = [
        r.bvpzPavadinimas,
        ...(r.papildomiBvpzPavadinimai ?? []),
    ];
    delete r.bvpzPavadinimas;
    delete r.papildomiBvpzPavadinimai;

    r.tiekejai = [r.tiekejas, ...(r.papildomiTiekejai ?? [])];
    delete r.tiekejas;
    delete r.papildomiTiekejai;

    r.tiekejaiKodai = [r.tiekejoKodas, ...(r.papildomiTiekejaiKodai ?? [])];
    delete r.tiekejoKodas;
    delete r.papildomiTiekejaiKodai;

    r.pavadinimas = fixHtmlEntities(r.pavadinimas);
    r.perkanciojiOrganizacija = fixHtmlEntities(r.perkanciojiOrganizacija);
    r.tiekejai = r.tiekejai.map(fixHtmlEntities);

    const tipo = (r.tipas || "").trim().toUpperCase();
    r.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    return r;
}

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

// ─── XLSX ─────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} rows
 * @param {string[]} headers - display header names
 * @param {string[]} keys - row property names matching headers
 * @param {{ col: number, format: string, type: 'n' }[]} numericCols
 * @param {number[]} colWidths
 * @returns {object} XLSX sheet
 */
function makeSheet(rows, headers, keys, numericCols, colWidths) {
    const data = rows.map((row) =>
        Object.fromEntries(headers.map((h, i) => [h, row[keys[i]]])),
    );
    const sheet = XLSX.utils.json_to_sheet(data, { cellDates: true });
    sheet["!cols"] = colWidths.map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
        for (const { col, format, type } of numericCols) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c: col })];
            if (!cell) continue;
            cell.t = type;
            cell.v =
                type === "n" && format?.includes("#")
                    ? parseFloat(cell.v) || 0
                    : parseInt(cell.v) || 0;
            if (format) cell.z = format;
        }
    }
    return sheet;
}

/**
 * @param {object} analize
 * @returns {Buffer}
 */
export function buildAnalizeXlsx(analize) {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(
            analize.topTiekejai,
            [
                "Tiekėjo kodas",
                "Tiekėjo pavadinimas",
                "Sutarčių verčių suma",
                "Sutarčių skaičius",
            ],
            ["kodas", "tiekejas", "suma", "kiekis"],
            [
                { col: 2, type: "n", format: "€#,##0.00" },
                { col: 3, type: "n" },
            ],
            [18, 45, 22, 20],
        ),
        "Top tiekėjai",
    );

    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(
            analize.topPirkejai,
            [
                "Pirkėjo kodas",
                "Pirkėjo pavadinimas",
                "Sutarčių verčių suma",
                "Sutarčių skaičius",
            ],
            ["kodas", "pirkejas", "suma", "kiekis"],
            [
                { col: 2, type: "n", format: "€#,##0.00" },
                { col: 3, type: "n" },
            ],
            [18, 45, 22, 20],
        ),
        "Top pirkėjai",
    );

    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(
            analize.metinesSumos,
            ["Metai", "Sutarčių verčių suma"],
            ["metai", "suma"],
            [{ col: 1, type: "n", format: "€#,##0.00" }],
            [12, 22],
        ),
        "Metinės sumos",
    );

    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(
            analize.tipai,
            ["Tipas", "Sutarčių skaičius"],
            ["tipas", "count"],
            [{ col: 1, type: "n" }],
            [12, 20],
        ),
        "Sutarčių tipai",
    );

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

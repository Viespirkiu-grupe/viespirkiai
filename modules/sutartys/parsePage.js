import { Parser } from "htmlparser2";
import { decodeHTML } from "entities";

const VOID_ELEMENTS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

function element(name, attributes) {
    return { name, attributes, children: [] };
}

function appendText(parent, data) {
    if (!data) return;
    const previous = parent.children.at(-1);
    if (typeof previous === "string") {
        parent.children[parent.children.length - 1] += data;
    } else {
        parent.children.push(data);
    }
}

function textContent(node) {
    if (typeof node === "string") return decodeHTML(node);
    let result = "";
    for (const child of node.children) result += textContent(child);
    return result;
}

function serialize(node) {
    if (typeof node === "string") return node;
    let attributes = "";
    for (const [name, value] of Object.entries(node.attributes)) {
        attributes += ` ${name}="${value}"`;
    }
    const opening = `<${node.name}${attributes}>`;
    if (VOID_ELEMENTS.has(node.name)) return opening;
    return `${opening}${innerHTML(node)}</${node.name}>`;
}

function innerHTML(node) {
    let result = "";
    for (const child of node.children) result += serialize(child);
    return result;
}

function directElements(node, name) {
    return node.children.filter(
        (child) => typeof child !== "string" && child.name === name,
    );
}

function findAll(node, predicate, result = []) {
    for (const child of node.children) {
        if (typeof child === "string") continue;
        if (predicate(child)) result.push(child);
        findAll(child, predicate, result);
    }
    return result;
}

function findFirst(node, predicate) {
    for (const child of node.children) {
        if (typeof child === "string") continue;
        if (predicate(child)) return child;
        const nested = findFirst(child, predicate);
        if (nested) return nested;
    }
    return null;
}

function hasClass(node, className) {
    return (node.attributes.class ?? "").split(/\s+/).includes(className);
}

/**
 * Tokenize the page while retaining only the contracts table. This deliberately
 * avoids constructing a browser-like DOM for the rest of the response.
 */
function parseRelevantHtml(html) {
    let table = null;
    let stack = [];
    let depth = 0;
    let h2Depth = null;
    let h2Text = "";
    let counterDepth = null;
    let counterText = "";
    let maintenance = false;

    const parser = new Parser(
        {
            onopentag(name, attributes) {
                depth++;

                if (name === "h2" && h2Depth === null) {
                    h2Depth = depth;
                    h2Text = "";
                }
                if (
                    counterDepth === null &&
                    (attributes.class ?? "")
                        .split(/\s+/)
                        .includes("counter")
                ) {
                    counterDepth = depth;
                    counterText = "";
                }

                if (
                    table === null &&
                    name === "table" &&
                    attributes.id === "lenetele_table"
                ) {
                    table = element(name, attributes);
                    stack = [table];
                    return;
                }

                if (stack.length > 0) {
                    const node = element(name, attributes);
                    stack.at(-1).children.push(node);
                    stack.push(node);
                }
            },
            ontext(text) {
                if (h2Depth !== null) h2Text += text;
                if (counterDepth !== null) counterText += text;
                if (stack.length > 0) appendText(stack.at(-1), text);
            },
            onclosetag() {
                if (stack.length > 0) stack.pop();

                if (h2Depth === depth) {
                    if (
                        decodeHTML(h2Text).includes(
                            "Vyksta sistemos atnaujinimo darbai",
                        )
                    ) {
                        maintenance = true;
                    }
                    h2Depth = null;
                }
                if (counterDepth === depth) counterDepth = null;
                depth--;
            },
        },
        {
            decodeEntities: false,
            lowerCaseAttributeNames: true,
            lowerCaseTags: true,
        },
    );

    parser.end(html);
    return {
        maintenance,
        table,
        counterText: decodeHTML(counterText),
    };
}

function parseContract(mainRow, extraRow) {
    const cells = directElements(mainRow, "td");
    const titleLink = findFirst(cells[1], (node) => node.name === "a");
    const category = findFirst(cells[1], (node) =>
        hasClass(node, "ProcurementType"),
    );
    const buyerLinks = findAll(cells[2], (node) => node.name === "a");
    const supplierLinks = findAll(cells[3], (node) => node.name === "a");

    let actualValueRaw = textContent(cells[7])
        .replace(/ /g, "")
        .replace("€", "")
        .trim();
    let actualDateRaw = textContent(cells[8]).replace(/ /g, "").trim();

    // Some CVP IS rows contain an execution date in the value cell. The real
    // date cell may be empty (2005349637) or repeat the date (2005343445).
    // A plain ISO date can never be an amount, so discard it as a value and use
    // it as the date only when the dedicated date cell is empty.
    if (/^\d{4}-\d{2}-\d{2}$/.test(actualValueRaw)) {
        if (!actualDateRaw) actualDateRaw = actualValueRaw;
        actualValueRaw = "";
    }

    const sutartis = {
        pavadinimas: innerHTML(titleLink).trimEnd(),
        kategorija: innerHTML(category),
        perkanciojiOrganizacija: buyerLinks[0]
            ? innerHTML(buyerLinks[0])
            : "",
        perkanciosiosOrganizacijosKodas: buyerLinks[1]
            ? innerHTML(buyerLinks[1])
            : "",
        tiekejas: supplierLinks[0]
            ? innerHTML(supplierLinks[0]).trimEnd()
            : "",
        tiekejoKodas: supplierLinks[1]
            ? innerHTML(supplierLinks[1])
            : "",
        verte: textContent(cells[4])
            .replace("€", "")
            .replace(/\./g, "")
            .replace(/,/g, "."),
        sudarymoData: textContent(cells[5]),
        galiojimoData: textContent(cells[6]),
        faktineIvykdimoVerte: actualValueRaw.includes(",")
            ? actualValueRaw.replace(/\./g, "").replace(/,/g, ".")
            : actualValueRaw,
        faktineIvykdimoData: actualDateRaw,
        tipas: textContent(cells[9]),
        bvpzKodas: "",
        bvpzPavadinimas: "",
        dokumentai: [],
        dokumentuKiekis: 0,
        papildomiBvpzKodai: [],
        papildomiBvpzPavadinimai: [],
        papildomiTiekejai: [],
        papildomiTiekejaiKodai: [],
    };

    for (let i = 2; i < supplierLinks.length; i += 2) {
        sutartis.papildomiTiekejai.push(
            innerHTML(supplierLinks[i]).trimEnd(),
        );
        sutartis.papildomiTiekejaiKodai.push(
            innerHTML(supplierLinks[i + 1]),
        );
    }

    const extraTable = findFirst(extraRow, (node) => node.name === "table");
    const extraRows = findAll(extraTable, (node) => node.name === "tr");

    for (const row of extraRows) {
        const rowCells = directElements(row, "td");
        const labelNode = findFirst(row, (node) => node.name === "b");
        if (!labelNode || !rowCells[1]) continue;

        const label = innerHTML(labelNode).trim();
        const valueCell = rowCells[1];
        const rowHtml = innerHTML(row);

        if (label.includes("Paskelbimo data")) {
            const span = findFirst(valueCell, (node) => node.name === "span");
            sutartis.paskelbimoData = span ? innerHTML(span) : "";
            if (rowHtml.includes("atnaujinimo data") && span) {
                sutartis.paskutinioAtnaujinimoData = decodeHTML(
                    span.attributes.title ?? "",
                ).replace("Paskutinio atnaujinimo data ", "");
            }
        } else if (label.includes("BVPŽ kodas")) {
            parseBvpz(valueCell, sutartis);
        } else if (label.includes("Paskutinio redagavimo data")) {
            sutartis.paskutinioRedagavimoData = innerHTML(valueCell);
        } else if (label.includes("Sutarties unikalus ID")) {
            sutartis.sutartiesUnikalusID = innerHTML(valueCell);
        } else if (label.includes("Sutarties numeris")) {
            sutartis.sutartiesNumeris = innerHTML(valueCell);
        } else if (label.includes("Pirkimo numeris")) {
            sutartis.pirkimoNumeris = innerHTML(valueCell);
        } else if (label.includes("Dokumentai")) {
            const links = findAll(valueCell, (node) => node.name === "a");
            for (const link of links) {
                const href = decodeHTML(link.attributes.href ?? "");
                if (!/file_id=\d+/.test(href)) continue;
                sutartis.dokumentai.push({
                    pavadinimas: innerHTML(link),
                    url: "https://eviesiejipirkimai.lt" + href,
                });
            }
            sutartis.dokumentuKiekis = sutartis.dokumentai.length;
        } else {
            throw new Error("Nerastas laukelis: " + rowHtml);
        }
    }

    sutartis.paskutiniKartaMatyta = new Date().toLocaleString("lt-LT", {
        timeZone: "Europe/Vilnius",
    });
    return sutartis;
}

function parseBvpz(valueCell, sutartis) {
    const firstLinkIndex = valueCell.children.findIndex(
        (node) => typeof node !== "string" && node.name === "a",
    );
    if (firstLinkIndex < 0) {
        sutartis.bvpzPavadinimas = textContent(valueCell).trim();
        return;
    }

    const firstLink = valueCell.children[firstLinkIndex];
    sutartis.bvpzKodas = textContent(firstLink).trim();
    sutartis.bvpzPavadinimas = valueCell.children
        .slice(0, firstLinkIndex)
        .map(textContent)
        .join(" ")
        .trim();

    for (let i = firstLinkIndex + 1; i < valueCell.children.length; i++) {
        const node = valueCell.children[i];
        if (typeof node === "string" || node.name !== "a") continue;
        sutartis.papildomiBvpzKodai.push(textContent(node).trim());

        let previousText = "";
        for (let j = i - 1; j >= 0; j--) {
            const previous = valueCell.children[j];
            if (typeof previous === "string" && decodeHTML(previous).trim()) {
                previousText = decodeHTML(previous).trim();
                break;
            }
        }
        sutartis.papildomiBvpzPavadinimai.push(previousText);
    }
}

/** Parse one eViesiejiPirkimai contracts HTML page into cloneable data. */
export function parseSutartysHtml(html) {
    const { maintenance, table, counterText } = parseRelevantHtml(html);
    if (maintenance) {
        return { status: "maintenance", sutartys: [], total: null };
    }
    if (!table) {
        return { status: "missing-table", sutartys: [], total: null };
    }

    const rows = findAll(table, (node) => node.name === "tr");
    const sutartys = [];
    let collecting = false;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!collecting) {
            if (row.attributes.id === "topRow") collecting = true;
            continue;
        }

        const mainMatch = row.attributes.id?.match(/^vptpublic_main_(\d+)$/);
        if (!mainMatch) continue;
        const extraRow = rows[i + 1];
        if (extraRow?.attributes.id !== `vptpublic_extra_${mainMatch[1]}`) {
            continue;
        }

        sutartys.push(parseContract(row, extraRow));
        i++;
    }

    const total = counterText.match(/Puslapis \d+ iš \d+ \((\d+)\)/)?.[1];
    return { status: "ok", sutartys, total };
}

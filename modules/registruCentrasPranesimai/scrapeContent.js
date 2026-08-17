import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("registruCentrasPranesimai", { operation: "scrapeContent" });
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    nuskaitytiInformaciniLeidini()
        .then(() => {
            log("Leidinio nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant leidinį:", err);
            postgres.end();
        });
}

export async function nuskaitytiInformaciniLeidini() {
    let response = await postgres.query(`
    SELECT * FROM "rcInformaciniaiLeidiniai" WHERE nuskaitymas IS NULL OR nuskaitymas = 0 ORDER BY data DESC LIMIT 1;
    `);

    const rows = response.rows;
    if (rows.length === 0) {
        log("Nėra naujų informacinių leidinių nuskaitymui.");
        return false;
    }

    const leidinys = rows[0];
    log(
        `Nuskaitymas informacinio leidinio oid ${leidinys.oid}, data: ${leidinys.data}`,
    );

    let parsed = await parseInformacinisLeidinys(leidinys.nuoroda);
    // For each row add
    // leidinioOid: leidinys.oid
    // leidinioLink: leidinys.nuoroda
    // leidinioData: leidinys.data
    // leidinioAtnaujinimas: leidinys.atnaujintas
    // leidinioNumeris: leidinys.numeris

    for (const item of parsed) {
        item.leidinioOid = leidinys.oid;
        item.leidinioLink = leidinys.nuoroda;
        item.leidinioData = leidinys.data;
        item.leidinioAtnaujinimas = leidinys.atnaujintas;
        item.leidinioNumeris = leidinys.numeris;
        if (item.children) {
            delete item.children;
        }
    }

    // Find duplicates in parsed by pranesimoNr
    const pranesimoNrSet = new Set();
    const duplicates = new Set();
    for (const item of parsed) {
        if (pranesimoNrSet.has(item.pranesimoNr)) {
            duplicates.add(item.pranesimoNr);
        } else {
            pranesimoNrSet.add(item.pranesimoNr);
        }
    }
    if (duplicates.size > 0) {
        log(
            `Rasti pasikartojantys pranešimų numeriai: ${Array.from(
                duplicates,
            ).join(", ")}`,
        );
    }

    // Find rows where jarKodas is NULL or missing, remove them
    const beforeCount = parsed.length;
    parsed = parsed.filter(
        (item) =>
            item.jarKodas != null && item.jarKodas.toString().trim() !== "",
    );
    const afterCount = parsed.length;
    if (beforeCount !== afterCount) {
        log(`Pašalinta ${beforeCount - afterCount} įrašų be jarKodas`);
    }

    // Insert in batches
    const batchSize = 500;
    for (let i = 0; i < parsed.length; i += batchSize) {
        const batch = parsed.slice(i, i + batchSize);
        await insertRows(batch);
    }

    // Update nuskaitymas to 1
    await postgres.query(
        `
    UPDATE "rcInformaciniaiLeidiniai"
    SET nuskaitymas = 1
    WHERE oid = $1;
    `,
        [leidinys.oid],
    );

    return true;
}

async function insertRows(parsed) {
    const query = `
      INSERT INTO "rcInformaciniaiLeidiniaiPranesimai"(
        "leidinioOid","title","subtitle","jarPavadinimas","jarKodas",
        "teisineForma","teisinisStatusas","buveinesAdresas","pranesimoNr","text",
        "leidinioLink","leidinioData","leidinioAtnaujinimas","leidinioNumeris"
      )
      VALUES
      ${parsed
          .map((_, i) => {
              const offset = i * 14;
              return Array.from(
                  { length: 14 },
                  (_, j) => `$${offset + j + 1}`,
              ).join(",");
          })
          .map((p) => `(${p})`)
          .join(",")}
      ON CONFLICT("pranesimoNr") DO UPDATE
      SET
        "title" = EXCLUDED."title",
        "subtitle" = EXCLUDED."subtitle",
        "jarPavadinimas" = EXCLUDED."jarPavadinimas",
        "jarKodas" = EXCLUDED."jarKodas",
        "teisineForma" = EXCLUDED."teisineForma",
        "teisinisStatusas" = EXCLUDED."teisinisStatusas",
        "buveinesAdresas" = EXCLUDED."buveinesAdresas",
        "text" = EXCLUDED."text",
        "leidinioLink" = EXCLUDED."leidinioLink",
        "leidinioData" = EXCLUDED."leidinioData",
        "leidinioAtnaujinimas" = EXCLUDED."leidinioAtnaujinimas",
        "leidinioNumeris" = EXCLUDED."leidinioNumeris";
      `;

    // Flatten values for placeholders
    const values = parsed.flatMap((p) => [
        p.leidinioOid,
        p.title,
        p.subtitle,
        p.jarPavadinimas,
        p.jarKodas,
        p.teisineForma,
        p.teisinisStatusas,
        p.buveinesAdresas,
        p.pranesimoNr,
        p.text,
        p.leidinioLink,
        p.leidinioData,
        p.leidinioAtnaujinimas || null,
        p.leidinioNumeris,
    ]);

    await postgres.query(query, values);
}

async function parseInformacinisLeidinys(url) {
    const res = await scrapeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = new Uint8Array(await res.arrayBuffer());

    const pdf = await getDocument({ data }).promise;

    let out = [];

    for (let pageNum = 3; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        for (const item of textContent.items) {
            const text = item.str;
            if (!text) continue;

            // font size from transform matrix
            const size = Math.round(
                Math.hypot(item.transform[0], item.transform[1]),
            );
            const bold = /bold|black|heavy|g_d0_f2/i.test(item.fontName || "");

            // VĮ Registrų centras. Informacinis leidinys Nr.2026-017
            const footerRegex =
                /^VĮ Registrų centras\. Informacinis leidinys Nr\.\d{4}-\d{3}$/;
            if (footerRegex.test(text)) continue;

            // Puslapis 3
            const pageNumRegex = /^Puslapis \d+$/;
            if (pageNumRegex.test(text)) continue;

            // Ignore empty text, spaces only
            if (/^\s*$/.test(text)) continue;

            out.push({
                text,
                size,
                bold,
            });
        }
    }

    // If there are multiple size 16 or 11 in a row, join the text with a space
    let mergedOut = [];
    for (let i = 0; i < out.length; i++) {
        const current = out[i];
        if (
            (current.size === 16 || current.size === 11) &&
            mergedOut.length > 0 &&
            mergedOut[mergedOut.length - 1].size === current.size
        ) {
            // Merge with previous
            mergedOut[mergedOut.length - 1].text += " " + current.text;
        } else {
            mergedOut.push(current);
        }
    }
    out = mergedOut;

    out = buildFlatWithChildren(out);

    // Loop over out
    for (const item of out) {
        // Remove all keys that have subtitle: null
        if (item.subtitle === null) {
            delete item.subtitle;
        }

        // Group children by ---
        // If no children, continue
        if (!item.children || item.children.length === 0) continue;

        item.children = groupBySeparator(item.children, "- - -");

        // Go over each group, the first bold text should be jarPavadinimas, ignore ", kodas", and a bold 9 digit code shall be jarKodas
        // Put what's left into textNodes
        for (const group of item.children) {
            let obj = {};
            const textNodes = [];

            for (const child of group) {
                if (!obj.jarPavadinimas) {
                    // First bold text
                    obj.jarPavadinimas = child.text.trim();
                } else if (/^\d{9}$/.test(child.text.trim())) {
                    // Bold 9 digit code
                    obj.jarKodas = child.text.trim();
                } else {
                    if (child.text == ", kodas") continue;
                    if (child.text.startsWith("Teisinė forma: ")) {
                        // Teisinė forma: Uždaroji akcinė bendrovė. Teisinis statusas: Teisinis statusas neįregistruotas
                        // Split into two keys
                        const parts = child.text
                            .replace("Teisinė forma: ", "")
                            .split(". Teisinis statusas: ");
                        obj.teisineForma = parts[0].trim();
                        if (parts[1]) {
                            obj.teisinisStatusas = parts[1].trim();
                        }
                        continue;
                    }
                    if (child.text.startsWith("Buveinės adresas: ")) {
                        obj.buveinesAdresas = child.text
                            .replace("Buveinės adresas: ", "")
                            .trim();
                        continue;
                    }
                    if (
                        child.text.startsWith("Pranešimo Nr. ") &&
                        !obj.pranesimoNr
                    ) {
                        obj.pranesimoNr = child.text
                            .replace("Pranešimo Nr. ", "")
                            .trim();
                        continue;
                    }

                    textNodes.push(child);
                }
            }

            // Join textNodes into a single string with \n
            obj.text = textNodes
                .map((n) => n.text)
                .join("\n")
                .trim();

            // Replace group content with structured object
            group.length = 0; // clear array
            group.push({
                ...obj,
            });
        }
    }

    out = flattenChildren(out);

    // Remove title: Registro tvarkytojo skelbimai where pranesimoNr is missing
    out = out.filter(
        (item) =>
            !(
                item.title === "Registro tvarkytojo skelbimai" &&
                !item.pranesimoNr
            ),
    );

    return out;
}

function flattenChildren(data) {
    const result = [];

    function recurse(items, parent = {}) {
        for (const item of items) {
            if (item.children && item.children.length) {
                for (const childGroup of item.children) {
                    for (const child of childGroup) {
                        // Merge parent fields if needed (like title/subtitle)
                        result.push({
                            ...parent,
                            ...item,
                            ...child,
                            children: undefined,
                        });
                        // Recurse in case the child itself has children
                        if (child.children && child.children.length) {
                            recurse(child.children, { ...parent, ...item });
                        }
                    }
                }
            }
        }
    }

    recurse(data);
    return result;
}

function buildFlatWithChildren(out) {
    const result = [];

    let currentLevel1 = null;
    let currentLevel2 = null;
    let currentChildren = null;

    for (const item of out) {
        if (item.size === 16) {
            // Level 1
            const [, ...titleParts] = item.text.split(" ");
            currentLevel1 = titleParts.join(" ");
            currentLevel2 = null;
            currentChildren = [];
            result.push({
                title: currentLevel1,
                subtitle: null,
                children: currentChildren,
            });
        } else if (item.size === 11) {
            // Level 2
            const [, ...titleParts] = item.text.split(" ");
            currentLevel2 = titleParts.join(" ");
            currentChildren = [];
            result.push({
                title: currentLevel1,
                subtitle: currentLevel2,
                children: currentChildren,
            });
        } else {
            // regular text
            if (!currentChildren) continue;
            if (item.text === "Nėra naujų pranešimų") continue;

            currentChildren.push({
                text: item.text,
                size: item.size,
                bold: item.bold,
            });
        }
    }

    return result;
}

function groupBySeparator(items, separator = "- - -") {
    const groups = [];
    let currentGroup = [];

    for (const item of items) {
        if (item.text.trim() === separator) {
            if (currentGroup.length) {
                groups.push(currentGroup);
                currentGroup = [];
            }
        } else {
            currentGroup.push(item);
        }
    }

    if (currentGroup.length) groups.push(currentGroup);

    return groups;
}

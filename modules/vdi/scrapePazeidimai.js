import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("vdi", { operation: "scrapePazeidimai" });
import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const BASE_URL = "https://www.vdi.lt/Forms/ATPK_imones_2024.aspx";

const ALLOWED_ARTICLES = new Set([
    "72",
    "95",
    "96",
    "97",
    "98",
    "981",
    "99",
    "100",
    "101",
    "102",
    "103",
    "104",
    "105",
    "106",
    "127",
    "150",
    "224",
    "234",
    "308",
    "3081",
    "3621",
    "453",
    "455",
    "505",
    "507",
    "542",
    "56",
    "561",
    "57",
    "58",
    "591",
]);

const CHUNK_SIZE = 100;

function extractFormFields(document) {
    const fields = {};
    for (const input of document.querySelectorAll('input[type="hidden"]')) {
        if (input.name) fields[input.name] = input.value ?? "";
    }
    return fields;
}

function parseRows(document) {
    const rows = [];
    const table = document.querySelector("table.rgMasterTable");
    if (!table) return rows;

    for (const tr of table.querySelectorAll("tr.rgRow, tr.rgAltRow")) {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 4) continue;
        const raw = cells[3].textContent.trim().normalize("NFC");
        const strMatch = raw.match(/(\d+)\s*str/i);
        const dalMatch = raw.match(/(\d+)\s*dal/i);
        rows.push({
            jarKodas: cells[0].textContent.trim(),
            jarTipas: cells[1].textContent.trim(),
            jarPavadinimas: cells[2].textContent.trim(),
            straipsnis: strMatch ? strMatch[1] : null,
            dalis: dalMatch ? parseInt(dalMatch[1], 10) : null,
            pirmaKarta: raw.includes("pirmą kartą"),
        });
    }
    return rows;
}

function getTotalPages(document) {
    const pagerInfo = document.querySelector("td.rgPagerCell");
    if (pagerInfo) {
        const match = pagerInfo.textContent.match(/(\d+)\s*(?:of|iš)\s*(\d+)/i);
        if (match) return parseInt(match[2], 10);
    }
    const pageLinks = document.querySelectorAll(".rgNumPart a");
    if (pageLinks.length > 0) {
        const nums = [...pageLinks]
            .map((a) => parseInt(a.textContent.trim(), 10))
            .filter((n) => !isNaN(n));
        return Math.max(...nums);
    }
    return 1;
}

async function fetchPage(pageIndex, formFields) {
    const body = new URLSearchParams({
        ...formFields,
        __EVENTTARGET: "RadGrid1",
        __EVENTARGUMENT: `FireCommand:RadGrid1_ctl00;PageSize=20;NewPageIndex=${pageIndex}`,
    });

    const res = await scrapeFetch(BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            Referer: BASE_URL,
        },
        body: body.toString(),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

async function insertChunk(rows, db = postgres) {
    const cols = [
        "jarKodas",
        "jarTipas",
        "jarPavadinimas",
        "straipsnis",
        "dalis",
        "pirmaKarta",
    ];
    const params = [];
    const values = rows.map((r) => {
        const placeholders = cols.map((col) => {
            params.push(r[col]);
            return `$${params.length}`;
        });
        const [kodas, tipas, pavadinimas, straipsnis, dalis, pirmaKarta] = placeholders;
        return `(vdi.subjekto_id(${kodas}::integer, ${pavadinimas}, ${tipas}),`
             + ` vdi.straipsnio_id(${straipsnis}, ${dalis}::smallint), ${pirmaKarta})`;
    });

    // Subjektas ir straipsnis eina per žodynus — jų reikšmės nebekartojamos
    // kiekvienoje eilutėje.
    await db.query(
        `INSERT INTO vdi.pazeidimai ("subjektoId", "straipsnioId", "pirmaKarta")
         VALUES ${values.join(", ")}`,
        params,
    );
}

export async function updateVdiPazeidimai() {
    const initRes = await scrapeFetch(BASE_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
    });
    const { document: doc1 } = parseHTML(await initRes.text());

    let formFields = extractFormFields(doc1);
    const allRecords = parseRows(doc1);
    const totalPages = getTotalPages(doc1);
    log(`${totalPages} pages`);

    for (let page = 1; page < totalPages; page++) {
        try {
            const html = await fetchPage(page, formFields);
            const { document } = parseHTML(html);
            formFields = extractFormFields(document);
            log(`Scraped page ${page + 1}`);
            allRecords.push(...parseRows(document));
        } catch (err) {
            log(`ERROR on page ${page + 1}: ${err.message}`);
        }
    }

    const filtered = allRecords.filter(
        (r) =>
            r.straipsnis !== null && ALLOWED_ARTICLES.has(String(r.straipsnis)),
    );
    log(
        `${allRecords.length} records scraped, ${filtered.length} after filter`,
    );

    const client = await postgres.connect();
    let changed = 0;
    try {
        await client.query("BEGIN");
        await client.query(
            `CREATE TEMP TABLE old_vdi_counts ON COMMIT DROP AS
             SELECT s."jarKodas", count(*)::bigint AS count
             FROM vdi.pazeidimai p
             JOIN vdi.subjektai s ON s.id = p."subjektoId"
             GROUP BY 1`,
        );
        await client.query(`TRUNCATE TABLE vdi.pazeidimai`);

        for (let offset = 0; offset < filtered.length; offset += CHUNK_SIZE) {
            await insertChunk(filtered.slice(offset, offset + CHUNK_SIZE), client);
        }
        const queued = await client.query(
            `WITH current_counts AS MATERIALIZED (
                SELECT s."jarKodas", count(*)::bigint AS count
                FROM vdi.pazeidimai p
                JOIN vdi.subjektai s ON s.id = p."subjektoId"
                GROUP BY 1
             ), changed AS MATERIALIZED (
                SELECT COALESCE(old."jarKodas", current."jarKodas") AS "jarKodas"
                FROM old_vdi_counts old
                FULL JOIN current_counts current USING ("jarKodas")
                WHERE old.count IS DISTINCT FROM current.count
             )
             INSERT INTO juridiniai."refreshQueue" ("jarKodas", "saltiniai")
             SELECT "jarKodas", ARRAY['vdi']
             FROM changed WHERE "jarKodas" BETWEEN 100000000 AND 999999999
             ON CONFLICT ("jarKodas") DO UPDATE SET
                "saltiniai" = ARRAY(
                    SELECT DISTINCT value FROM unnest(
                        juridiniai."refreshQueue"."saltiniai" ||
                        EXCLUDED."saltiniai"
                    ) value ORDER BY value
                ),
                "atnaujinta" = now()`,
        );
        changed = queued.rowCount;
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    if (changed > 0) {
        signalWork(WORK_SIGNALS.JURIDINIAI_REFRESH_READY, {
            source: "vdi",
            count: changed,
        });
    }

    log(`done`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updateVdiPazeidimai();
    await postgres.end();
}

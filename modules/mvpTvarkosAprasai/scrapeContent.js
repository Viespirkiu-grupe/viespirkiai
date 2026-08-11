import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("mvpTvarkosAprasai", { operation: "scrapeContent" });
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import Timings from "../../utils/timings.js";
import crypto from "node:crypto";
import { irasytiFailus } from "../failai/failuIrasymas.js";

export async function nuskaitytiMvpTvarkosAprasus(sbjId, options = {}) {
    let timings = options.timings || new Timings();

    if (!sbjId) {
        throw new Error("Reikalingas sbjId");
    }

    const url = `https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_sarasas.asp?SBJ_ID=${sbjId}`;

    log(`Subjektas: ${sbjId}`);

    timings.start("aprasaiFetch");
    const response = await scrapeFetch(url);
    timings.end("aprasaiFetch");

    const text = await response.text();
    const { document } = parseHTML(text);

    const table = document.querySelector("table.tblThinBorder");
    if (!table) {
        return { timings, rows: 0 };
    }

    const rows = [...table.querySelectorAll("tr")].slice(1);

    const aprasai = [];

    for (const row of rows) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 5) continue;

        const aprasymas = tds[0].textContent.trim();

        // rinkmenos
        const links = [...tds[1].querySelectorAll("a")];
        const rinkmenos = links.map((a) => a.getAttribute("href"));

        if (rinkmenos.length === 0) continue;

        // extract stable id from first file
        const idMatch = rinkmenos[0].match(/\/(\d+)\.(pdf|docx?|DOCX?)$/);
        const id = idMatch ? idMatch[1] : `${sbjId}_${aprasai.length}`;

        const cleanDate = (txt) => {
            txt = txt.trim();
            return txt ? txt : null;
        };

        aprasai.push({
            id,
            sbjId,
            aprasymas,
            rinkmenos,
            vptGavimoData: cleanDate(tds[2].textContent),
            paskelbimoData: cleanDate(tds[3].textContent),
            galiojaIki: cleanDate(tds[4].textContent),
        });
    }

    if (aprasai.length === 0) {
        return { timings, rows: 0 };
    }

    const seenHashes = new Set();
    const values = [];
    const placeholders = [];

    aprasai.forEach((a) => {
        // compute hash
        const hash = crypto
            .createHash("md5")
            .update([...a.rinkmenos, a.aprasymas, a.paskelbimoData].join("|"))
            .digest("hex");

        // skip if hash already seen
        if (seenHashes.has(hash)) return;
        seenHashes.add(hash);
        a.hash = hash;

        const b = values.length + 1; // current parameter index
        placeholders.push(
            `($${b}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`,
        );

        values.push(
            hash,
            a.sbjId,
            a.aprasymas,
            a.rinkmenos,
            a.vptGavimoData,
            a.paskelbimoData,
            a.galiojaIki,
        );
    });

    await postgres.query(
        `
        INSERT INTO "mvpTvarkosAprasai"
            ("hash","sbjId","aprasymas","rinkmenos",
             "vptGavimoData","paskelbimoData","galiojaIki")
        VALUES
            ${placeholders.join(",")}
        ON CONFLICT ("hash") DO UPDATE SET
            "aprasymas" = EXCLUDED."aprasymas",
            "rinkmenos" = EXCLUDED."rinkmenos",
            "vptGavimoData" = EXCLUDED."vptGavimoData",
            "paskelbimoData" = EXCLUDED."paskelbimoData",
            "galiojaIki" = EXCLUDED."galiojaIki"
        `,
        values,
    );

    // Insert deduplicated file links into public."failai"
    try {
        const filesList = [];

        for (const a of aprasai) {
            for (const href of a.rinkmenos) {
                if (!href) continue;

                // strip protocol+host if present, then leading slashes
                const withoutHost = href.replace(/^https?:\/\/[^/]+/i, "");
                const saltinioId = withoutHost.replace(/^\/+/, "");

                const pavadinimas = decodeURIComponent(
                    (saltinioId.split("/").pop() || "").trim(),
                );

                const extMatch = pavadinimas.match(/\.([^.]+)$/);
                const extension = extMatch ? extMatch[1].toLowerCase() : "";

                filesList.push({
                    saltinis: "mvpAprasai",
                    saltinioId,
                    pavadinimas,
                    extension,
                });
            }
        }

        // deduplicate by saltinioId
        const map = new Map();
        for (const f of filesList) {
            if (f && f.saltinioId) map.set(f.saltinioId, f);
        }

        const merged = Array.from(map.values()).sort((a, b) =>
            (a.saltinioId || "").localeCompare(b.saltinioId || ""),
        );

        // Dublikatus atmeta files unikalūs indeksai (žr. failuIrasymas.js).
        const nauji = await irasytiFailus(merged);
        if (nauji.length) {
            log(`Inserted ${nauji.length} rows into public.files`);
        }
    } catch (err) {
        console.error("Klaida insertinant i failai:", err);
    }

    return {
        timings,
        rows: aprasai.length,
    };
}

export async function nuskaitytiSeniausiaTvarkosAprasuSubjekta(options = {}) {
    const timings = options.timings || new Timings();

    const client = await postgres.connect();

    try {
        await client.query("BEGIN");

        // atomically claim one row
        const { rows } = await client.query(`
            SELECT *
            FROM "mvpAprasaiSubjektai"
            ORDER BY "lastScrape" ASC NULLS FIRST
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `);

        if (rows.length === 0) {
            await client.query("COMMIT");
            return { timings, rows: 0 };
        }

        const sbjId = rows[0].id;
        const lastScrape = rows[0].lastScrape;

        // mark immediately so other workers don't retry if we crash late
        await client.query(
            `
            UPDATE "mvpAprasaiSubjektai"
            SET "lastScrape" = NOW() AT TIME ZONE 'Europe/Vilnius'
            WHERE "id" = $1
        `,
            [sbjId],
        );

        await client.query("COMMIT");

        // do slow work OUTSIDE transaction
        const result = await nuskaitytiMvpTvarkosAprasus(sbjId, { timings });

        return {
            timings,
            sbjId,
            lastScrape,
            rows: result.rows,
        };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

export async function scrapeMvmUntilNow() {
    const startTime = new Date(); // mark the time we started

    while (true) {
        const result = await nuskaitytiSeniausiaTvarkosAprasuSubjekta();

        if (!result.rows || result.rows === 0) {
            break; // no more subjects
        }

        // if the row was already scraped after we started, stop
        if (result.lastScrape && new Date(result.lastScrape) >= startTime) {
            break;
        }
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    scrapeMvmUntilNow()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}

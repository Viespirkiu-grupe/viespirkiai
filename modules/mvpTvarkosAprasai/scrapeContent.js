import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("mvpTvarkosAprasai", { operation: "scrapeContent" });
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import Timings from "../../utils/timings.js";
import crypto from "node:crypto";
import { irasytiFailus } from "../failai/failuIrasymas.js";

/**
 * Nuoroda -> kelias be protokolo ir hosto. Toks pat pavidalas saugomas
 * "mvpAprasai"."tvarkos"."rinkmenos" ir files.files."sourceId0".
 */
function saltinioIdIsHref(href) {
    return href.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
}

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

        const cleanDate = (txt) => {
            txt = txt.trim();
            return txt ? txt : null;
        };

        aprasai.push({
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
        // Hash'as skaičiuojamas iš NEapdorotų nuorodų – saugomos jos jau be
        // hosto, tad iš lentelės turinio hash'as nebeperskaičiuojamas.
        // Pakeitus šitą – visi seni aprašai atsirastų iš naujo (žr.
        // mvpAprasaiSchema.sql).
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
            a.rinkmenos.map(saltinioIdIsHref),
            a.vptGavimoData,
            a.paskelbimoData,
            a.galiojaIki,
        );
    });

    await postgres.query(
        `
        INSERT INTO "mvpAprasai"."tvarkos"
            ("hash","subjektoId","pavadinimas","rinkmenos",
             "vptGavimoData","paskelbimoData","galiojaIki")
        VALUES
            ${placeholders.join(",")}
        ON CONFLICT ("hash") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
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

                const saltinioId = saltinioIdIsHref(href);

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
            log(`Inserted ${nauji.length} rows into files.files`);
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
            FROM "mvpAprasai"."subjektai"
            ORDER BY "paskutinisNuskaitymas" ASC NULLS FIRST
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `);

        if (rows.length === 0) {
            await client.query("COMMIT");
            return { timings, rows: 0 };
        }

        const sbjId = rows[0].id;
        const paskutinisNuskaitymas = rows[0].paskutinisNuskaitymas;

        // mark immediately so other workers don't retry if we crash late
        await client.query(
            `
            UPDATE "mvpAprasai"."subjektai"
            SET "paskutinisNuskaitymas" = now()
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
            paskutinisNuskaitymas,
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
        // (timestamptz, tad Date palyginimas teisingas – anksčiau laikas buvo
        // saugomas be zonos ir šis patikrinimas šlubavo per zonos poslinkį)
        if (
            result.paskutinisNuskaitymas &&
            new Date(result.paskutinisNuskaitymas) >= startTime
        ) {
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

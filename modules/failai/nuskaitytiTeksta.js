import process from "process";
import { Buffer } from "buffer";
import { log } from "../../utils/log.js";
import { postgres, parsePgArray } from "../../postgres/postgres.js";
import config from "../../utils/config.js";

const nodeName = process.env.NODE_NAME || "default";
const nuskaitymoVersija = 9;

/**
 * Cleans metadata object by removing null characters and trimming strings.
 * Recursively processes nested objects and arrays.
 * @param {any} obj - The metadata object to clean.
 * @returns {any} - The cleaned metadata object.
 */
function cleanMetadata(obj) {
    if (typeof obj === "string") {
        return obj.replace(/\u0000/g, "").trim();
    } else if (Array.isArray(obj)) {
        return obj.map(cleanMetadata);
    } else if (obj && typeof obj === "object") {
        for (const key in obj) {
            if (!Object.hasOwn(obj, key)) continue;
            const cleanKey = key.replace(/\u0000/g, "");
            const value = obj[key];
            obj[cleanKey] = cleanMetadata(value);
            if (cleanKey !== key) delete obj[key];
        }
    }
    return obj;
}

/**
 * Fetches and processes a document using an external document reader service.
 * @param {string} url - The URL of the document to be processed.
 * @param {number|null} nuskaitytojoId - Optional ID of a specific document reader to use.
 * @returns {Promise<Object>} - The result from the document reader service.
 * @throws Will throw an error if the document reader service fails or returns an invalid response.
 */
async function nuskaitytiDokNuskaitytojuje(
    url,
    nuskaitytojoId = null,
    extension = "pdf",
    dokumentas,
) {
    let nuskaitytojas;

    if (nuskaitytojoId) {
        const res = await postgres.query(
            `
            SELECT d.*, a."apiKey"
            FROM public."dokNuskaitytojai" d
            JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
            WHERE d.id = $1
            `,
            [nuskaitytojoId],
        );

        if (res.rows.length === 0) {
            throw new Error("Nėra nuskaitytojo su tokiu ID.");
        }

        nuskaitytojas = res.rows[0];
    } else {
        const res = await postgres.query(
            `
            SELECT d.*, a."apiKey"
            FROM public."dokNuskaitytojai" d
            JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
            ORDER BY RANDOM()
            LIMIT 1
            `,
        );

        if (res.rows.length === 0) {
            throw new Error("Nėra nuskaitytojų.");
        }

        nuskaitytojas = res.rows[0];
    }

    const fetchUrl = `${nuskaitytojas.url}/extract`;

    log(`Dokumentas ${url} nuskaitomas ${nuskaitytojas.pavadinimas}`);

    const body = {
        url,
        apiKey: nuskaitytojas.apiKey,
        extension,
    };

    try {
        const res = await postgres.query(
            `SELECT *
             FROM "failaiOcrRezultatai"
             WHERE failas = $1
             ORDER BY id DESC
             LIMIT 1`,
            [dokumentas.id],
        );

        if (res.rows.length > 0) {
            const latestEntry = res.rows[0];
            body.puslapiai = latestEntry.tekstas
                ? parsePgArray(latestEntry.tekstas)
                : [];
        }
    } catch (e) {
        console.error(e);
    }

    let response = await fetch(fetchUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body),
        timeout: 5 * 60 * 1000, // 5 minutes
    });

    // JSON response, if status is 200, return json (.result)
    if (response.status !== 200) {
        let text = await response.text();
        log(
            `Nuskaitytojo klaida: ${response.status} ${response.statusText} - ${text}`,
        );
        throw new Error(`Nuskaitytojo klaida: ${response.status} ${text}`);
    }

    let data = await response.json();

    if (!data.result) {
        throw new Error("Nuskaitytojo klaida: nėra rezultato.");
    }

    await postgres.query(
        `
      UPDATE public."dokNuskaitytojai"
      SET nuskaitytiDokumentai = nuskaitytiDokumentai + 1
      WHERE id = $1;
    `,
        [nuskaitytojas.id],
    );

    return data.result;
}

/**
 * Main function to read and process a single document from the bucket.
 * @param {number|null} nuskaitytojoId - Optional ID of a specific document reader to use.
 * @returns {Promise<boolean>} - Returns true if a document was processed, false otherwise.
 */
export async function nuskaitytiVienoDokumentoDuomenis(nuskaitytojoId = null) {
    let start = new Date();

    const result = await postgres.query(
            `WITH first AS (
        SELECT q.id FROM public."failaiNuskaitymoQueue" q
        WHERE q."lockedBy" IS NULL
        AND q.versija >= 0
        AND q.versija < $2
        ORDER BY q.versija ASC, q.id DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    ),
    second AS (
        SELECT q.id FROM public."failaiNuskaitymoQueue" q
        WHERE q."lockedBy" IS NULL
        AND q.versija < 0
        AND (
            (q.bandymai < 6   AND q."paskutinisBandymas" <= NOW() - interval '3 hours')
            OR (q.bandymai < 30  AND q."paskutinisBandymas" <= NOW() - interval '12 hours')
            OR q."paskutinisBandymas" <= NOW() - interval '1 day'
        ) 
        ORDER BY q.bandymai ASC, q.id DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    ),
    cte AS (
        SELECT id FROM first
        UNION ALL
        SELECT id FROM second
        LIMIT 1
    ),
    locked AS (
        UPDATE public."failaiNuskaitymoQueue" q
        SET "lockedBy" = $1, "lockedAt" = NOW()
        FROM cte WHERE q.id = cte.id
        RETURNING q.id
    )
    SELECT f.* FROM public.failai f
    WHERE f.id = (SELECT id FROM locked)`,
        [nodeName, nuskaitymoVersija],
    );


    if (!result.rows.length) return false;
    const dokumentas = result.rows[0];

    let url = `${config.internalFileBase}/${dokumentas.md5}`;
    let viesasUrl = `https://failai.viespirkiai.org/${dokumentas.md5}`;

    log(viesasUrl);

    try {
        let results = await nuskaitytiDokNuskaitytojuje(
            url,
            nuskaitytojoId,
            dokumentas.extension,
            dokumentas,
        );

        var tekstas = results.pages;
        var metadata = results.metadata;

        metadata = cleanMetadata(metadata);
    } catch (e) {
        let kodas = -1;
        if (e.message.includes("No password given")) {
            kodas = -2; // password protected
        } else if (
            e.message.includes("The PDF file is empty") ||
            dokumentas.dydis == 0
        ) {
            kodas = -4; // empty pdf
        }

        if (dokumentas && dokumentas.id) {
            try {
               await postgres.query(
                    `UPDATE public."failaiNuskaitymoQueue"
                    SET versija          = $2,
                        bandymai         = bandymai + 1,
                        "paskutinisBandymas" = NOW(),
                        "lockedBy"       = NULL,
                        "lockedAt"       = NULL
                    WHERE id = $1`,
                    [dokumentas.id, kodas],
                );
                // still update failai for the error code
                await postgres.query(
                    `UPDATE failai SET nuskaitytas = $1, "nuskaitymasTimestamp" = NOW() WHERE id = $2`,
                    [kodas, dokumentas.id],
                );
            } catch (updateErr) {
                console.error(
                    "Nepavyko pažymėti klaidingo nuskaitymo:",
                    updateErr,
                );
            }
        }

        if (kodas == -2 || kodas == -4) {
            return true; // Brokuotas dokumentas
        } else {
            throw e; // (Galimai) brokuotas nuskaitymas
        }
    }

    // Tekstas is a json array of pages, join to single string
    let sujungtasTekstas = (tekstas || []).join("");
    if (!metadata.wordCount) {
        metadata.wordCount = sujungtasTekstas
            .split(/\s+/)
            .filter(Boolean).length;
    }

    if (!metadata.characterCount) {
        metadata.characterCount = sujungtasTekstas.length;
    }

    let reikalingasOcr = dokumentas.ocrState; // Nereikalingas / nebūtinas
    if (
        metadata?.wordCount == 0 &&
        dokumentas.extension == "pdf" &&
        dokumentas.ocrState === null
    ) {
        reikalingasOcr = 0; // Rekomenduojamas
    }
    log(`${dokumentas.id} - ${dokumentas.ocrState} o ocr ${reikalingasOcr}`);

    if (
        ["zip", "7z", "rar", "adoc"].includes(dokumentas.extension) &&
        dokumentas.parent === null
    ) {
        let children = [];
        // Flatten metada.filesTree if it exists on children, do not add isDirectory=true, files that begin with . or _
        if (metadata.filesTree && Array.isArray(metadata.filesTree)) {
            const flattenFiles = (files) => {
                for (const file of files) {
                    if (file.isDirectory && Array.isArray(file.children)) {
                        flattenFiles(file.children);
                    } else {
                        if (
                            !file.name.startsWith(".") &&
                            !file.name.startsWith("_")
                        ) {
                            children.push({
                                pavadinimas: file.name,
                                extension: file.name.includes(".")
                                    ? file.name.split(".").pop().toLowerCase()
                                    : "",

                                dydis: file.size || 0,
                                md5: file.md5,
                                saltinioId: file.path,
                                parent: dokumentas.id,
                                parsiustas: -5, // Extracted, no need to download
                                saltinis: "archive",
                            });
                        }
                    }
                }
            };
            flattenFiles(metadata.filesTree);
        }

        // Insert into postgres
        for (const child of children) {
            // Check if file already exists
            const existsRes = await postgres.query(
            `SELECT id FROM failai WHERE "saltinioId" = $1 AND parent = $2 AND saltinis = 'archive'`,
            [child.saltinioId, child.parent],
            );

            // Only insert if it doesn't exist
            if (existsRes.rows.length === 0) {
            await postgres.query(
                `INSERT INTO failai (
                pavadinimas, extension, dydis, md5,
                "saltinioId", parent, parsiustas, saltinis
                ) VALUES (
                   $1, $2, $3, $4, $5, $6, $7, $8
                )
                ON CONFLICT ("saltinioId", parent) WHERE saltinis = 'archive' DO NOTHING;`,
                [
                child.pavadinimas,
                child.extension,
                child.dydis,
                child.md5,
                child.saltinioId,
                child.parent,
                child.parsiustas,
                child.saltinis,
                ],
            );
            }
        }
    }

    let client;
    try {
        client = await postgres.connect();
        await client.query("BEGIN");

        const docId = dokumentas.id;

        // Delete old entries
        await client.query(`DELETE FROM "failaiIban" WHERE id = $1`, [docId]);
        await client.query(`DELETE FROM "failaiJarKodai" WHERE id = $1`, [
            docId,
        ]);
        await client.query(`DELETE FROM "failaiLinks" WHERE id = $1`, [docId]);
        await client.query(`DELETE FROM "failaiEmails" WHERE id = $1`, [docId]);
        await client.query(`DELETE FROM "failaiDomains" WHERE id = $1`, [
            docId,
        ]);
        await client.query(`DELETE FROM "failaiTelefonai" WHERE id = $1`, [
            docId,
        ]);

        // helper: bulk insert (max 100 rows per call)
        async function bulkInsert({ table, columns, rows, client }) {
            if (!rows.length) return;

            const values = [];
            const placeholders = rows.map((row, i) => {
                const base = i * columns.length;
                columns.forEach((col) => values.push(row[col]));
                return `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`;
            });

            let quotedColumns = columns.map((col) => `"${col}"`).join(", ");

            await client.query(
                `INSERT INTO "${table}"(${quotedColumns}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
                values,
            );
        }

        // IBAN
        if (metadata?.ibanNumeriai?.length) {
            for (let i = 0; i < metadata.ibanNumeriai.length; i += 100) {
                await bulkInsert({
                    table: "failaiIban",
                    columns: ["id", "iban", "puslapiai"],
                    rows: metadata.ibanNumeriai.slice(i, i + 100).map((x) => ({
                        id: docId,
                        iban: x.numeris,
                        puslapiai: x.pages,
                    })),
                    client,
                });
            }
        }

        // JAR kodai
        if (metadata?.jarKodai?.length) {
            for (let i = 0; i < metadata.jarKodai.length; i += 100) {
                await bulkInsert({
                    table: "failaiJarKodai",
                    columns: ["id", "jarKodas", "puslapiai"],
                    rows: metadata.jarKodai.slice(i, i + 100).map((x) => ({
                        id: docId,
                        jarKodas: x.code,
                        puslapiai: x.pages,
                    })),
                    client,
                });
            }
        }

        // Links
        if (metadata?.links?.length) {
            for (let i = 0; i < metadata.links.length; i += 100) {
                await bulkInsert({
                    table: "failaiLinks",
                    columns: ["id", "link", "puslapiai"],
                    rows: metadata.links.slice(i, i + 100).map((x) => ({
                        id: docId,
                        link: x.uri?.slice(0, 1024),
                        puslapiai: x.pages,
                    })),
                    client,
                });
            }
        }

        // Emails
        if (metadata?.emails?.length) {
            for (let i = 0; i < metadata.emails.length; i += 100) {
                await bulkInsert({
                    table: "failaiEmails",
                    columns: ["id", "email", "puslapiai"],
                    rows: metadata.emails.slice(i, i + 100).map((x) => ({
                        id: docId,
                        email: x.email,
                        puslapiai: x.pages,
                    })),
                    client,
                });
            }
        }

        // Domains
        if (metadata?.domains?.length) {
            for (let i = 0; i < metadata.domains.length; i += 100) {
                await bulkInsert({
                    table: "failaiDomains",
                    columns: ["id", "domain"],
                    rows: metadata.domains.slice(i, i + 100).map((domain) => ({
                        id: docId,
                        domain,
                    })),
                    client,
                });
            }
        }

        // Telefonai
        if (metadata?.telefonai?.length) {
            for (let i = 0; i < metadata.telefonai.length; i += 100) {
                await bulkInsert({
                    table: "failaiTelefonai",
                    columns: ["id", "telefonas", "puslapiai"],
                    rows: metadata.telefonai.slice(i, i + 100).map((x) => ({
                        id: docId,
                        telefonas: x.numeris,
                        puslapiai: x.pages,
                    })),
                    client,
                });
            }
        }

        await client.query("COMMIT");
    } catch (e) {
        if (client) await client.query("ROLLBACK");
        throw e;
    } finally {
        if (client) client.release();
    }

    let location = null;

    if (
        metadata?.exif?.GPSLatitude?.description != null &&
        metadata?.exif?.GPSLongitude?.description != null
    ) {
        const lat = parseFloat(metadata.exif.GPSLatitude.description);
        const lon = parseFloat(metadata.exif.GPSLongitude.description);
        location = `POINT(${lon} ${lat})`; // WKT format
    }

    // Update the row
    await postgres.query(
        `UPDATE failai
        SET nuskaitytas = $1,
            metaduomenys = $2,
            "zodziuSkaicius" = $3,
            "puslapiuSkaicius" = $4,
            "simboliuSkaicius" = $5,
            "ocrState" = $6,
            location = ST_GeomFromText($7, 4326),
            "nuskaitymasTimestamp" = NOW()
        WHERE id = $8;`,
        [
            nuskaitymoVersija,
            metadata,
            metadata?.wordCount,
            metadata?.pageCount,
            metadata?.characterCount || 0,
            reikalingasOcr,
            location,
            dokumentas.id,
        ],
    );

    await postgres.query(
        `INSERT INTO "failaiTekstas" (id, tekstas, pavadinimas, extension, saltinis, "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius")
        SELECT $1, $2, pavadinimas, extension, saltinis, $3, $4, $5
        FROM failai
        WHERE id = $1
        ON CONFLICT (id) DO UPDATE SET
            tekstas            = EXCLUDED.tekstas,
            pavadinimas        = EXCLUDED.pavadinimas,
            extension          = EXCLUDED.extension,
            saltinis           = EXCLUDED.saltinis,
            "zodziuSkaicius"   = EXCLUDED."zodziuSkaicius",
            "puslapiuSkaicius" = EXCLUDED."puslapiuSkaicius",
            "simboliuSkaicius" = EXCLUDED."simboliuSkaicius";`,
        [
            dokumentas.id,
            truncateTo1MB(tekstas),
            metadata?.wordCount,
            metadata?.pageCount,
            metadata?.characterCount || 0,
        ],
    );

    await postgres.query(
        `INSERT INTO "failaiNuskaitymai"
            (failas, versija, metaduomenys, "timestamp", "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius", location)
         VALUES ($1, $2, $3, NOW() AT TIME ZONE 'Europe/Vilnius', $4, $5, $6, ST_GeomFromText($7, 4326))
         ON CONFLICT (failas, versija, "metaduomenysHash")
         DO UPDATE SET
            metaduomenys = EXCLUDED.metaduomenys,
            "timestamp" = EXCLUDED."timestamp",
            "zodziuSkaicius" = EXCLUDED."zodziuSkaicius",
            "puslapiuSkaicius" = EXCLUDED."puslapiuSkaicius",
            "simboliuSkaicius" = EXCLUDED."simboliuSkaicius",
             location = EXCLUDED.location;`,
        [
            dokumentas.id, // failas
            nuskaitymoVersija, // versija
            metadata, // metaduomenys
            metadata?.wordCount, // zodziuSkaicius
            metadata?.pageCount, // puslapiuSkaicius
            metadata?.characterCount || 0, // simboliuSkaicius
            location, // location
        ],
    );

    await postgres.query(
        `UPDATE public."failaiNuskaitymoQueue"
        SET versija    = $2,
            bandymai   = 0,
            "paskutinisBandymas" = NULL,
            "lockedBy" = NULL,
            "lockedAt" = NULL
        WHERE id = $1`,
        [dokumentas.id, nuskaitymoVersija],
    );


    log(
        `Nuskaitytas dokumentas ${dokumentas.id} / ${dokumentas.pavadinimas} per ${((new Date() - start) / 1000).toFixed(3)}s, ${metadata.wordCount} žodž.`,
    );

    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await nuskaitytiVienoDokumentoDuomenis();
}

/**
 * Truncates a JSON-serializable object to ensure its string representation does not exceed 1MB.
 * If truncation occurs, appends "..." to indicate the truncation.
 * @param {Object} obj - The object to be truncated.
 * @returns {string} - The JSON string representation of the object, truncated if necessary.
 */
function truncateTo1MB(obj) {
    const str = JSON.stringify(obj);
    const buf = Buffer.from(str, "utf8");

    if (buf.length > 1024 * 1024) {
        return buf.subarray(0, 1024 * 1024 - 3).toString("utf8") + "...";
    }
    return str;
}

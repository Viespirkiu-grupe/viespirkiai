import process from "process";
import { Buffer } from "buffer";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

/**
 * Cleans metadata object by removing null characters and trimming strings.
 * Recursively processes nested objects.
 * @param {Object} obj - The metadata object to clean.
 * @returns {Object} - The cleaned metadata object.
 */
function cleanMetadata(obj) {
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;

        const value = obj[key];
        if (typeof value === "string") {
            // Remove null chars and trim
            obj[key] = value.replace(/\u0000/g, "").trim();
        } else if (typeof value === "object" && value !== null) {
            // Recursively clean nested objects
            cleanMetadata(value);
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
) {
    if (nuskaitytojoId) {
        // Get a specific row from "dokNuskaitytojai"
        let nuskaitytojaiRes = await postgres.query(
            `SELECT *
             FROM "dokNuskaitytojai"
             WHERE id = $1;`,
            [nuskaitytojoId],
        );

        if (nuskaitytojaiRes.rows.length == 0) {
            throw new Error("Nėra nuskaitytojo su tokiu ID.");
        }

        var nuskaitytojas = nuskaitytojaiRes.rows[0];
    } else {
        let nuskaitytojaiRes = await postgres.query(
            `SELECT *
           FROM "dokNuskaitytojai"
           ORDER BY RANDOM()
           LIMIT 1;`,
        );

        if (nuskaitytojaiRes.rows.length == 0) {
            throw new Error("Nėra nuskaitytojų.");
        }

        var nuskaitytojas = nuskaitytojaiRes.rows[0];
    }

    // Fetch the given url GET ?url=url&apiKey=apiKey
    let fetchUrl = `${nuskaitytojas.url}/?url=${encodeURIComponent(url)}&apiKey=${encodeURIComponent(nuskaitytojas.apiKey)}&extension=${encodeURIComponent(extension)}`;
    log(`Dokumentas ${url} nuskaitomas ${nuskaitytojas.pavadinimas}`);
    let response = await fetch(fetchUrl, {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
        timeout: 5 * 60 * 1000, // 5 minutes
    });

    // JSON response, if status is 200, return json (.result)
    if (response.status !== 200) {
        let text = await response.text();
        throw new Error(
            `Nuskaitytojo klaida: ${response.status} ${response.statusText} - ${text}`,
        );
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

const REFILL_THRESHOLD = 5;
const BUCKET_SIZE = 1000;
const IN_PROGRESS_TIMEOUT = 10 * 60 * 1000; // 10 min

const nuskaitymoVersija = 5;

// In-memory tracking
let kibirelis = [];
const inProgress = new Map();
const bucketIds = new Set();
let filling = false;

/**
 * Fills the bucket with documents that need to be processed.
 * Ensures no duplicates and respects the bucket size limit.
 * @returns {Promise<void>}
 */
async function fillBucket() {
    if (filling) return;
    filling = true;

    try {
        const limit = BUCKET_SIZE - kibirelis.length;
        if (limit <= 0) return;

        const res = await postgres.query(
            `SELECT *
             FROM failai
             WHERE (nuskaitytas IS NULL OR nuskaitytas < $1)
               AND (nuskaitytas IS NULL OR nuskaitytas >= 0)
               AND parsiustas = 1
               AND extension IN ('pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt')
               ORDER BY nuskaitytas NULLS FIRST
             LIMIT $2`,
            [nuskaitymoVersija, limit * 2], // fetch extra to avoid duplicates
        );

        for (const row of res.rows) {
            if (!bucketIds.has(row.id) && !inProgress.has(row.id)) {
                kibirelis.push(row);
                bucketIds.add(row.id);
                if (kibirelis.length >= BUCKET_SIZE) break;
            }
        }
    } finally {
        filling = false;
    }
}

/**
 * Retrieves a document from the bucket for processing.
 * If the bucket is below the refill threshold, it triggers a refill.
 * Sets a timeout to return the document to the bucket if not processed in time.
 * @returns {Promise<Object|null>} - The document object or null if none available.
 */
async function getFromBucket() {
    if (kibirelis.length < REFILL_THRESHOLD) {
        fillBucket(); // async refill
    }

    const dokumentas = kibirelis.shift();
    if (!dokumentas) return null;

    bucketIds.delete(dokumentas.id);

    const timeout = setTimeout(() => {
        console.log(
            `Timeout: releasing dokumentas ${dokumentas.id} back to bucket`,
        );
        if (!bucketIds.has(dokumentas.id)) {
            kibirelis.push(dokumentas);
            bucketIds.add(dokumentas.id);
        }
        inProgress.delete(dokumentas.id);
    }, IN_PROGRESS_TIMEOUT);

    inProgress.set(dokumentas.id, timeout);

    return dokumentas;
}

/**
 * Marks a document as done processing, clearing its timeout.
 * @param {number} failasId - The ID of the document that has been processed.
 */
function doneWithFile(failasId) {
    const timeout = inProgress.get(failasId);
    if (timeout) {
        clearTimeout(timeout);
        inProgress.delete(failasId);
    }
}

/**
 * Main function to read and process a single document from the bucket.
 * @param {number|null} nuskaitytojoId - Optional ID of a specific document reader to use.
 * @returns {Promise<boolean>} - Returns true if a document was processed, false otherwise.
 */
export async function nuskaitytiVienoDokumentoDuomenis(nuskaitytojoId = null) {
    let start = new Date();

    const dokumentas = await getFromBucket();

    if (!dokumentas) {
        return false;
    }

    let url = `https://failai-direct.viespirkiai.top/${dokumentas.dokId}/${dokumentas.fileId}`;
    let viesasUrl = `https://failai.viespirkiai.top/${dokumentas.dokId}/${dokumentas.fileId}`;

    log(viesasUrl);

    try {
        let results = await nuskaitytiDokNuskaitytojuje(
            url,
            nuskaitytojoId,
            dokumentas.extension,
        );

        var tekstas = results.pages;
        var metadata = results.metadata;

        metadata = cleanMetadata(metadata);
    } catch (e) {
        console.error("Klaida nuskaitymo metu:", e);

        let kodas = -1;
        if (e.message.includes("No password given")) {
            kodas = -2; // password protected
        }

        if (dokumentas && dokumentas.id) {
            try {
                await postgres.query(
                    `UPDATE failai
                           SET nuskaitytas = $1
                           WHERE id = $2;`,
                    [kodas, dokumentas.id],
                );
                doneWithFile(dokumentas.id);
            } catch (updateErr) {
                console.error(
                    "Nepavyko pažymėti klaidingo nuskaitymo:",
                    updateErr,
                );
            }
        }

        throw e; // rethrow after marking failure
    }

    // Tekstas is a json array of pages, join to single string
    let sujungtasTekstas = tekstas.join("");
    if (!metadata.wordCount) {
        metadata.wordCount = sujungtasTekstas
            .split(/\s+/)
            .filter(Boolean).length;
    }

    if (!metadata.characterCount) {
        metadata.characterCount = sujungtasTekstas.length;
    }

    let reikalingasOcr = dokumentas.ocrState; // Nereikalingas
    if (
        metadata?.wordCount == 0 &&
        dokumentas.extension == "pdf" &&
        dokumentas.ocrState === null &&
        dokumentas.ocrText === null
    ) {
        reikalingasOcr = 0; // Reikalingas
    }
    log(`${dokumentas.id} - ${dokumentas.ocrState} o ocr ${reikalingasOcr}`);

    // Update the row
    await postgres.query(
        `UPDATE failai
        SET nuskaitytas = $1,
            tekstas = $2,
            metaduomenys = $3,
            "zodziuSkaicius" = $4,
            "puslapiuSkaicius" = $5,
            "jarKodai" = $6,
            "ibanNumeriai" = $7,
            links = $8,
            emails = $9,
            domains = $10,
            telefonai = $11,
            "hasSloppyRedactions" = $12,
            "simboliuSkaicius" = $13,
            "ocrState" = $14
        WHERE id = $15;`,
        [
            nuskaitymoVersija,
            truncateTo1MB(tekstas),
            metadata,
            metadata?.wordCount,
            metadata?.pageCount,

            metadata?.jarKodai?.map((o) => o.code) || [],
            metadata?.ibanNumeriai?.map((o) => o.iban) || [],
            metadata?.links?.map((o) => o.uri) || [],
            metadata?.emails?.map((o) => o.email) || [],
            metadata?.domains || [],
            metadata?.telefonai?.map((o) => o.phone) || [],
            metadata?.sloppyRedactions?.length > 0 || false,
            metadata?.characterCount || 0,
            reikalingasOcr,
            dokumentas.id,
        ],
    );

    doneWithFile(dokumentas.id);

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

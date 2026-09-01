import process from "process";
import { Buffer } from "buffer";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import Timings from "../../utils/timings.js";
import { readRezultatasFs } from "../ocr/rezultataiFs.js";
import { prepareFailaiFs, savePreparedFailaiFs } from "./failaiFs.js";
import {
    iEile,
    paimtiNuskaitymui,
    pazymetiNuskaitymoBandyma,
    NUSKAITYMO_VERSIJA,
} from "./nuskaitymoEile.js";
import { irasytiFailus } from "./failuIrasymas.js";
import {
    pazymetiNuskaityta,
    pazymetiNuskaitymoKlaida,
} from "./nuskaitymoRezultatas.js";
import { matmenys } from "./photosLentele.js";

const nodeName = process.env.NODE_NAME || "default";
const nuskaitymoVersija = NUSKAITYMO_VERSIJA;

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
    timings,
) {
    let nuskaitytojas;

    timings.start("nuskaitytojas");
    if (nuskaitytojoId) {
        const res = await postgres.query(
            `
            SELECT d.*, a."apiKey"
            FROM public."dokNuskaitytojai" d
            JOIN auth."raktai" a ON a.id = d."apiRaktasId"
            WHERE d.id = $1
            AND d.enabled = true
            `,
            [nuskaitytojoId],
        );

        if (res.rows.length === 0) {
            throw new Error("Nėra įjungto nuskaitytojo su tokiu ID.");
        }

        nuskaitytojas = res.rows[0];
    } else {
        const res = await postgres.query(
            `
            SELECT d.*, a."apiKey"
            FROM public."dokNuskaitytojai" d
            JOIN auth."raktai" a ON a.id = d."apiRaktasId"
            WHERE d.enabled = true
            ORDER BY RANDOM()
            LIMIT 1
            `,
        );

        if (res.rows.length === 0) {
            throw new Error("Nėra nuskaitytojų.");
        }

        nuskaitytojas = res.rows[0];
    }
    timings.end("nuskaitytojas");

    const fetchUrl = `${nuskaitytojas.url}/extract`;

    if (nuskaitytojas.fileHost) {
        url = `${nuskaitytojas.fileHost}/${dokumentas.md5}`;
    }

    logger.log(`Dokumentas ${url} nuskaitomas ${nuskaitytojas.pavadinimas}`);

    const body = {
        url,
        extension,
    };

    // Jei failas jau OCR'intas, jo tekstą paduodam nuskaitytojui. Rodyklę į FS
    // rezultatą laiko filesOcrStatus."resultHash".
    timings.start("ocrRezultatai");
    try {
        const res = await postgres.query(
            `SELECT "resultHash" FROM public."filesOcrStatus"
             WHERE id = $1 AND "resultHash" IS NOT NULL`,
            [dokumentas.id],
        );

        if (res.rows.length > 0) {
            const rezultatas = await readRezultatasFs(res.rows[0].resultHash);
            body.puslapiai = Array.isArray(rezultatas?.tekstas) ? rezultatas.tekstas : [];
        }
    } catch (e) {
        console.error(e);
    }
    timings.end("ocrRezultatai");

    timings.start("fetch");
    let response = await fetch(fetchUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${nuskaitytojas.apiKey}`,
        },
        body: JSON.stringify(body),
        timeout: 5 * 60 * 1000, // 5 minutes
    });

    // JSON response, if status is 200, return json (.result)
    if (response.status !== 200) {
        let text = await response.text();
        logger.log(
            `Nuskaitytojo klaida: ${response.status} ${response.statusText} - ${text}`,
        );
        throw new Error(`Nuskaitytojo klaida: ${response.status} ${text}`);
    }

    let data = await response.json();
    timings.end("fetch");

    if (!data.result) {
        throw new Error("Nuskaitytojo klaida: nėra rezultato.");
    }

    // Kuris nuskaitytojas apdorojo — įrašoma į filesDataExtraction."nodeId".
    data.result.nuskaitytojoId = nuskaitytojas.id;

    timings.start("nuskaitytojaUpdate");
    await postgres.query(
        `
      UPDATE public."dokNuskaitytojai"
      SET nuskaitytiDokumentai = nuskaitytiDokumentai + 1
      WHERE id = $1;
    `,
        [nuskaitytojas.id],
    );
    timings.end("nuskaitytojaUpdate");

    return data.result;
}

/**
 * Main function to read and process a single document from the bucket.
 * @param {number|null} nuskaitytojoId - Optional ID of a specific document reader to use.
 * @param {number|null} failasId - Optional file ID to process directly from queue.
 * @returns {Promise<boolean>} - Returns true if a document was processed, false otherwise.
 */
export async function nuskaitytiVienoDokumentoDuomenis(
    nuskaitytojoId = null,
    failasId = null,
) {
    const timings = new Timings();

    timings.start("queue");
    // Migracijos metu imama iš abiejų eilių — pirmenybė senajai (žr. nuskaitymoEile.js)
    const dokumentas = await paimtiNuskaitymui(nodeName, failasId);
    timings.end("queue");
    if (!dokumentas) return false;

    let url = `${config.internalFileBase}/${dokumentas.md5}`;
    let viesasUrl = `https://failai.viespirkiai.org/${dokumentas.md5}`;

    logger.log(viesasUrl);

    let results;
    let tekstas, metadata, wordCount, characterCount, pageCount;
    timings.start("nuskaitymas");
    try {
        results = await nuskaitytiDokNuskaitytojuje(
            url,
            nuskaitytojoId,
            dokumentas.extension,
            dokumentas,
            timings,
        );

        tekstas = results.pages;
        metadata = results.metadata;
        wordCount = results.wordCount ?? 0;
        characterCount = results.characterCount ?? 0;
        pageCount = results.pageCount;

        metadata = cleanMetadata(metadata);
        timings.end("nuskaitymas");

    } catch (e) {
        let kodas = -1;
        if (e.message.includes("No password given")) {
            kodas = -2; // password protected
        } else if (
            e.message.includes("The PDF file is empty") ||
            dokumentas.dydis == 0
        ) {
            kodas = -4; // empty pdf
        } else if (
            e.message.includes("Not Found")
        ) {
            kodas = -404; // not found
        }

        if (dokumentas && dokumentas.id) {
            try {
                // Klaidos kodas — į abi schemas; eilėse tik bandymų skaitiklis su
                // eksponentiniu atidėjimu, o viršijus ribą eilutė pašalinama.
                await pazymetiNuskaitymoKlaida(dokumentas.id, kodas);
                await pazymetiNuskaitymoBandyma(dokumentas.id);
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

    let reikalingasOcr = dokumentas.ocrState; // Nereikalingas / nebūtinas
    if (
        wordCount == 0 &&
        dokumentas.extension == "pdf" &&
        dokumentas.ocrState === null
    ) {
        reikalingasOcr = 0; // Rekomenduojamas
    }
    logger.log(`${dokumentas.id} - ${dokumentas.ocrState} o ocr ${reikalingasOcr}`);

    timings.start("archyvas");
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

        // Dublikatai praleidžiami; rašoma į abi schemas (failai + files).
        if (children.length) {
            const nauji = await irasytiFailus(children);

            // Išskleisti failai iš karto tampa nuskaitomi
            await iEile(nauji);
        }
    }

    timings.end("archyvas");

    // Išgauti subjektai — saugomi sujungtame failo turinio faile (žr. žemiau),
    // ne atskirose DB lentelėse. Šablonai atitinka fetchFailasMetadata grąžinamą formą.
    const iban = (results.ibans ?? []).map((x) => ({
        iban: x.iban,
        puslapiai: x.pages,
    }));
    const jarKodai = (results.companyIds ?? []).map((x) => ({
        jarKodas: x.code,
        puslapiai: x.pages,
    }));
    const links = (results.links ?? []).map((x) => ({
        link: x.uri?.slice(0, 1024),
        puslapiai: x.pages,
    }));
    const emails = (results.emails ?? []).map((x) => ({
        email: x.email,
        puslapiai: x.pages,
    }));
    const domains = results.domains ?? [];
    const telefonai = (results.phones ?? []).map((x) => ({
        telefonas: x.phone,
        puslapiai: x.pages,
    }));

    let location = null;

    if (
        metadata?.location?.latitude != null &&
        metadata?.location?.longitude != null
    ) {
        const lat = metadata.location.latitude;
        const lon = metadata.location.longitude;
        location = `POINT(${lon} ${lat})`; // WKT format
    }

    let autorius = metadata?.author || undefined;

    // tekstas išsaugomas kaip tekstinė reikšmė (tokia pati kaip senasis tekstasFs
    // turinys), kad skaitymo kelias galėtų JSON.parse arba naudoti kaip stringą.
    const tekstasStr = truncateTo1MB(tekstas);

    // Sujungtas failo turinys — tekstas + metaduomenys + išgauti subjektai.
    const failaiTurinys = {
        tekstas: tekstasStr,
        metaduomenys: metadata,
        iban,
        jarKodai,
        links,
        emails,
        domains,
        telefonai,
    };
    const { hash: failasHash, json: failaiJson } = prepareFailaiFs(failaiTurinys);

    timings.start("failaiFs");
    await savePreparedFailaiFs(failasHash, failaiJson);
    timings.end("failaiFs");

    // Rezultatas rašomas į abi schemas ir failas išimamas iš abiejų eilių.
    timings.start("failaiUpdate");
    await pazymetiNuskaityta({
        id: dokumentas.id,
        versija: nuskaitymoVersija,
        wordCount,
        pageCount,
        characterCount,
        ocrState: reikalingasOcr,
        location,
        autorius,
        failasHash,
        nodeId: results.nuskaitytojoId ?? nuskaitytojoId ?? null,
        dydis: matmenys(metadata),
    });
    timings.end("failaiUpdate");

    const timingParts = [
        "queue", "nuskaitytojas", "ocrRezultatai", "fetch", "nuskaitytojaUpdate",
        "nuskaitymas", "archyvas", "failaiFs", "failaiUpdate", "all",
    ].map((k) => `${k}=${timings.humanDuration(k)}`).join(" ");
    logger.log(
        `Nuskaitytas dokumentas ${dokumentas.id} / ${dokumentas.pavadinimas}, ${wordCount} žodž. | ${timingParts}`,
    );

    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);

    if (args.length === 1) {
        const failasId = Number(args[0]);
        if (!Number.isInteger(failasId) || failasId <= 0) {
            throw new Error("CLI argument must be a positive integer file ID.");
        }
        await nuskaitytiVienoDokumentoDuomenis(null, failasId);
    } else {
        await nuskaitytiVienoDokumentoDuomenis();
    }
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

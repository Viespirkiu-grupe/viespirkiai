import { Buffer } from "buffer";
import { postgres, parsePgArray } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { readRezultatasFs } from "../ocr/rezultataiFs.js";
import { readFailaiFs } from "./failaiFs.js";
import { parseWKBPoint } from "../geografija/utils.js";
import { formatDateTime, formatDuration } from "../../utils/time.js";

const libreFormats = new Set(["doc","docx","odt","rtf","xls","xlsx","xlsb","ods","ppt","pptx","ppsx","odp","odg","pub","pages","xlt","dot","docm","dotx"]);
const imageFormats = new Set(["jpg","jpeg","png","bmp","gif","tif","tiff","jfif","heic","webp"]);
const archiveFormats = new Set(["zip","7z","rar","adoc"]);

const ocrStateTextMap = {
    "1": "Baigta",
    "0": "Rekomenduojama",
    "-1": "Nepavyko",
    "-3": "Rezervuota",
    "-6": "Viršijo bandymus",
};

function computeOriginalusLinkas(failas) {
    if (failas.saltinis === "sutartys" || !failas.saltinis) {
        return {
            linkas: `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dokId}&file_id=${failas.fileId}`,
            pavadinimas: "CVP IS",
        };
    }
    if (failas.saltinis === "neskelbiamosDerybos") {
        return { linkas: `https://eviesiejipirkimai.lt/${failas.saltinioId}`, pavadinimas: "CVP IS" };
    }
    if (failas.saltinis === "archive") {
        return { linkas: `/failas/${failas.parent}`, pavadinimas: "Archyvas" };
    }
    if (failas.saltinis === "mvpAprasai") {
        return {
            linkas: `https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_paieska.asp?&Itemid=112`,
            pavadinimas: "VPM IS",
        };
    }
    if (failas.saltinis === "cvpIs") {
        const parts = failas.saltinioId.split("/");
        return {
            linkas: `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${parts[2]}&documentId=${parts[1]}`,
            pavadinimas: "CVP IS",
        };
    }
    if (failas.saltinis === "cvpp") {
        const parts = String(failas.saltinioId || "").split("/").filter(Boolean);
        const pid = parts.length >= 3 ? parts[0] : null;
        return {
            linkas: pid
                ? `https://pirkimai.eviesiejipirkimai.lt/app/rfq/rwlentrance_s.asp?PID=${encodeURIComponent(pid)}&B=PPO`
                : `https://cvpp.eviesiejipirkimai.lt`,
            pavadinimas: "CVPP",
        };
    }
    return { linkas: null, pavadinimas: null };
}

function computeSaltinioLinkas(failas) {
    if (failas.saltinis === "sutartys" || !failas.saltinis) return `/sutartis/${failas.dokId}`;
    if (failas.saltinis === "neskelbiamosDerybos") return `/neskelbiamos`;
    if (failas.saltinis === "archive") return `/failas/${failas.parent}`;
    if (failas.saltinis === "mvpAprasai") return `https://mw.eviesiejipirkimai.lt/vpm/SVPTS/svpts_paieska.asp?&Itemid=112`;
    if (failas.saltinis === "cvpIs") return `/viesiejiPirkimai/${failas.saltinioId?.split("/")[0]}`;
    if (failas.saltinis === "cvpp") return failas.originalusLinkas;
    return null;
}

function computeSaltinioLinkoPavadinimas(failas) {
    if (failas.saltinis === "sutartys" || !failas.saltinis) return `Sutartis ${failas.dokId}`;
    if (failas.saltinis === "neskelbiamosDerybos") return `Neskelbiamos derybos`;
    if (failas.saltinis === "archive") return `Archyvas ${failas.parent}`;
    if (failas.saltinis === "mvpAprasai") return `MVP tvarkos aprašai`;
    if (failas.saltinis === "cvpIs") return `Viešasis pirkimas ${failas.saltinioId?.split("/")[0]}`;
    if (failas.saltinis === "cvpp") return `CVPP viešasis pirkimas`;
    return null;
}

function computePreviewType(failas) {
    const ext = failas.extension;
    if (ext === "pdf" || ext === "prn" || libreFormats.has(ext)) return "pdf";
    if (archiveFormats.has(ext) && failas.metaduomenys?.filesTree) return "archive";
    if (ext === "mp4") return "mp4";
    if (ext === "mp3") return "mp3";
    if (imageFormats.has(ext)) return "image";
    if (ext === "url") return "url";
    if (ext === "txt") return "txt";
    if (ext === "fax" && failas.md5 === "e083b15bc91cd24583955d3493347f7a") return "fax-special";
    if (["html", "htm", "svg"].includes(ext)) return "html";
    if ((ext === "eml" || ext === "msg") && failas.metaduomenys) return "email";
    return "none";
}

function normalizeTekstasPerziurai(tekstas) {
    let result = "";
    if (Array.isArray(tekstas)) {
        result = tekstas.map((p) => String(p ?? "")).join("");
    } else if (typeof tekstas === "string") {
        result = tekstas;
        try {
            const pages = JSON.parse(result);
            if (Array.isArray(pages)) result = pages.map((p) => String(p ?? "")).join("");
        } catch (_) {}
    } else if (tekstas != null) {
        result = String(tekstas);
    }
    return result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Decodes a quoted-printable encoded attachment name.
 * @param {string} name - The encoded attachment name.
 * @returns {string} The decoded attachment name.
 */
function decodeQPAttachmentName(name) {
    if (!/=\?UTF-8\?Q\?.+\?=/i.test(name)) return name;
    return name.replace(/=\?UTF-8\?Q\?(.+?)\?=/i, (_, encoded) => {
        const qp = encoded.replace(/_/g, " ");
        const bytes = qp.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
        );
        return Buffer.from(bytes, "binary").toString("utf8");
    });
}

/**
 * Enriches the metadata files and files tree with corresponding IDs from related files.
 * @param {Object} metaduomenys - The metadata object containing files and filesTree.
 * @param {Array} relatedFiles - An array of related file objects with id and saltinioId.
 */
function enrichFilesWithIds(metaduomenys, relatedFiles) {
    metaduomenys.files = metaduomenys.files.map((file) => {
        if (file.path) {
            const match = relatedFiles.find((f) => f.saltinioId === file.path);
            if (match) {
                file.id = match.id;
                if (match.extension) file.extension = match.extension;
            }
        }
        return file;
    });

    function enrichNode(node) {
        if (node.path) {
            const match = metaduomenys.files.find((f) => f.path === node.path);
            if (match) {
                node.id = match.id;
                if (match.extension) node.extension = match.extension;
            }
        }
        node.children?.forEach(enrichNode);
    }

    metaduomenys.filesTree?.forEach(enrichNode);
}

/** Resolves related files for a given file and enriches the metadata with their IDs.
 * @param {Object} failas - The file object containing metadata with related files.
 */
async function resolveRelatedFiles(failas) {
    if (!failas?.metaduomenys?.files) return;

    const paths = failas.metaduomenys.files.map((f) => f.path).filter(Boolean);
    if (!paths.length) return;

    // Archyvo vaikų kelias archyve yra sourceId0 (žr. files_child_uniq).
    const result = await postgres.query(
        `SELECT f.id, f."sourceId0" AS "saltinioId", e.extension
         FROM files.files f
         LEFT JOIN files."extensions" e ON e.id = f."extensionId"
         WHERE f.parent = $1 AND f."sourceId0" = ANY($2)`,
        [failas.id, paths],
    );

    enrichFilesWithIds(failas.metaduomenys, result.rows);
}

/** Fetches metadata for a given file ID, including IBANs, JAR codes, links, emails, domains, phone numbers, and other metadata.
 * @param {number} id - The ID of the file for which to fetch metadata.
 * @returns {Promise<Object>} An object containing the fetched metadata categorized by type.
 */
/**
 * Konvertuoja saugomą tekstą (JSON masyvas, pg masyvas arba paprastas stringas)
 * į skaitymo formą — tokia pati logika kaip senajame tekstasFs kelyje.
 */
function parseTekstas(tekstasRaw) {
    if (!tekstasRaw) return null;
    if (Array.isArray(tekstasRaw)) return tekstasRaw;
    if (typeof tekstasRaw !== "string") return tekstasRaw;
    try {
        const parsed = JSON.parse(tekstasRaw);
        return Array.isArray(parsed) ? parsed : tekstasRaw;
    } catch {
        return tekstasRaw.startsWith("{") && tekstasRaw.endsWith("}")
            ? parsePgArray(tekstasRaw)
            : tekstasRaw;
    }
}

/**
 * Grąžina failo išvestinius duomenis (subjektai, metaduomenys, tekstas, OCR).
 * Turinys skaitomas iš sujungto FS failo (failasHash).
 * @param {number} id
 * @param {Object|null} failas - failo eilutė su failasHash (nebūtina).
 */
export async function fetchFailasMetadata(id, failas = null) {
    let failasHash = failas?.failasHash;

    // failasHash gyvena atskiroje files."infoFiles" lentelėje. Jei jo dar neturime,
    // pasiimame jį atskira užklausa.
    if (failasHash === undefined) {
        const r = await postgres.query(
            `SELECT i."fileHash" AS "failasHash"
             FROM files.files f
             LEFT JOIN files."infoFiles" i ON i.id = f.id
             WHERE f.id = $1`,
            [id],
        );
        if (r.rows.length) {
            failasHash = r.rows[0].failasHash;
        }
    }

    // Naujoje schemoje OCR rezultatų istorijos nėra — laikomas tik paskutinis
    // rezultatas (files."ocrStatus") ir bendras jų skaičius (resultsCount).
    // Puslapių ir žodžių skaičiai — iš po OCR atlikto nuskaitymo, nes būtent jis
    // suskaičiuoja OCR gautą tekstą.
    const ocrRes = await postgres.query(
        `SELECT o."resultHash", o."resultsCount", o.duration, o."ocrTimestamp",
                o."lockTimestamp", n.pavadinimas AS node,
                d."pageCount", d."wordCount"
         FROM files."ocrStatus" o
         LEFT JOIN infra."ocrNuskaitytojai" n ON n.id = o."nodeId"
         LEFT JOIN files."dataExtraction" d ON d.id = o.id
         WHERE o.id = $1`,
        [id],
    );
    const ocrRow = ocrRes.rows[0] ?? null;

    const latestOcrResult = ocrRow?.resultHash
        ? {
              id: null,
              node: ocrRow.node,
              lockTimestamp: ocrRow.lockTimestamp,
              submitTimestamp: ocrRow.ocrTimestamp,
              duration: ocrRow.duration,
              puslapiuSkaicius: ocrRow.pageCount,
              zodziuSkaicius: ocrRow.wordCount,
          }
        : null;

    const latestOcrFile = ocrRow?.resultHash
        ? await readRezultatasFs(ocrRow.resultHash)
        : null;
    const ocr = Array.isArray(latestOcrFile?.tekstas) ? latestOcrFile.tekstas : [];

    const ocrMeta = {
        ocrLatestResult: latestOcrResult,
        ocrRezultatuSkaicius: ocrRow?.resultsCount ?? 0,
        ocr,
    };

    const turinys = await readFailaiFs(failasHash);

    return {
        ibanNumeriai: turinys?.iban ?? [],
        jarKodai: turinys?.jarKodai ?? [],
        links: turinys?.links ?? [],
        emails: turinys?.emails ?? [],
        domains: turinys?.domains ?? [],
        telefonai: turinys?.telefonai ?? [],
        metaduomenys: turinys?.metaduomenys ?? null,
        tekstas: parseTekstas(turinys?.tekstas),
        ...ocrMeta,
    };
}

/**
 * Handles the request to serve a file's details page, including fetching and processing its metadata, and rendering the appropriate view or returning JSON.
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The Express next middleware function.
 * @param {Object} failas - The file object for which to serve the details page.
 * @param {boolean} [requestsJson=false] - Whether to return the file details as JSON instead of rendering a view.
 */
export async function aptarnautiFailą(
    req,
    res,
    failas,
    requestsJson = false,
) {
    const metadata = await fetchFailasMetadata(failas.id, failas);
    failas = { ...failas, ...metadata };

    failas.metaduomenys?.signatures?.forEach((sig) => {
        if (sig.signerFullDistinguishedName)
            sig.signerFullDistinguishedName =
                sig.signerFullDistinguishedName.replace(/\d{4,}/g, "");
    });

    failas.metaduomenys?.attachments?.forEach((attachment) => {
        attachment.name = decodeQPAttachmentName(attachment.name);
    });

    if (failas.location) {
        failas.location = parseWKBPoint(failas.location);
    }

    await resolveRelatedFiles(failas);

    if (requestsJson) return res.json(failas);

    failas.extension = (failas.extension || "").toLowerCase();

    const { linkas, pavadinimas } = computeOriginalusLinkas(failas);
    failas.originalusLinkas = linkas;
    failas.originalusLinkasPavadinimas = pavadinimas;

    failas.saltinioLinkas = computeSaltinioLinkas(failas);
    failas.saltinioLinkoPavadinimas = computeSaltinioLinkoPavadinimas(failas);

    const ocrStateKey = failas.ocrState === null || failas.ocrState === undefined
        ? null
        : String(failas.ocrState);
    failas.ocrStateKey = ocrStateKey;
    failas.ocrStateText = ocrStateKey && ocrStateTextMap[ocrStateKey]
        ? ocrStateTextMap[ocrStateKey]
        : "Nežinoma";
    failas.hasOcrSection = ocrStateKey !== null || !!failas.ocrLatestResult;

    failas.previewType = computePreviewType(failas);
    failas.isLibreFormat = libreFormats.has(failas.extension);

    if (failas.previewType === "txt") {
        failas.tekstasPerziurai = normalizeTekstasPerziurai(failas.tekstas);
    }

    res.render("failai/failas", {
        customHead: config.customHead,
        failas,
        query: req.query,
        formatDateTime,
        formatDuration,
    });
}

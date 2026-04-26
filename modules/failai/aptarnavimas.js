import { Buffer } from "buffer";
import { postgres, parsePgArray } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { parseWKBPoint } from "../geografija/utils.js";

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

    const result = await postgres.query(
        `SELECT * FROM failai WHERE parent = $1 AND "saltinioId" = ANY($2)`,
        [failas.id, paths],
    );

    enrichFilesWithIds(failas.metaduomenys, result.rows);
}

/** Fetches metadata for a given file ID, including IBANs, JAR codes, links, emails, domains, phone numbers, and other metadata.
 * @param {number} id - The ID of the file for which to fetch metadata.
 * @returns {Promise<Object>} An object containing the fetched metadata categorized by type.
 */
export async function fetchFailasMetadata(id) {
    const [iban, jarKodai, links, emails, domains, telefonai, metaduomenys, tekstas, ocrResults] =
        await Promise.all([
            postgres.query(
                `SELECT iban, puslapiai FROM "failaiIban"
                 WHERE id = $1 ORDER BY COALESCE(puslapiai[1], 9999), iban ASC`,
                [id],
            ),
            postgres.query(
                `SELECT "jarKodas", puslapiai FROM "failaiJarKodai"
                 WHERE id = $1 ORDER BY COALESCE(puslapiai[1], 9999), "jarKodas" ASC`,
                [id],
            ),
            postgres.query(
                `SELECT link, puslapiai FROM "failaiLinks"
                 WHERE id = $1 ORDER BY COALESCE(puslapiai[1], 9999), link ASC`,
                [id],
            ),
            postgres.query(
                `SELECT email, puslapiai FROM "failaiEmails"
                 WHERE id = $1 ORDER BY COALESCE(puslapiai[1], 9999), email ASC`,
                [id],
            ),
            postgres.query(
                `SELECT domain FROM "failaiDomains"
                 WHERE id = $1 ORDER BY domain ASC`,
                [id],
            ),
            postgres.query(
                `SELECT telefonas, puslapiai FROM "failaiTelefonai"
                 WHERE id = $1 ORDER BY COALESCE(puslapiai[1], 9999), telefonas ASC`,
                [id],
            ),
            postgres.query(
                `SELECT metaduomenys FROM "failaiNuskaitymai"
                 WHERE failas = $1 ORDER BY id DESC LIMIT 1`,
                [id],
            ),
            postgres.query(
                `SELECT tekstas FROM "failaiTekstas" WHERE id = $1 LIMIT 1`, // Should only be one row, but just in case, we take the first one
                [id],
            ),
            postgres.query(
                `SELECT id, tekstas, node, "lockTimestamp", "submitTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius"
                 FROM "failaiOcrRezultatai"
                 WHERE failas = $1
                 ORDER BY id DESC`,
                [id],
            ),
        ]);

    const latestOcrResult = ocrResults.rows.length
        ? {
              id: ocrResults.rows[0].id,
              node: ocrResults.rows[0].node,
              lockTimestamp: ocrResults.rows[0].lockTimestamp,
              submitTimestamp: ocrResults.rows[0].submitTimestamp,
              duration: ocrResults.rows[0].duration,
              puslapiuSkaicius: ocrResults.rows[0].puslapiuSkaicius,
              zodziuSkaicius: ocrResults.rows[0].zodziuSkaicius,
          }
        : null;

    const ocr =
        ocrResults.rows.length && ocrResults.rows[0].tekstas
            ? parsePgArray(ocrResults.rows[0].tekstas)
            : [];

    if (tekstas.rows.length) {
        tekstas.rows[0].tekstas = parsePgArray(tekstas.rows[0].tekstas);
    }

    return {
        ibanNumeriai: iban.rows,
        jarKodai: jarKodai.rows,
        links: links.rows,
        emails: emails.rows,
        domains: domains.rows.map((r) => r.domain),
        telefonai: telefonai.rows,
        metaduomenys: metaduomenys.rows.length
            ? metaduomenys.rows[0].metaduomenys
            : null,
        tekstas: tekstas.rows.length ? tekstas.rows[0].tekstas : null,
        ocrLatestResult: latestOcrResult,
        ocrRezultatuSkaicius: ocrResults.rows.length,
        ocr,
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
    next,
    failas,
    requestsJson = false,
) {
    const metadata = await fetchFailasMetadata(failas.id);
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

    res.render("failai/failas", {
        customHead: config.customHead,
        failas,
        query: req.query,
    });
}

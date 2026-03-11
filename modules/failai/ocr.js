import { postgres } from "../../postgres/postgres.js";

const OCR_IMAGE_EXTS = [
    "pdf",
    "jpg",
    "jpeg",
    "png",
    "bmp",
    "gif",
    "odg",
    "webp",
    "heic",
];
const OCR_DOC_EXTS = [
    "pub",
    "doc",
    "odt",
    "docm",
    "rtf",
    "pptx",
    "odg",
    "ppt",
    "dotx",
    "pages",
    "ppsx",
    "docx",
];

function checkoutQuery(extraWhere = "") {
    return `
        WITH cte AS (
            SELECT id FROM failai
            WHERE ("ocrState" IS NULL OR "ocrState" = 0)
              AND COALESCE("ocrBandymai", 0) < 3
              ${extraWhere}
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE failai
        SET "ocrState" = -3,
            "ocrNode" = $1,
            "ocrLockTimestamp" = (NOW() AT TIME ZONE 'Europe/Vilnius')
        WHERE id IN (SELECT id FROM cte)
        RETURNING *`;
}

export async function checkoutNextFile(nodeName, version) {
    const inExts = (exts) =>
        `AND "nuskaitytas" >= 6 AND LOWER("extension") IN (${exts.map((e) => `'${e}'`).join(",")})`;

    // Priority 1: any pending file with no extension filter
    let result = await postgres.query(checkoutQuery(`AND "ocrState" = 0`), [
        nodeName,
    ]);
    if (result.rows.length) return result.rows[0];

    // Priority 2 (v1+v2): image/PDF formats
    if (version >= 1) {
        result = await postgres.query(checkoutQuery(inExts(OCR_IMAGE_EXTS)), [
            nodeName,
        ]);
        if (result.rows.length) return result.rows[0];
    }

    // Priority 3: document formats
    result = await postgres.query(checkoutQuery(inExts(OCR_DOC_EXTS)), [
        nodeName,
    ]);
    return result.rows[0] ?? null;
}

export function buildFileUri(failas) {
    const needsConversion =
        !failas.extension || failas.extension.toLowerCase() !== "pdf";
    const qs = needsConversion ? "?convertTo=pdf" : "";
    return `/${failas.md5}${qs}`;
}

import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";

export const OCR_BANDYMAI = config.ocrBandymai || 5;
export const OCR_STATES = [
    { id: 1, camel: "baigta", text: "Baigta" },
    { id: 0, camel: "rekomenduojama", text: "Rekomenduojama" },
    { id: -1, camel: "nepavyko", text: "Nepavyko" },
    { id: -3, camel: "rezervuota", text: "Rezervuota" },
    { id: -6, camel: "virsijoBandymus", text: "Viršijo bandymus" },
    { id: null, camel: "galima", text: "Galima" },
    { id: null, camel: "nepalaikoma", text: "Nepalaikoma" },
];

export const OCR_IMAGE_EXTS = [
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

export const OCR_DOC_EXTS = [
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

export async function checkoutNextFile(nodeName) {
    const result = await postgres.query(
        `WITH cte AS (
            SELECT q.id FROM public."failaiOcrQueue" q
            WHERE q."lockedBy" IS NULL
              AND q.bandymai < $2
            ORDER BY q.priority, q.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE public."failaiOcrQueue" q
            SET "lockedBy" = $1,
                "lockedAt" = NOW()
            FROM cte
            WHERE q.id = cte.id
            RETURNING q.id
        )
        UPDATE public.failai
        SET "ocrState" = -3,
            "ocrNode" = $1,
            "ocrLockTimestamp" = NOW() AT TIME ZONE 'Europe/Vilnius'
            WHERE id = (SELECT id FROM locked)
        RETURNING *`,
        [nodeName, OCR_BANDYMAI],
    );

    if (!result.rows.length) {
        return null;
    }

    const failas = result.rows[0];
    return failas;
}

export function buildFileUri(failas) {
    const needsConversion =
        !failas.extension || failas.extension.toLowerCase() !== "pdf";
    const qs = needsConversion ? "?convertTo=pdf" : "";
    return `/${failas.md5}${qs}`;
}

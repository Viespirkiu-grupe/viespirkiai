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

/**
 * Rezervuoja kitą failą OCR'ui. Migracijos metu dirbama su abiem eilėmis —
 * logika gyvena ocrEile.js, čia lieka tik įėjimo taškas.
 * @param {Object} node - ocrNuskaitytojai eilutė ({ id, pavadinimas })
 */
export async function checkoutNextFile(node) {
    const { paimtiOcr } = await import("./ocrEile.js");
    return paimtiOcr(node);
}

export function buildFileUri(failas) {
    const needsConversion =
        !failas.extension || failas.extension.toLowerCase() !== "pdf";
    const qs = needsConversion ? "?convertTo=pdf" : "";
    return `/${failas.md5}${qs}`;
}

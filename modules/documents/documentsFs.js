import { createSidecarStore } from "../../utils/sidecarStore.js";

// Dokumentų sidecar JSON: didelės / laisvos formos reikšmės (tekstas, metaduomenys,
// subjektai), kurių nelaikom `documents.documents` lentelėje.
//
// Saugyklos vardas lieka „dokumentai" ir po perėjimo prie documents.* – tai
// fizinių sidecar failų vieta, o ne DB lentelė. Pervadinus, 8,3 mln. jau
// įrašytų sidecar'ų taptų nepasiekiami.
const store = createSidecarStore({
    sidecar: "dokumentai",
    label: "dokumento",
});

/** @param {string} md5 @param {object} sidecar */
export const saveDocumentFs = store.save;

/** @param {string} md5 @returns {Promise<object|null>} */
export const readDocumentFs = store.read;

/**
 * Visa partija vienu kreipiniu: lokalus SQLite, o ko jame nėra – vienas POST
 * į nuotolinį mazgą. Po vieną skaitant, 500 dokumentų porcija paleidžia 500
 * lygiagrečių kreipinių ir sidecar'ų mazgas užsikemša.
 *
 * @param {string[]} md5s @returns {Promise<Map<string, object>>}
 */
export const readDocumentsFs = store.readMany;

import { createSidecarStore } from "../../utils/sidecarStore.js";

// Dokumentų sidecar JSON: didelės / laisvos formos reikšmės (tekstas, metaduomenys,
// subjektai), kurių nelaikom `public.dokumentai` lentelėje.
const store = createSidecarStore({
    sidecar: "dokumentai",
    label: "dokumento",
});

/** @param {string} md5 @param {object} sidecar */
export const saveDokumentasFs = store.save;

/** @param {string} md5 @returns {Promise<object|null>} */
export const readDokumentasFs = store.read;

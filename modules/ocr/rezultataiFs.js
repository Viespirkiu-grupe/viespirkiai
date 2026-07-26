import { createSidecarStore } from "../../utils/sidecarStore.js";
import { parsePgArray } from "../../postgres/postgres.js";

// OCR rezultatų sidecar JSON.
const store = createSidecarStore({
    locationKey: "ocrRezultataiLocation",
    extension: "json",
    label: "OCR rezultato",
    deserialize: (text) => {
        const rezultatas = JSON.parse(text);
        // Istorinis paveldas: dalis rezultatų `tekstas` lauką turi ne masyvu, o
        // PostgreSQL masyvo literalu („{a,b}") — jį išskleidžiam skaitant.
        if (typeof rezultatas.tekstas === "string") {
            rezultatas.tekstas = parsePgArray(rezultatas.tekstas);
        }
        return rezultatas;
    },
});

export const getRezultatasPath = store.getPath;

/**
 * Raktas imamas iš paties rezultato (`rezultatas.md5`), todėl signatūra
 * skiriasi nuo kitų saugyklų.
 * @param {{ md5: string }} rezultatas
 */
export const saveRezultatasFs = (rezultatas) => store.save(rezultatas.md5, rezultatas);

/** @param {string} md5 */
export const readRezultatasFs = store.read;

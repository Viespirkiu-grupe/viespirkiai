import { createSidecarStore } from "../../utils/sidecarStore.js";
import { parsePgArray } from "../../postgres/postgres.js";

// OCR rezultatų sidecar JSON.
const store = createSidecarStore({
    sidecar: "ocrRezultatai",
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

/**
 * Raktas imamas iš paties rezultato (`rezultatas.md5`), todėl signatūra
 * skiriasi nuo kitų saugyklų.
 * @param {{ md5: string, [key: string]: unknown }} rezultatas
 */
export const saveRezultatasFs = (rezultatas) => store.save(rezultatas.md5, rezultatas);

/** @param {string} md5 */
export const readRezultatasFs = store.read;

/** Partija: `Map<md5, rezultatas>` tik su rastais. @param {string[]} md5s */
export const readManyRezultatasFs = store.readMany;

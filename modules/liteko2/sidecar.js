import { createHash } from "node:crypto";
import { createSidecarStore } from "../../utils/sidecarStore.js";

/*
LITEKO2 sprendimų sidecar: pilnas API atsakymas, sprendimo HTML ir iš jo
ištrauktas tekstas. DB laikom tik struktūrizuotus laukus (žr. lenteles.sql),
o didelį/laisvos formos turinį – čia, zstd suspaustoje SQLite saugykloje
(kaip `dokumentai`, `failai`, `ocrRezultatai`).

Raktas – tas pats `md5`, kuris guli `liteko2Sprendimai.md5`, todėl kai turinys
propaguosis į `public.dokumentai`, sidecar rakto keisti nereikės.
*/

const store = createSidecarStore({
    sidecar: "liteko2",
    label: "LITEKO2 sprendimo",
});

/** Stabilus sprendimo raktas: md5('liteko2:<liteko2Id>'). */
export function liteko2Md5(liteko2Id) {
    return createHash("md5").update(`liteko2:${liteko2Id}`).digest("hex");
}

/** @param {string} md5 @param {object} sidecar */
export const saveLiteko2Sidecar = store.save;

/** @param {string} md5 @returns {Promise<object|null>} */
export const readLiteko2Sidecar = store.read;

export const liteko2SidecarExists = store.exists;
export const isLiteko2SidecarConfigured = store.localConfigured;

/** Turinio hash'as pakeitimams aptikti (nepriklauso nuo laukų tvarkos JSON'e). */
export const liteko2SidecarHash = store.hash;

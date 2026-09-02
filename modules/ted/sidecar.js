import { createHash } from "node:crypto";
import { createSidecarStore } from "../../utils/sidecarStore.js";

/*
TED skelbimų sidecar: pilnas skelbimo XML.

`ted."tedNotices"` lieka tik metaduomenys (numeris, nuskaitymo būsena ir laikas),
o turinys – čia, zstd suspaustoje SQLite saugykloje (kaip `dokumentai`,
`liteko2`, `failai`). Postgres'e tie 19 tūkst. XML užėmė ~162 MB pglz'u iš 699 MB
žalio teksto ir keliavo per WAL, atsargines kopijas bei `pg_repack`.

Raktas išvedamas iš skelbimo numerio (`md5('ted:<numeris>')`, kaip liteko2), tad
DB pusėje atskiro hash stulpelio nereikia: ar turinys yra, pasako `scrapeStatus`.
*/

const store = createSidecarStore({
    sidecar: "ted",
    label: "TED skelbimo",
});

/** Stabilus skelbimo raktas: md5('ted:<tedNoticeNumber>'). */
export function tedMd5(tedNoticeNumber) {
    return createHash("md5").update(`ted:${tedNoticeNumber}`).digest("hex");
}

/** @param {string} md5 @param {string} xml */
export const saveTedXml = store.saveRaw;

/** @param {string} md5 @returns {Promise<string|null>} */
export const readTedXml = store.readRaw;

/**
 * Visa partija vienu kreipiniu — pirkimo puslapis vienu metu prašo kelių
 * skelbimų, o po vieną skaitant kiekvienas virstų atskira užklausa.
 *
 * @param {string[]} md5s @returns {Promise<Map<string, string>>}
 */
export const readTedXmlMany = store.readManyRaw;

export const tedSidecarExists = store.exists;
export const isTedSidecarConfigured = store.localConfigured;

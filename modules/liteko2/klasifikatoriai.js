/*
Sinchronizuoja LITEKO2 klasifikatorius (/v1/classifiers/*) į DB:
teismus, bylų rūšis, dokumentų tipus ir bylų kategorijas.

Sąrašai maži (keli tūkstančiai eilučių), todėl paprasčiausia kiekvieną kartą
upsert'inti viską. Eilučių netrinam — nebeaktyvūs klasifikatoriai lieka, kad
seni sprendimai neliktų su „kabančiais" kodais.

    npm run liteko2:klasifikatoriai
*/

import { fetchClassifier } from "./api.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

/** Tuščias string iš API („parentCourtId": "") reiškia „nėra reikšmės". */
function nullIfEmpty(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}

/**
 * Vienas upsert paketas: eilutės su tuo pačiu stulpelių rinkiniu.
 * @param {string} table - lentelės vardas (be schemos).
 * @param {string[]} columns - stulpeliai; pirmasis privalo būti „liteko2Id".
 * @param {Array<Array<unknown>>} rows
 */
async function upsertBatch(table, columns, rows) {
    if (!rows.length) return 0;

    const columnList = columns.map((c) => `"${c}"`).join(", ");
    const values = rows
        .map(
            (_, i) =>
                `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(",")})`,
        )
        .join(", ");
    const updates = columns
        .slice(1)
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .concat(`"atnaujinta" = now()`)
        .join(", ");

    await postgres.query(
        `INSERT INTO public."${table}" (${columnList})
         VALUES ${values}
         ON CONFLICT ("liteko2Id") DO UPDATE SET ${updates}`,
        rows.flat(),
    );
    return rows.length;
}

/** Teismai ir jų rūmai (rūmai turi `parentCourtId`). */
async function syncTeismai() {
    const items = (await fetchClassifier("courts")) ?? [];
    const rows = items
        .filter((item) => nullIfEmpty(item.liteko2Id))
        // API atsakyme laukas iš tiesų vadinasi „counrtName" (jų rašybos klaida).
        .map((item) => [
            item.liteko2Id,
            nullIfEmpty(item.id),
            nullIfEmpty(item.courtCode),
            nullIfEmpty(item.counrtName ?? item.courtName) ?? item.liteko2Id,
            nullIfEmpty(item.parentCourtId),
            nullIfEmpty(item.courtType),
            item.isActive ?? null,
            nullIfEmpty(item.activeFrom),
            nullIfEmpty(item.inactiveFrom),
        ]);

    return upsertBatch(
        "liteko2Teismai",
        ["liteko2Id", "saltinioId", "kodas", "pavadinimas", "tevinisId", "tipas", "aktyvus", "aktyvusNuo", "neaktyvusNuo"],
        rows,
    );
}

async function syncPaprastas(classifier, table, nameField) {
    const items = (await fetchClassifier(classifier)) ?? [];
    const rows = items
        .filter((item) => nullIfEmpty(item.liteko2Id) && nullIfEmpty(item[nameField]))
        .map((item) => [item.liteko2Id, nullIfEmpty(item.id), item[nameField].trim()]);

    return upsertBatch(table, ["liteko2Id", "saltinioId", "pavadinimas"], rows);
}

/** Bylų kategorijos — medis (`parentCategoryId`), naudojamas sprendimų kategorijoms. */
async function syncKategorijos() {
    const items = (await fetchClassifier("case-categories")) ?? [];
    const rows = items
        .filter((item) => nullIfEmpty(item.liteko2Id))
        .map((item) => [
            item.liteko2Id,
            nullIfEmpty(item.id),
            nullIfEmpty(item.categoryCode),
            // Kategorijų pavadinimai ateina su „\r\n" gale.
            nullIfEmpty(item.categoryName) ?? item.liteko2Id,
            nullIfEmpty(item.parentCategoryId),
            nullIfEmpty(item.caseTypeId),
        ]);

    return upsertBatch(
        "liteko2Kategorijos",
        ["liteko2Id", "saltinioId", "kodas", "pavadinimas", "tevineKategorija", "bylosRusiesId"],
        rows,
    );
}

/** Nuskaito visus keturis klasifikatorius. */
export async function sinchronizuotiKlasifikatorius() {
    const teismai = await syncTeismai();
    const rusys = await syncPaprastas("case-types", "liteko2ByluRusys", "typeName");
    const tipai = await syncPaprastas("document-types", "liteko2DokumentuTipai", "docTypeName");
    const kategorijos = await syncKategorijos();

    log(
        `LITEKO2 klasifikatoriai: ${teismai} teismų, ${rusys} bylų rūšių, ` +
        `${tipai} dokumentų tipų, ${kategorijos} kategorijų`,
    );

    return { teismai, rusys, tipai, kategorijos };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await sinchronizuotiKlasifikatorius();
    await postgres.end();
    process.exit(0);
}

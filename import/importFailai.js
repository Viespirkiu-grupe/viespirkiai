/**
 * Importuoja sutarčių dokumentų duomenis iš MongoDB į MySQL.
 * Dokumentai yra susieti su sutartimis pagal dokId ir fileId.
 */
import { postgres } from "../postgres/postgres.js";
import { viespirkiai } from "../mongo/mongoDb.js";
import { log } from "../utils/log.js";

var importFailoNumeris = 1;
/**
 * Atlieka vieną importavimo operaciją.
 * Ieško vieno mongo dokumento, kuris dar neturi dokumentų įrašų MySQL.
 * Jei randa, įrašo dokumentus į MySQL failų lentelę
 * ir pažymi mongo dokumentą kaip apdorotą.
 * @returns {Promise<boolean>} true jei pavyko įrašyti dokumentus, false jei nėra daugiau dokumentų
 */
async function importuotiVienaDokumenta() {
    // Randame sutartį, kur dokumentaiMysql is not true
    const mongoDoc = await viespirkiai.findOne({
        dokumentaiMysql: { $ne: true },
    });

    if (!mongoDoc) {
        log("Visi dokumentai jau įkelti į MySQL.");
        return false;
    }

    // Suformatuojame dokumentus
    let dokumentai = mongoDoc.dokumentai;
    for (let i = 0; i < dokumentai.length; i++) {
        const doc = dokumentai[i];
        doc.dokId = doc.url.match(/dok_id=(\d+)/)[1];
        doc.fileId = doc.url.match(/file_id=(\d+)/)[1];
        doc.pavadinimas = doc.pavadinimas || "";
        doc.extension = doc.pavadinimas.includes(".")
            ? doc.pavadinimas.split(".").pop()
            : null;
    }

    if (!dokumentai || dokumentai.length === 0) {
        log(`[${importFailoNumeris}] Sutartis neturi dokumentų.`);
        importFailoNumeris++;

        // Nustatome dokumentaiMysql kaip true
        await viespirkiai.updateOne(
            { _id: mongoDoc._id },
            { $set: { dokumentaiMysql: true } },
        );
        return true;
    }

    // Įrašome dokumentus į MySQL
    // dokumentai = array of objects to insert
    const values = [];
    const placeholders = dokumentai
        .map((doc, idx) => {
            const base = idx * 4;
            values.push(doc.dokId, doc.fileId, doc.pavadinimas, doc.extension);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        })
        .join(", ");

    await postgres.query(
        `INSERT INTO failai ("dokId", "fileId", pavadinimas, extension)
       VALUES ${placeholders}
       ON CONFLICT ("dokId", "fileId")
       DO UPDATE SET
         pavadinimas = EXCLUDED.pavadinimas,
         extension = EXCLUDED.extension;`,
        values,
    );

    // Nustatome dokumentaiMysql kaip true
    await viespirkiai.updateOne(
        { _id: mongoDoc._id },
        { $set: { dokumentaiMysql: true } },
    );

    log(`[${importFailoNumeris}] Į MySQL įterpti dokumentai.`);
    importFailoNumeris++;
    return true;
}

export async function importuotiDokumentus() {
    while (await importuotiVienaDokumenta()) {
        // Kartoti, kol yra dokumentų
    }
}

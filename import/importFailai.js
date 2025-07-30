/**
 * Importuoja sutarčių dokumentų duomenis iš MongoDB į MySQL.
 * Dokumentai yra susieti su sutartimis pagal dokId ir fileId.
 */
import { mysql } from "../mysql/mysql.js";
import { viespirkiai } from "../mongo/mongoDb.js";

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
		console.log("Visi dokumentai jau įkelti į MySQL.");
		return false;
	}

	// Suformatuojame dokumentus
	let dokumentai = mongoDoc.dokumentai;
	for (let i = 0; i < dokumentai.length; i++) {
		const doc = dokumentai[i];
		doc.dokId = doc.url.match(/dok_id=(\d+)/)[1];
		doc.fileId = doc.url.match(/file_id=(\d+)/)[1];
		doc.pavadinimas = doc.pavadinimas || "";
		doc.extension = doc.pavadinimas.includes(".") ? doc.pavadinimas.split(".").pop() : null;
	}

	if (!dokumentai || dokumentai.length === 0) {
		console.log(`[${importFailoNumeris}] Sutartis neturi dokumentų.`);
        importFailoNumeris++;

		// Nustatome dokumentaiMysql kaip true
		await viespirkiai.updateOne(
			{ _id: mongoDoc._id },
			{ $set: { dokumentaiMysql: true } }
		);
		return true;
	}

	// Įrašome dokumentus į MySQL
	const placeholders = dokumentai.map(() => "(?, ?, ?, ?)").join(", ");
	const values = dokumentai.flatMap((doc) => [
		doc.dokId,
		doc.fileId,
		doc.pavadinimas,
		doc.extension,
	]);

	const result = await mysql.query(
		`INSERT INTO failai (dokId, fileId, pavadinimas, extension) VALUES ${placeholders}`,
		values
	);

	// Nustatome dokumentaiMysql kaip true
	await viespirkiai.updateOne(
		{ _id: mongoDoc._id },
		{ $set: { dokumentaiMysql: true } }
	);

    console.log(`[${importFailoNumeris}] Į MySQL įterpti dokumentai.`);
    importFailoNumeris++;
    return true;
}

while (await importuotiVienaDokumenta()) {
    // Kartoti, kol yra dokumentų
}
process.exit(0); // Baigta

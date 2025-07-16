import { mysql } from "../mysql/mysql.js";
import { viespirkiai } from "../mongo/mongoDb.js";

var index = 1;
async function doOne() {
	// Get a document where dokumentaiMysql is not true from mongo
    const mongoDoc = await viespirkiai.findOne({
        dokumentaiMysql: { $ne: true },
      //  dokumentuKiekis: { $gt: 0 },
    });

	if (!mongoDoc) {
		console.log("No documents found where dokumentaiMysql is not true.");
		return false;
	}

	let dokumentai = mongoDoc.dokumentai;
	for (let i = 0; i < dokumentai.length; i++) {
		const doc = dokumentai[i];
		doc.dokId = doc.url.match(/dok_id=(\d+)/)[1];
		doc.fileId = doc.url.match(/file_id=(\d+)/)[1];
		doc.pavadinimas = doc.pavadinimas || "";
		doc.extension = doc.pavadinimas.includes(".") ? doc.pavadinimas.split(".").pop() : null;
	}

	if (!dokumentai || dokumentai.length === 0) {
        // console.log(mongoDoc.pavadinimas)
		console.log(`${index} No documents found in the mongo document.`);
        index++;

		// Set dokumentaiMysql to true
		await viespirkiai.updateOne(
			{ _id: mongoDoc._id },
			{ $set: { dokumentaiMysql: true } }
		);
		return true;
	}

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

	await viespirkiai.updateOne(
		{ _id: mongoDoc._id },
		{ $set: { dokumentaiMysql: true } }
	);

    console.log(`${index} / Inserted documents into MySQL.`);
    index++;
    return true;
}

while (await doOne()) {
    // Repeat while true is returned
}

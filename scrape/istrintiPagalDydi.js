/*
Iš dėžių ištrina failus pagal nurodytą dydį baitais.
Naudojimas: node istrintiPagalDydi.js <dydis_baitais>
*/

import { mysql } from "../mysql/mysql.js";

// Nuskaitome nurodytą dydį iš argumentų
const dydisTarget = parseInt(process.argv[2]);

if (isNaN(dydisTarget)) {
	console.error("Naudojimas: node istrintiPagalDydi.js <dydis_baitais>");
	process.exit(1);
}

// Triname failus
while (true) {
	// Randame failą trinimui
	const [failai] = await mysql.execute(
		"SELECT * FROM failai WHERE dydis = ? AND parsiustas = 1 LIMIT 1",
		[dydisTarget]
	);

	if (failai.length === 0) {
		console.log("Nebėra failų su nurodytu dydžiu.");
		process.exit(0); // Baigta
	}

	const failas = failai[0];

	// Randame dėžę, kurioje saugomas failas
	const [dezeRows] = await mysql.execute(
		"SELECT * FROM dezes WHERE pavadinimas = ? LIMIT 1",
		[failas.saugojama]
	);

	if (dezeRows.length === 0) {
		console.warn(`Dėžė "${failas.saugojama}" nerasta failui ${failas.id}`);
		process.exit(1); // Nepavyko
	}

	// Pateikiama trinimo užklausa
	const deze = dezeRows[0];
	const deleteUrl = `${deze.url}/file/${failas.md5}.${failas.extension}`;

	console.log(deleteUrl);

	const resp = await fetch(deleteUrl, {
		method: "DELETE",
		headers: {
			"x-api-key": deze.apiKey,
		},
	});

	if (resp.ok) {
		// Pavyko
		console.log(`Ištrintas failas: ${failas.pavadinimas} (ID: ${failas.id})`);

		// Pašaliname failą iš duomenų bazės
		await mysql.execute(
			"UPDATE failai SET dydis = NULL, md5 = NULL, saugojama = NULL, parsiustas = 0 WHERE md5 = ?",
			[failas.md5]
		);

		// Atnaujiname dėžės dydį
		let usedReq = await fetch(`${deze.url}/storage-usage`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": deze.apiKey,
			},
		});
		let { totalSizeBytes } = await usedReq.json();

		await mysql.execute("UPDATE dezes SET used = ? WHERE id = ?", [
			totalSizeBytes,
			deze.id,
		]);
	} else {
		// Nepavyko ištrinti failo
		const errorText = await resp.text();
		console.error(`Klaida trinant failą ${failas.id}:`, errorText);
		process.exit(1); // Nepavyko
	}
}

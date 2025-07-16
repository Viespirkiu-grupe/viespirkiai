import { mysql } from "../mysql/mysql.js";

const dydisTarget = parseInt(process.argv[2]);

if (isNaN(dydisTarget)) {
	console.error("Naudojimas: node istrintiPagalDydi.js <dydis_baitais>");
	process.exit(1);
}

while (true) {
	const [failai] = await mysql.execute(
		"SELECT * FROM failai WHERE dydis = ? AND parsiustas = 1 LIMIT 1",
		[dydisTarget]
	);

	if (failai.length === 0) {
		console.log("Nebėra failų su nurodytu dydžiu.");
		break;
	}

	const failas = failai[0];

	const [dezeRows] = await mysql.execute(
		"SELECT * FROM dezes WHERE pavadinimas = ? LIMIT 1",
		[failas.saugojama]
	);

	if (dezeRows.length === 0) {
		console.warn(
			`Dėžė "${failas.saugojama}" nerasta failui ${failas.id}, praleidžiam.`
		);
		break; // arba `continue`, jei nori eiti prie kito
	}

	const deze = dezeRows[0];
	const deleteUrl = `${deze.url}/file/${failas.md5}.${failas.extension}`;

    console.log(deleteUrl)

	const resp = await fetch(deleteUrl, {
		method: "DELETE",
		headers: {
			"x-api-key": deze.apiKey,
		},
	});

	if (resp.ok) {
		console.log(`Ištrintas failas: ${failas.pavadinimas} (ID: ${failas.id})`);

		await mysql.execute(
			"UPDATE failai SET dydis = NULL, md5 = NULL, saugojama = NULL, parsiustas = 0 WHERE md5 = ?",
			[failas.md5]
		);

		// update deze
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
		const errorText = await resp.text();
		console.error(`Klaida trinant failą ${failas.id}:`, errorText);
		break;
	}
}

/*
Randa JAR adresų koordinates ir įrašo į adresai (MySQL) lentelę.
*/

import { mysql } from "../mysql/mysql.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const SLEEP_MS = 1001;
const USER_AGENT = "Viespirkiai/1.0 (sveiki@viespirkiai.top)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (true) {
	// Randame JAR įrašą, kuriam reikia adreso koordinačių
	const [rows] = await mysql.execute(`
    SELECT jarKodas, adresas FROM jar
    WHERE adresoId IS NULL AND adresas IS NOT NULL
    LIMIT 1
  `);

	if (rows.length === 0) {
		console.log("No more rows to process");
		break; // Baigta
	}

	let { jarKodas, adresas } = rows[0];

	// Patikriname ar adresas jau egizstuojantis
	const [[existing]] = await mysql.execute(
		"SELECT id FROM adresai WHERE adresas = ? LIMIT 1",
		[adresas]
	);

	if (existing) {
		// Adresas jau yra, atnaujiname JAR įrašą
		var adresoId = existing.id;
	} else {
		// Suformuojame užklausą į Nominatim
		console.log(`Užklausiama dėl: ${adresas}`);
		const normalizedAddress = await supaprastintasAdresas(adresas);
		console.log(`Suprastintas adresas: ${normalizedAddress}`);

		const url = new URL(NOMINATIM_URL);
		url.searchParams.set("q", normalizedAddress);
		url.searchParams.set("format", "json");
		url.searchParams.set("limit", "1");

		try {
			// Atliekame užklausą
			const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
			const data = await res.json();

			if (!data.length) {
				console.warn(`No geocode result for: ${adresas}`);
				var adresoId = -1; // Adresas nerastas
			} else {
				// Įterpiame rastą adresą į duomenų bazę
				const { lat, lon } = data[0];
				console.log(`lat=${lat}, lon=${lon}`);

				const [result] = await mysql.execute(
					"INSERT INTO adresai (taskas, adresas) VALUES (POINT(?, ?), ?)",
					[parseFloat(lon), parseFloat(lat), adresas]
				);

				var adresoId = result.insertId; 
			}
		} catch (e) {
			console.error(`Klaida vykdant užklausą ${adresas}:`, e);

			// Palaukiame 60s ir tęsiame ciklą
			await sleep(60000);

			continue;
		}
	}

	// Atnaujiname JAR įrašą su adreso ID
	await mysql.execute("UPDATE jar SET adresoId = ? WHERE jarKodas = ?", [
		adresoId,
		jarKodas,
	]);

	console.log(`Atnaujintas jar ${jarKodas} → adresoId=${adresoId}`);
	console.log(`---`);
	await sleep(SLEEP_MS);
}

/**
 * Supaprastina adresą, pakeičia linksnį.
 * @param {string} raw - Originalus adresas
 * @returns {Promise<string>} Supaprastintas adresas
 */
async function supaprastintasAdresas(raw) {
	// Kaimų ir viensėdžių pavadinimai turi būt konvertuojami į vardininko linksnį
	for (const prefix of ["k.", "vs."]) {
		const match = raw.match(
			new RegExp(`([\\p{L}\\s.'\\-]+?)\\s*${prefix}`, "iu")
		);

		if (match) {
			// Randame tinkamą linksnį
			let place = match[1].trim();
			const [[found]] = await mysql.execute(
				"SELECT pavadinimas FROM gyvenamosVietoves WHERE pavadinimas_k = ? LIMIT 1",
				[place]
			);

			// Pakeičiame
			if (found && found.pavadinimas) {
				raw = raw.replace(place, found.pavadinimas);
			}
		}
	}

	
	raw = raw.replace(/\bk\.\s*/gi, ""); // Panaikiname k.
	raw = raw.replace(/\bvs\.\s*/gi, ""); // Panaikiname vs.
	raw = raw.replace(/\bglž\.\s*/gi, "");	// Panaikiname glž. st.

	// Panaikiname LT- pašto kodo prefiksą
	const postcodeMatch = raw.match(/LT-(\d{5})/i);
	const postcode = postcodeMatch ? postcodeMatch[1] : "";

	// Išimtis – Maigės -> P. Cvirkos
	raw = raw.replace(/\bMaigės\b/gi, "P. Cvirkos");

	// Randame adreso numerį
	const streetNumberMatch = raw.match(
		/([\p{L}\s.'\-]+?\d+[A-Za-z]?(-\d+[A-Za-z]?)?)/iu
	);

	const streetNumber = (
		streetNumberMatch ? streetNumberMatch[1].trim() : ""
	).replace(/-\d+[A-Za-z]?$/, "");

	// Suformuojame galutinį adresą
	let addr = "";

	if (streetNumber) addr += streetNumber;
	if (postcode) addr += (addr ? ", " : "") + postcode;

	addr += (addr ? ", " : "") + "Lithuania";

	return addr;
}

await mysql.end();
process.exit(0); // Baigta
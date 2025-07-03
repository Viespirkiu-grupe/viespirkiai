import { mysql } from "../mysql/mysql.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const SLEEP_MS = 1001;
const USER_AGENT = "Viespirkiai/1.0 (sveiki@viespirkiai.top)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (true) {
	const [rows] = await mysql.execute(`
    SELECT jarKodas, adresas FROM jar
    WHERE adresoId IS NULL AND adresas IS NOT NULL
    LIMIT 1
  `);

	if (rows.length === 0) {
		console.log("No more rows to process");
		break;
	}

	for (const { jarKodas, adresas } of rows) {
		// Patikriname ar adresas jau egizstuojantis
		const [[existing]] = await mysql.execute(
			"SELECT id FROM adresai WHERE adresas = ? LIMIT 1",
			[adresas]
		);

		let adresasId;

		if (existing) {
			adresasId = existing.id;
		} else {
			console.log(`Užklausiama dėl: ${adresas}`);
			const normalizedAddress = await minimalAddress(adresas);
			console.log(`Suprastintas adresas: ${normalizedAddress}`);

			const url = new URL(NOMINATIM_URL);
			url.searchParams.set("q", normalizedAddress);
			url.searchParams.set("format", "json");
			url.searchParams.set("limit", "1");

			try {
				const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
				const data = await res.json();

				if (!data.length) {
					console.warn(`No geocode result for: ${adresas}`);
					adresasId = -1;
					// process.exit(1);
				} else {
					const { lat, lon } = data[0];
					console.log(`lat=${lat}, lon=${lon}`);

					const [result] = await mysql.execute(
						"INSERT INTO adresai (taskas, adresas) VALUES (POINT(?, ?), ?)",
						[parseFloat(lon), parseFloat(lat), adresas]
					);

					adresasId = result.insertId;
				}
			} catch (e) {
				console.error(`Klaida vykdant užklausą ${adresas}:`, e);
				continue;
			}
		}

		// Atnaujiname JAR įrašą su adreso ID
		await mysql.execute("UPDATE jar SET adresoId = ? WHERE jarKodas = ?", [
			adresasId,
			jarKodas,
		]);

		console.log(`Atnaujintas jar ${jarKodas} → adresoId=${adresasId}`);
		console.log(`---`);
		await sleep(SLEEP_MS);
	}
}

async function minimalAddress(raw) {
	// Kaimų ir viensėdžių pavadinimai turi būt konvertuojami į vardininko linksnį
	for (const prefix of ["k.", "vs."]) {
		const match = raw.match(
			new RegExp(`([\\p{L}\\s.'\\-]+?)\\s*${prefix}`, "iu")
		);

		if (match) {
			let place = match[1].trim();
			const [[found]] = await mysql.execute(
				"SELECT pavadinimas FROM gyvenamosVietoves WHERE pavadinimas_k = ? LIMIT 1",
				[place]
			);

			if (found && found.pavadinimas) {
				raw = raw.replace(place, found.pavadinimas);
			}
		}
	}

  // Išimtys
  // Maigės -> P. Cvirkos
  raw = raw.replace(/\bMaigės\b/gi, "P. Cvirkos");

	// Panaikiname k.
	raw = raw.replace(/\bk\.\s*/gi, "");

	// Panaikiname glž. st.
	raw = raw.replace(/\bglž\.\s*/gi, "");

	// Panaikiname LT- pašto kodo prefiksą
	const postcodeMatch = raw.match(/LT-(\d{5})/i);
	const postcode = postcodeMatch ? postcodeMatch[1] : "";

	// Match full street name + house number/range
	const streetNumberMatch = raw.match(
		/([\p{L}\s.'\-]+?\d+[A-Za-z]?(-\d+[A-Za-z]?)?)/iu
	);
	const streetNumber = (
		streetNumberMatch ? streetNumberMatch[1].trim() : ""
	).replace(/-\d+[A-Za-z]?$/, "");

	let addr = "";

	if (streetNumber) addr += streetNumber;
	if (postcode) addr += (addr ? ", " : "") + postcode;

	addr += (addr ? ", " : "") + "Lithuania";

	return addr;
}

await mysql.end();

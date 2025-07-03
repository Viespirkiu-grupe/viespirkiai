import { parseHTML } from "linkedom";
import { writeFile } from "fs/promises";
import { importArray } from "../import/import.js";
import fetch from 'node-fetch';
import pkg from 'https-proxy-agent';
const { HttpsProxyAgent } = pkg;
import config from "../utils/config.js";

let proxyAgent = null;
if(config.scrapeProxy){
	proxyAgent = new HttpsProxyAgent(config.scrapeProxy);
}

async function scrapePage(page = 0) {
	page *= 50; // Nurodomas offset

	let kiekis = 49; // Paprašai 50, gausi 51
	if (page == 0) {
		kiekis = 50; // Pirmame puslapyje teisingai
	}

	const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=${kiekis}&order_field=date&order_dir=asc&limitstart=${page}`;
	console.log(`[Import#${page/50}] ${url}`);

	let start = new Date();

	let response;
	if(proxyAgent){
		response = await fetch(url, { agent: proxyAgent });
	}else{
		response = await fetch(url);
	}
	const html = await response.text();

	let end = new Date();
	console.log(`[Import#${page/50}] Response time: ${end - start}ms`);
	
	const { document } = parseHTML(html);

	const table = document.querySelector("#lenetele_table");
	const rows = [...table.querySelectorAll("tr")];

	const result = [];
	let collecting = false;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!collecting) {
			if (row.id === "topRow") {
				collecting = true;
			}
			continue;
		}

		const mainMatch = row.id?.match(/^vptpublic_main_(\d+)$/);
		if (mainMatch) {
			const id = mainMatch[1];
			const nextRow = rows[i + 1];
			const extraMatch = nextRow?.id === `vptpublic_extra_${id}`;
			if (extraMatch) {
				result.push([row, nextRow]);
				i++;
			}
		}
	}

	let sutartys = [];

	for (const [mainRow, extraRow] of result) {
		let sutartis = {
			tipas: mainRow.querySelectorAll("td")[1].querySelector("a").innerHTML,
			pavadinimas: mainRow
				.querySelectorAll("td")[1]
				.querySelector("a")
				.innerHTML.trimEnd(),
			kategorija: mainRow
				.querySelectorAll("td")[1]
				.querySelector(".ProcurementType").innerHTML,
			perkanciojiOrganizacija:
				mainRow.querySelectorAll("td")[2].querySelector("a")?.innerHTML ?? "",
			perkanciosiosOrganizacijosKodas:
				mainRow.querySelectorAll("td")[2].querySelectorAll("a")[1]?.innerHTML ??
				"",
			tiekejas:
				mainRow
					.querySelectorAll("td")[3]
					.querySelector("a")
					?.innerHTML.trimEnd() ?? "",

			tiekejoKodas:
				mainRow.querySelectorAll("td")[3].querySelectorAll("a")[1]?.innerHTML ??
				"",
			verte: mainRow
				.querySelectorAll("td")[4]
				.innerHTML.replace("€", "")
				.replace(/\./g, "")
				.replace(/,/g, "."),
			sudarymoData: mainRow.querySelectorAll("td")[5].innerHTML,
			galiojimoData: mainRow.querySelectorAll("td")[6].innerHTML,
			faktineIvykdimoVerte: mainRow
				.querySelectorAll("td")[7]
				.innerHTML.replace("&#160;", "")
				.replace("€", "")
				.replace(/\./g, "")
				.replace(/,/g, "."),
			faktineIvykdimoData: mainRow
				.querySelectorAll("td")[8]
				.innerHTML.replace("&#160;", ""),
			tipas: mainRow.querySelectorAll("td")[9].innerHTML,
			dokumentai: [],
			dokumentuKiekis: 0,
		};

		let ekstriniaiDuomenys = extraRow
			.querySelector("table")
			.querySelectorAll("tr");
		ekstriniaiDuomenys.forEach((tr) => {
			let tekstas = tr.innerHTML;
			if (tekstas.includes("Paskelbimo data")) {
				sutartis.paskelbimoData =
					tr.querySelectorAll("td")[1].querySelector("span")?.innerHTML ?? "";

				if (tekstas.includes("atnaujinimo data")) {
					sutartis.paskutinioAtnaujinimoData = tr
						.querySelectorAll("td")[1]
						.querySelector("span")
						.title.replace("Paskutinio atnaujinimo data ", "");
				}
			} else if (tekstas.includes("BVPŽ kodas")) {
				try {
					sutartis.bvpzKodas = tr
						.querySelectorAll("td")[1]
						.querySelector("a").innerHTML;
					sutartis.bvpzPavadinimas = ((td) => {
						td.querySelector("a")?.remove();
						return td.textContent.trim();
					})(tr.querySelectorAll("td")[1]);
				} catch (e) {
					let galimaiKodas = tr.querySelectorAll("td")[1].innerHTML;
					if (galimaiKodas.match(/^[0-9-]+$/) || galimaiKodas.length < 15) {
						sutartis.bvpzKodas = galimaiKodas;
						sutartis.bvpzPavadinimas = "";
					} else {
						if(tr.innerHTML.match(/<td class="text-end"><i><b>BVPŽ kodas:<\/b><\/i><\/td><td>(.*)<\/td>/)){
							sutartis.bvpzKodas = undefined;
							sutartis.bvpzPavadinimas = tr.innerHTML.match(/<td class="text-end"><i><b>BVPŽ kodas:<\/b><\/i><\/td><td>(.*)<\/td>/)[1];
						}else if(galimaiKodas.match(/^[0-9]{8}-[0-9]$/)){
							sutartis.bvpzKodas = galimaiKodas;
							sutartis.bvpzPavadinimas = "";
						}else{
							console.log("Nerastas BVPŽ kodas: " + galimaiKodas + "END");
							console.log(tr.innerHTML);
						}
					}
				}
			} else if (tekstas.includes("Paskutinio redagavimo data")) {
				sutartis.paskutinioRedagavimoData =
					tr.querySelectorAll("td")[1].innerHTML;
			} else if (tekstas.includes("Sutarties unikalus ID")) {
				sutartis.sutartiesUnikalusID = tr.querySelectorAll("td")[1].innerHTML;
			} else if (tekstas.includes("Sutarties numeris")) {
				sutartis.sutartiesNumeris = tr.querySelectorAll("td")[1].innerHTML;
			} else if (tekstas.includes("Pirkimo numeris")) {
				sutartis.pirkimoNumeris = tr.querySelectorAll("td")[1].innerHTML;
			} else if (tekstas.includes("Dokumentai")) {
				let dokumentuLink = tr.querySelectorAll("td")[1].querySelectorAll("a");

				dokumentuLink.forEach((link) => {
					sutartis.dokumentai.push({
						pavadinimas: link.innerHTML,
						url: "https://eviesiejipirkimai.lt" + link.href,
					});
				});

				sutartis.dokumentuKiekis = dokumentuLink.length;
			} else {
				throw new Error("Nerastas laukelis: " + tr.innerHTML);
			}
		});

		sutartys.push(sutartis);
	}

	return sutartys;
}

async function importPage(page = 0){
	let start = new Date();

	let data = await scrapePage(page);
	if (data.length === 0) {
		console.log(`[Import#${page}] No data found.`);
		return 0;
	}
	await importArray(data);

	let end = new Date();

	console.log(`[Import#${page}] Imported in ${end - start}ms.`);
	console.log(`[Import#${page}] Imported ${data.length} records.`);

	return data.length;
}

async function requestLatestData() {
	// Read the last fully processed page from lastPage.txt
	let page = 0;
	try {
		const lastPageFile = await import('fs/promises').then(fs => 
			fs.readFile('lastPage.txt', 'utf-8'));
		page = parseInt(lastPageFile.trim(), 10) + 1;
		if (isNaN(page)) page = 0;
		console.log(`Starting from page ${page} based on lastPage.txt`);
	} catch (error) {
		console.log('No lastPage.txt found, starting from page 0');
	}

	// Download data from the next pages
	while (true) {
		console.log(`[Import#${page}] Importing.`);

		if (await importPage(page) < 50) {
			console.log(`[Import#${page}] Page isn't full. Stopping.`);
			return;
		} else {
			console.log(`[Import#${page}] Page imported successfully.`);
			// Write the last processed page to lastPage.txt
			await writeFile('lastPage.txt', page.toString());
			page++;
		}
		console.log(`[Import#${page}] --------------------------`);
	}
}

// If this script is run directly, start the periodic sync
if (import.meta.url === `file://${process.argv[1]}`) {
	periodicallySyncData(60);
}

export function periodicallySyncData(interval = 60) {
	let isRunning = false;
	
	// Run once immediately
	(async () => {
		console.log(`Initial data sync.`);
		isRunning = true;
		try {
			await requestLatestData();
		} catch (error) {
			console.error("Error during initial data sync:", error);
		} finally {
			isRunning = false;
		}
	})();
	
	// Set up periodic sync
	setInterval(async () => {
		console.log(`Periodic data sync.`);
		if (isRunning) {
			console.log("Previous sync still in progress, skipping this interval");
			return;
		}
		
		isRunning = true;
		try {
			await requestLatestData();
		} catch (error) {
			console.error("Error during periodic data sync:", error);
		} finally {
			isRunning = false;
		}
	}, interval * 1000);
}
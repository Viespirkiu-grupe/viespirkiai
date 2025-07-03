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

async function scrapeID(unikalusID) {
	const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&Itemid=109&filter_show=1&filter_limit=10&vpt_unite=&filter_tender=&filter_number=&filter_proctype=&filter_dok_id=${unikalusID}&filter_authority=&filter_jarcode=&filter_purchaseCode=&filter_cpv=&filter_valuefrom=&filter_valueto=&filter_contractdate_from=&filter_contractdate_to=&filter_expirationdate_from=&filter_expirationdate_to=&filter_supplier=&filter_supplier_jarcode=&filter_agreement_type=`;
	console.log(`[Import] ${url}`);

	let start = new Date();

	let response;
	if(proxyAgent){
		response = await fetch(url, { agent: proxyAgent });
	}else{
		response = await fetch(url);
	}
	const html = await response.text();

	let end = new Date();
	console.log(`[Import] Response time: ${end - start}ms`);
	
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

async function importID(unikalusID){
	let start = new Date();

	let data = await scrapeID(unikalusID);
	if (data.length === 0) {
		console.log(`[Import] No data found.`);
		return 0;
	}
	await importArray(data);

	let end = new Date();

	console.log(`[Import] Imported in ${end - start}ms.`);
	console.log(`[Import] Imported ${data.length} records.`);

	return data.length;
}

// When ran use the argument to run importID
if (process.argv.length > 2) {
	const unikalusID = process.argv[2];
	console.log(`Importing data for unikalus ID: ${unikalusID}`);
	importID(unikalusID)
		.then((count) => {
			console.log(`Imported ${count} records for unikalus ID: ${unikalusID}`);
		})
		.catch((error) => {
			console.error(`Error importing data for unikalus ID: ${unikalusID}`, error);
		});
}
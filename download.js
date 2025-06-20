import { viespirkiai } from "./database.js";
import fs from "fs/promises";
import crypto from "crypto";

const documentDirectory = "/mnt/s1/viespirkiai/dokumentai";

let downloadDurations = [];
/**
 * Downloads all documents associated with a contract by its unique ID.
 * Stores documents in the specified directory, filename - UUID.
 * Sets the UUID in the MongoDB object.
 * archyvuotuDokumentuKiekis is set to the number of successfully downloaded documents.
 * @param {number} sutartiesUnikalusID - The unique ID of the contract.
 * @returns {Promise<void>}
 */
async function downloadDocuments(sutartiesUnikalusID) {
	const contract = await viespirkiai.findOne({ sutartiesUnikalusID });
	if (!contract || !contract.dokumentai || contract.dokumentai.length === 0) {
		console.error(`No documents found for contract ID: ${sutartiesUnikalusID}`);
		return;
	}
	await fs.mkdir(documentDirectory, { recursive: true });
	let downloadedCount = 0;
	for (const doc of contract.dokumentai) {
		try {
			console.log(`Downloading document: ${doc.pavadinimas}`);
			const startTime = Date.now();

			const response = await fetch(doc.url);
			if (!response.ok) {
				console.error(
					`Failed to download ${doc.pavadinimas}: ${response.statusText}`
				);
				continue;
			}
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const endTime = Date.now();

			const hash = crypto.createHash("md5").update(buffer).digest("hex");
			const extension = doc.pavadinimas.split(".").pop();
			const fileName = `${hash}.${extension}`;
			const filePath = `${documentDirectory}/${fileName}`;
			await fs.writeFile(filePath, buffer);

			// Attach metadata
			doc.fileSize = buffer.length;
			doc.extension = extension;
			doc.hash = hash;


			downloadedCount++;
			const durationSeconds = (endTime - startTime) / 1000;
			const sizeMB = buffer.length / (1024 * 1024);
			const speedMbps = (sizeMB * 8) / durationSeconds;

			console.log(`Downloaded: ${fileName}`);
			console.log(
				`Size: ${sizeMB.toFixed(2)} MB, Time: ${durationSeconds.toFixed(
					2
				)} s, Speed: ${speedMbps.toFixed(2)} Mbps`
			);
			downloadDurations.push(durationSeconds);
			if (downloadDurations.length > 100) {
				downloadDurations.shift(); // Keep the last 100 durations
			}
			console.log(
				`Average download speed: ${(
					downloadDurations.reduce((a, b) => a + b, 0) /
					downloadDurations.length
				).toFixed(2)} seconds per download`
			);
		} catch (error) {
			console.error(`Error downloading ${doc.pavadinimas}:`, error);
		}
	}

	const archyvuotiPilnai = downloadedCount === contract.dokumentuKiekis;

	await viespirkiai.updateOne(
		{ sutartiesUnikalusID },
		{
			$set: {
				archyvuotuDokumentuKiekis: downloadedCount,
				dokumentai: contract.dokumentai,
				archyvuotiPilnai,
			},
		}
	);
	console.log(
		`Downloaded ${downloadedCount} documents for contract ID: ${sutartiesUnikalusID}`
	);
}

async function downloadRandom() {
	// Find a (not necessarily random) contract with documents left to download
	const contract = await viespirkiai.findOne({
		dokumentuKiekis: { $gt: 0 },
		$or: [
			{ archyvuotiPilnai: false },
			{ archyvuotiPilnai: { $exists: false } },
		],
	});

	if (!contract) {
		console.log("No contracts with documents to download found.");
		return "End of download.";
	}

	const duplicates = await viespirkiai
		.find({
			sutartiesUnikalusID: contract.sutartiesUnikalusID,
			_id: { $ne: contract._id },
		})
		.toArray();

	if (duplicates.length > 0) {
		const allVariants = [contract, ...duplicates];
		const preferred =
			allVariants.find((c) => c.archyvuotuDokumentuKiekis !== undefined) ||
			allVariants[0];

		const toDelete = allVariants
			.filter((c) => c._id.toString() !== preferred._id.toString())
			.map((c) => c._id);

		if (toDelete.length > 0) {
			await viespirkiai.deleteMany({ _id: { $in: toDelete } });
			console.log(
				`Deleted ${toDelete.length} duplicate(s) for sutartiesUnikalusID: ${contract.sutartiesUnikalusID}`
			);
		}

		// Replace 'contract' with the preferred one
		contract._id = preferred._id;
	}

	console.log(
		`Downloading documents for contract ID: ${contract.sutartiesUnikalusID}`
	);
	await downloadDocuments(contract.sutartiesUnikalusID);
}

async function runDownloads() {
	function isAllowedTime() {
		const now = new Date();
		const hour = now.getHours();
		return hour >= 21 || hour < 6;
	}

	while (true) {
		if (isAllowedTime()) {
			let result;
			do {
				result = await downloadRandom();
				console.log("Download cycle completed, checking for more...");
			} while (result !== "End of download.");
			console.log("All downloads completed!");
			break; // exit after finishing downloads in allowed time
		} else {
			console.log("Outside allowed time window, waiting 60 seconds...");
			await new Promise((resolve) => setTimeout(resolve, 60000)); // wait 60s
		}
	}
}

await runDownloads();
